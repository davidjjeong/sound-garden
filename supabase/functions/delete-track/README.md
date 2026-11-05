# Delete a track

Deletes an owned completed track through a retryable Storage/database workflow.

## Contract

Authenticated POST body:

```json
{ "trackId": "<uuid>" }
```

Success: `{ "action": "deleted", "trackId": "<canonical-uuid>" }`.
An absent track returns the same response, including IDs owned by another user;
this does not confirm that another user's track exists or delete their data.
Retry failures with the same track ID, without creating an idempotency key.

## Workflow

1. Handle CORS/method checks, authenticate through `auth.getUser`, and validate the ID.
2. Call service-only `begin_track_deletion` with the authenticated owner. It locks the track and changes ready → deleting, or resumes deleting. Pending uploads return 409.
3. Validate the returned owner, ID, state, MIME, and exact owner/track Storage path before any file removal.
4. Remove that one path through the Storage API. A successful empty result means there was nothing left to remove; any API error returns 503 and retains the row.
5. Call `finish_track_deletion` to remove the deleting row. Database failure returns a retryable error; a retry can remove an already-absent file and finish the row deletion.

The database row is removed last. Each RPC is transactional, but Storage and the
whole workflow are not one atomic transaction. Concurrent requests can remove
the same immutable path; RPC row locks and no-op missing rows permit retries.
A hidden deleting row still counts toward quota until completion. A future UI
must retain the failed track ID and offer retry even when ready-only queries hide it.

Previously issued signed upload tokens are not revoked by deletion. A replay
before token expiry could recreate an orphan at the deleted path; expired-token
cleanup/stronger token lifecycle controls remain separate work. This endpoint
does not delete pending reservations or implement cleanup.

## Activate

1. Apply `supabase/migrations/202611050001_delete_track.sql` after the upload migrations.
2. From the repository root:

   ```sh
   npx supabase functions deploy delete-track --project-ref YOUR_PROJECT_REF
   ```

Hosted Supabase supplies the URL, anon key, and service-role key. Gateway JWT
verification is disabled in config because this handler validates the session
explicitly. Never expose the service-role key in browser code.

## Tests

Run `npm run test:edge` or `npm run test:all`. Cases are listed in
[tests/README.md](../../../tests/README.md). Services/RPCs are mocked: tests do not
execute SQL or prove hosted RLS/concurrency. No real files are deleted by tests.
The browser helper, confirmation dialog, trash button, and playback handling
are the next implementation step.
