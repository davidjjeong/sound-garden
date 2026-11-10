# Cleanup Workflow

Cleanup is needed to remove track uploads that never became `ready` and are too old to continue (expired). These include:
- Abandoned uploads
- Duplicate copies rejected by the server endpoint during finalization

**Core Feature:** Removes the audio file in Storage and its row in `tracks` table.

## High-level Overview
1. Runs every 15 minutes, once the schedule is enabled.
2. Find up to 10 expired uploads. Only pending uploads whose reservation expired at least 15 min ago qualify. Completed tracks are left alone.
3. Reserve those uploads for the cleanup run, so another work won't process them at the same time.
4. Delete each audio file from Storage.
5. Delete its database row only after the file removal succeeds.
6. Retry failures later. If a file or row can't be removed, keep its record so the next run can try again.

Cleanup implementation has three main parts:
- SQL decides which uploads may be deleted and who is currently processing them.
- Edge Function removes the files and coordinates the SQL operations.
- Scheduler periodically invokes this Edge Function.

### 1. Cleanup migration
File: `202611050003_upload_cleanup.sql`

**A. Fields tracking cleanup progress:** We create additional fields to track cleanup progress and distinguish user-initiated and cleanup-initiated deletions of tracks:
- `deletion_reason`: `user` (user deletion) or `expired_upload` (pending upload expired)
- `cleanup_after`: timestamp when cleanup can try deleting this row
- `cleanup_lease_until`: timestamp until when the current worker owns this cleanup task
- `cleanup_claim_token`: `uuid` (which particular attempt owns it?)
- `cleanup_attempts`: how many times has cleanup claimed it

**B. Changes to user-deletion functions:**
When a user deletes a ready track,
```sql
set status = 'deleting',
    deletion_reason = 'user'
```
User deletion rejects cleanup-owned rows:
```sql
if v_track.status not in ('ready', 'deleting')
   or v_track.deletion_reason = 'expired_upload' then
  raise exception ...
end if;
```
Finishing function requires the user reason:
```sql
if v_track.status <> 'deleting'
   or v_track.deletion_reason is distinct from 'user' then
  raise exception ...
end if;
```

**C. `claim_expired_uploads`:** accepts batches from 1 to 25 (default 10).
```sql
claim_expired_uploads(p_batch_size integer default 10)
```
It finds two categories of work to cleanup:

**First-time cleanup:** Upload must be pending and must have expired at least 15 min ago. Ready track does not qualify, and a pending track with null expiry also doesn't since database cannot establish whether it is safe to remove or not. 
```sql
t.status = 'pending'
and t.upload_expires_at
    <= clock_timestamp() - interval '15 minutes'
```

**Previously attempted cleanup:** Cleanup tasks whose retry time has arrived and no active lease exists.
```sql
t.status = 'deleting'
and t.deletion_reason = 'expired_upload'
and t.cleanup_after <= clock_timestamp()
and (
  t.cleanup_lease_until is null
  or t.cleanup_lease_until <= clock_timestamp()
)
```

Once these rows are identified, we select a bounded batch, prioritizing older work. Selected rows are locked during this transaction, and we ensure that an overlapping invocation skips rows another transaction is claiming. 
```sql
order by coalesce(t.cleanup_after, t.upload_expires_at), t.id
limit p_batch_size
for update skip locked
```

Selected rows are updated in the same transaction by the following:
```sql
status = 'deleting',
deletion_reason = 'expired_upload',
cleanup_after = clock_timestamp(),
cleanup_lease_until =
  clock_timestamp() + interval '5 minutes',
cleanup_claim_token = gen_random_uuid(),
cleanup_attempts = t.cleanup_attempts + 1
```

Function returns these rows to the Edge Function.

**D. `renew_upload_cleanup`:** Extends the lease only if the worker still owns the task.
```sql
renew_upload_cleanup(p_track_id uuid, p_claim_token uuid)
```
Returns `true` if it updated the row, otherwise `false`.

