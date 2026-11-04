## Upload Workflow

PostgreSQL stores the track metadata, and Supabase Storage stores the audio bytes. In order to coordinate them when uploads fail or requests are retried, our upload workflow looks like the following:

### 1. User uploads an audio file to the web app.

### 2. Backend creates a pending track.

Browser calls the `reserve-upload` Edge Function (defined in `supabase/functions/reserve-upload/index.ts`)with its Supabase session token. 

The function:
1. Handles browser CORS preflight requests.
2. Rejects methods other than `POST`.
3. Requires a Bearer token.
4. Calls Supabase Auth's `getUser(token)`.
5. Uses the returned `user.id` as the owner (we don't trust the user ID submitted in the request body, as it could have been modified).

Then, the function creates a server-side Supabase client using the service-role key. Using the client, the Edge Function calls a database function `reserve_track_upload()`:
```
reserve_track_upload(
    verified user ID,
    idempotency key,
    filename,
    expected size
)
```

The database function performse these operations in one transaction:
- **Validate metadata:** Checks if user and idempotency key are supplied, file extension is valid (`.mp3` or `.wav`), and file size is between 1 byte and 20 MiB. 
- **Serialize reservations per user:** Advisory transaction lock prevents two simultaneous reservation requests from both seeing the same available quota and exceeding it.
- **Handle retries:** If `(user_id, idempotency_key)` exists, it returns the already created reservation rather than creating a new one. It rejects conflicting metadata, records being deleted, and expired pending reservations.
- **Check quota:** Sums the user's recorded file sizes (includes pending and deleting records) and enforces **100MiB per-user quota** (chosen heuristically; it is not representative of Supabase's project-wide storage allowance). 
- **Create a pending record:** A new reservation looks like this:
```
id:                 server-generated UUID
user_id:            authenticated owner
title:              filename without extension
storage_path:       USER_ID/TRACK_ID.mp3
size_bytes:         declared size
status:             pending
upload_expires_at:  4 hours after reservation
ready_at:           null
idempotency_key:    browser-generated UUID
```

After PostgreSQL returns a reservation, the Edge Function:
- Checks the returned record (confirms the owner, track ID, file size, MIME type, and storage path match the authenticated request). 
- Builds `publicTrack`, which represents the metadata the browser needs later to upload to private storage.
- Chooses the next action:

| Situation | Response | Browser’s next step |
|---|---|---|
| Track is already `ready` | `action: "ready"` | Use the existing track |
| Track is pending and its file exists | `action: "finalize"` | Request file verification |
| Track is pending and its file is missing | `action: "upload"` plus signed token | Upload the file directly |
| Reservation is expired, deleting, or inconsistent | Error | Stop or recover appropriately |

- Issues authorization only when necessary (for `"upload"`): For a track pending with missing file, it checks if enough time is remaining before expiry (do not issue for ones about to expire soon). It then generates a signed upload token (lasts 2 hours) scoped to the exact storage path. `upsert:false` prevents overwriting an existing file.

### 3. Browser uploads the file to private storage in Supabase.

### 4. Backend verifies the file and marks it ready for the track to be usable in the web app.

Browser's helper function `finalizeUpload(trackId)` calls the server-side endpoint `finalize-upload` edge function deployed in Supabase. The endpoint accepts
```json
{
    "trackId": "the-reserved-track-uuid"
}
```
Browser supplies the user's access token in the `Authorization` header.

Success response of this function looks like the following:
```typescript
{
    action: "ready",
    track: {
        id,
        title,
        status: "ready",
        storagePath,
        mimeType,
        sizeBytes,
        expiresAt,
    },
}
```

Only `OPTIONS` and `POST` requests are accepted. Then, the endpoint asks Supabase Auth to validate the access token and identify the user. Once session is authenticated, we parse the JSON and validate the `trackId` (track must have the requested ID and belong to the authenticated user). 

We download the uploaded file from Storage, checks the actual size, and converts it into bytes, which are passed onto `verifyAudio()`. 

**How `verifyAudio()` works:** Audio file must be nonempty and no larger than 20 MiB. Only `audio/wav` and `audio/mpeg` are accepted. For WAV files, it checks the expected header markers:
```
Bytes 0-3: RIFF
Bytes 8-11: WAVE
```
This ensures that renaming an arbitrary file into `.wav` will not satisfy this check. After validation, we use the npm package `music-metadata` to parse audio metadata, extracting info such as duration, sample rate, channels, container, and codec. The parsed result must have:
- Expected container: `WAVE` or `MPEG`
- Finite, positive duration
- Sample rate and channel count
- MP3 Layer III codec when the upload is MP3

`verifyAudio()` does not implement full decoding but a structural verification. One may have to note that a file can pass these checks and still contain damaged audio frames or use a WAV codec that a particular browser cannot play.

We finish our workflow with `rpc()`, which calls a PostgreSQL function `finalize_track_upload()` to perform the final checks and database update inside one transaction (maps known database error codes to HTTP responses, checks the returned row, and sends the `ready` response).

### 5. Track becomes playable.