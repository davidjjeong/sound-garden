# Clean up expired uploads

Backend-only job removing expired pending uploads, including rejected duplicates.
Ready tracks, unexpired pending rows, and user-requested deletions are excluded.

## Contract

POST with `x-cleanup-secret: <CLEANUP_JOB_SECRET>`; the secret must be at least
32 characters. Ordinary user tokens do not authorize this endpoint. No body or
caller-provided paths/batch size are used. Responses are never cached.

```json
{ "claimed": 10, "deleted": 8, "failed": 1, "leaseLost": 0, "deferred": 1 }
```

200 may include partial failures; inspect counts. Claim/config/auth failures
return 503/500/401 respectively. Non-POST methods return 405.

## Workflow

1. Authenticate the dedicated job secret using fixed-length digest comparison.
2. Claim up to 10 rows with `claim_expired_uploads`. Initial eligibility is pending
   with `upload_expires_at` at least 15 minutes in the past. This assumes the
   reservation endpoint's existing rule: no two-hour token issued with less than
   2 h 15 min remaining. Revisit cleanup eligibility if token issuance changes.
3. SQL locks candidates with `FOR UPDATE SKIP LOCKED`, marks deleting with
   `deletion_reason = expired_upload`, and issues a unique claim token/five-minute lease.
4. Validate owner/ID/MIME/exact Storage path; renew/check the claim before removal.
5. Remove only that object via Storage API. Successful empty removal is accepted;
   errors are not treated as absent files. Only then finish the matching database claim.
6. On failure, schedule a retry after 1, 2, 4, 8… minutes, capped at one hour.
   Crashes or failed rescheduling leave a lease that expires for later reclaim.

Each upstream request has an eight-second timeout. The worker stops starting new
items after 90 seconds; deferred items remain leased and are reclaimable later.
Stale/expired claims cannot renew, reschedule, or finish newer claims. Storage
cannot enforce SQL claim tokens itself, but workers operate only on immutable
expired-upload paths that cannot return to ready through the app.

SQL transactions do not span Storage removal. A timeout may conceal a successful
removal; retries handle missing files. Logs include track ID/stage/attempt, never
secrets or signed URLs. Persistent failures remain retained; no automatic alert
service or maximum-attempt discard is implemented.

## Activate

1. Apply `supabase/migrations/202611050003_upload_cleanup.sql` after prior migrations.
   It also separates/guards user deletion RPCs. No schedule is created by that migration.
2. Generate a random secret locally, for example `openssl rand -hex 32`. Save it in
   Supabase Edge Function secrets as `CLEANUP_JOB_SECRET`. Never expose it in Vite.
3. Deploy:

   ```sh
   npx supabase functions deploy cleanup-uploads --project-ref YOUR_PROJECT_REF
   ```

4. With a controlled expired test reservation, manually POST to the endpoint using
   the job header. This is destructive for eligible rows. Confirm its file/row
   disappear and ready tracks remain.
5. Enable pg_cron/pg_net, store the project URL and same secret in Vault, then run
   `supabase/schedules/upload-cleanup.sql`. It invokes cleanup every 15 minutes.
   Edge secrets and Vault secrets are separate stores and must match.
6. Inspect `cron.job_run_details` for scheduling and `net._http_response` for HTTP
   results; an HTTP 200 with nonzero failed/deferred counts is not all-success.
   Disable with `select cron.unschedule('sound-garden-upload-cleanup');`.

Vault names: `sound_garden_project_url`, `sound_garden_cleanup_secret`. The schedule
stores only a call to a protected dispatcher; actual secrets are read at runtime.
The gateway JWT check is disabled, so keep the job-secret authentication intact.

## Tests and limits

`npm run test:all` runs mocked worker requests and actual SQL in embedded PostgreSQL.
See [tests/README.md](../../../tests/README.md). Scheduling/pg_net/Vault, hosted RLS,
and real multi-session locking require hosted verification. No live cleanup or
schedule was run during implementation.

This handles known pending/retry rows, not orphaned Storage files with no row,
account-deletion leftovers, or retries of user-requested deletion. Those need
separate reconciliation. Current batch/frequency processes at most 40 rows/hour;
adjust only after checking runtime and backlog. Existing uploads with null expiry
are deliberately excluded rather than assumed safe.