**E. `finish_upload_cleanup`:** Removes the database row. Edge function calls this after Storage removal succeeds.
```sql
finish_upload_cleanup(p_track_id uuid, p_claim_token uuid)
```

**F. `retry_upload_cleanup`:** On failure, this function sets a future retry time, clears the lease, clears the claim token, and retains the track and its Storage path.

Delay (future retry time) is calculated by:
```sql
least(
  3600,
  60 * power(2, least(cleanup_attempts - 1, 6))
)
```

### 2. Cleanup edge function
File: `cleanup-uploads/index.ts`

**A. Authorize the job:** Accepts POST requests and requires:
```
x-cleanup-secret: <configured secret>
```
where the expected value comes from:
```typescript
Deno.env.get("CLEANUP_JOB_SECRET")
```
It uses a separate backend-only credential to authorize, as cleanup can operate across users.

**B. Create a privileged client with request timeouts:** 
```typescript
const boundedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: AbortSignal.timeout(8000),
  });
```
Each upstream call gets an eight-second timeout, preventing one stalled request occupying the invocation indefinitely.

**C. Claim a batch:** 
```typescript
await admin.rpc("claim_expired_uploads", {
  p_batch_size: 10,
});
```
Endpoint rejects an error or malformed batch response rather than continuing with expected data.
We report the outcome of the invocation as follows:
```typescript
const counts = {
  claimed: rows.length,
  deleted: 0,
  failed: 0,
  leaseLost: 0,
  deferred: 0,
};
```

**D. Bound processing time:** Current processing time is set to be 90s. Before starting each work, we check if it surpasses the processing bound allowed. If so, the row is deferred and remains leased until expiry. Later invocation can reclaim them.

**E. Validate each row before touching Storage:** Worker checks:
- Track ID and claim ID are UUIDs.
- Owner ID is a UUID.
- Status is `deleting`.
- Reason is `expired_upload`.
- MIME type is MP3 or WAV.
- Storage path exactly matches the owner, track ID, and extension.

**F. Renew, remove, finish:** We call `renew_upload_cleanup` to extend the lease for the worker's task (skip the item if ownership is lost), remove the audio from Storage, and then call `finish_upload_cleanup`.

---

## Cleanup activation verification — November 10, 2026

Project: sound-garden. The cleanup SQL migration is applied, the Edge Function
is deployed, and the `sound-garden-upload-cleanup` cron job is active every
15 minutes. pg_cron/pg_net are enabled. The job secret is configured in Edge
secrets and Vault; no credential values are recorded here.

### Local checks

`npm run test:all`: 67 browser/database tests and 15 edge tests with 155 steps
passed. An incomplete temporary Deno dependency cache was rebuilt; no application
code needed changing.

### Controlled hosted integration test

Created five disposable track rows under the existing account, with generated
PCM WAV files where appropriate. No signed upload tokens were issued for these
fixtures, so historical expiry timestamps were safe to use in this test.

| Case | Result |
|---|---|
| Pending, expired 20 minutes ago, file present | File and row deleted |
| Pending, expired 20 minutes ago, file missing | Row deleted |
| Pending, expired 5 minutes ago | File and row retained |
| Pending, unexpired | File and row retained |
| Ready control | File and row retained |
| Missing/incorrect job secret | HTTP 401 |

First invocation: claimed 2, deleted 2, failed 0, leaseLost 0, deferred 0.
Second invocation: all counts 0. Remaining fixture files/rows were explicitly
removed after verification. Original library IDs/statuses matched the baseline;
the original ready track was untouched.

### Scheduler path

Manually invoked `public.invoke_upload_cleanup()` after Vault/schedule setup.
The resulting pg_net HTTP response was 200 with all counts 0 and no network
error. Verified cron job active with schedule `*/15 * * * *`. This verifies the
dispatcher and configuration; it does not claim a timed cron firing was observed.

Inspect `cron.job_run_details`, `net._http_response`, and Edge Function logs to
monitor future runs. Partial failure counts still require attention. Orphan-file
reconciliation and automatic retry of user-requested deletions remain outside
this worker's scope.
