# System Architecture

This markdown file is intended to explain the high-level design of the web app and the specific workflows each part of the system follows.

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
### 5. Track becomes playable.