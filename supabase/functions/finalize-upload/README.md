# Finalize an uploaded track

The browser's existing `finalizeUpload(trackId)` helper calls this function with
`{ "trackId": "<uuid>" }` and the signed-in user's access token. A successful
response is `{ action: "ready", track: { id, title, status, storagePath,
mimeType, sizeBytes, expiresAt } }`, matching the existing browser contract.

The endpoint authenticates the token, loads only that user's reservation, and
returns immediately for an already-ready track. Pending reservations must be
unexpired. The stored object's size and MIME type must match the reservation.
The function downloads at most the reserved 20 MiB and checks recognizable
MP3/WAV structure with music-metadata. This is not a full audio decoder and does
not guarantee every browser can play a file or that every frame is uncorrupted.

The service-only `finalize_track_upload` RPC locks the track, checks expiry again,
locks and compares the Storage object's ID/version and metadata, and commits
`status = 'ready'`, `ready_at`, and a null `upload_expires_at` atomically. Concurrent
retries return the same ready track. Storage and Postgres are not one distributed
transaction: this guards the database state transition without claiming uploads
are atomic. Future deletion/cleanup must lock the track before deleting its file.

Invalid audio remains pending and counts toward quota; automatic expired-upload
cleanup is a separate feature. Existing ready rows are not retrospectively checked.

## Activate

1. Run `supabase/migrations/202611030003_finalize_upload.sql` once in the hosted
   project's SQL editor (after the earlier reservation migrations). It revokes
   direct browser track writes and restricts direct writes to the audio bucket;
   signed uploads and backend operations remain the intended path.
2. From the repository root, deploy with:

   ```sh
   npx supabase functions deploy finalize-upload --project-ref YOUR_PROJECT_REF
   ```

   The committed config disables the gateway JWT check because this function
   explicitly validates the session using `auth.getUser`. Do not remove that
   application authentication check. Hosted Supabase supplies the URL, anon key,
   and service-role key; never expose the service-role key to the frontend.
3. Sign in and upload an MP3/WAV. Check pending -> ready, playback, retry, and
   isolation with a second account. Hosted SQL and Storage integration still need
   this verification; local tests mock those services.

## Local checks

```sh
DENO_DIR=/private/tmp/sound-garden-deno-cache .tools/deno/node_modules/.bin/deno test --allow-env --config supabase/functions/deno.json supabase/functions/finalize-upload/index_test.ts
```

Tests cover audio structure, missing authentication, ownership query filtering,
already-ready retries, invalid audio preventing the RPC, and the success response.
