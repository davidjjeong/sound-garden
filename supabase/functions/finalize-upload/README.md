# Finalize an upload

Verifies uploaded audio and makes its reserved track visible in the library.

## Contract

Authenticated POST body:

```json
{ "trackId": "<uuid>" }
```

Success: `{ action: "ready", track: { id, title, status, storagePath, mimeType,
sizeBytes, expiresAt } }`. An already-ready track returns the same result without
repeating verification, so a lost response can be retried safely.

## Workflow

1. Handle CORS/method checks, authenticate with `auth.getUser`, and validate the track ID.
2. Load the track by ID **and authenticated owner**. Pending tracks must be unexpired; deleting tracks cannot finalize.
3. Check the reserved path/type/size and Storage metadata. Download the file, compare actual size, and recognize MP3/WAV structure using `music-metadata`.
4. Call service-only `finalize_track_upload`. In one transaction it locks the track, rechecks status/expiry, locks the Storage metadata, and compares object ID/version/size/MIME.
5. Commit `status = 'ready'`, `ready_at`, and null `upload_expires_at`; return the browser's ready-track contract.

The database transition is atomic; the whole Storage upload is not a distributed
transaction. Future deletion/cleanup must coordinate through the track state.
Invalid files remain pending and count toward quota; cleanup is not implemented.
Existing ready tracks are not retrospectively verified. Structure checks are not
full decoding or a guarantee of browser codec support.

## Activate

1. After the reservation migrations, run `supabase/migrations/202611030003_finalize_upload.sql` once. It creates the service-only RPC and prevents direct browser track/audio writes; signed uploads remain supported.
2. Deploy from the repository root:

   ```sh
   npx supabase functions deploy finalize-upload --project-ref YOUR_PROJECT_REF
   ```

Hosted Supabase supplies URL/anon/service-role environment variables. Config
disables gateway JWT verification; this handler explicitly validates the user.
Never expose the service-role key to the browser.

## Tests

`npm run test:edge` runs the reservation/finalization suites. See
[the test case inventory](../../../tests/README.md#edgefinalize-uploadtestts--verification-and-ready-transition).
Tests use generated audio and mocked HTTP responses. SQL execution, RLS, locking,
object replacement races, and actual playback still need integration checks.
