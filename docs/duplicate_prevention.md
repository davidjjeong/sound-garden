# Exact-file duplicate prevention

A user may have only one **ready** track with a given server-verified SHA-256.
Renaming identical bytes does not bypass this rule. Different users may store
the same file. Changed tags, encodings, or other byte changes are distinct files;
this does not perform acoustic fingerprinting.

## Code flow

1. `src/lib/contentHash.ts` hashes the File and caches the promise per File object.
2. `reserveUpload` includes `contentHash`; `reserve-upload` passes it to the reservation RPC.
3. The RPC checks the original idempotency attempt first. A completed-attempt retry returns that track. It then rejects a hint matching another ready track for this owner before creating a row/signing a token. Legacy callers may omit the hint.
4. The hint is stored separately as `claimed_sha256`; it never becomes verified metadata. Changing a previously stored claim for the same attempt conflicts.
5. `finalize-upload` hashes downloaded bytes after audio verification, ignoring any client-supplied hash. It calls the new five-argument finalization RPC.
6. The RPC writes `content_sha256` while marking ready. A partial unique index on `(user_id, content_sha256)` for ready rows enforces the invariant even across concurrent requests. A conflict rolls back that update and produces `SGDUP`.
7. Both endpoints translate `SGDUP` to HTTP 409 / `DUPLICATE_TRACK`. The browser displays “This file is already in your library.” without Retry; other uncertain failures retain retry identity.

## Rejected uploads and deletion

An early rejection transfers no new audio. A finalization rejection leaves the
redundant file/row pending, with its original expiry, and still counted in quota.
Do not immediately remove it: issued signed upload tokens may still be valid.
Expired pending cleanup is implemented in `cleanup-uploads` but requires its
migration, deployment, secrets, and optional schedule to be activated. It waits
until reservation expiry plus grace; pending copies count toward quota until removed. A deleting track releases its ready-only hash slot.

## Activate (not performed by this change)

1. Temporarily stop new uploads while updating the RPC signatures. Apply
   `supabase/migrations/202611050002_track_deduplication.sql` once, after the previous migrations.
2. Deploy both changed functions before resuming uploads:

   ```sh
   npx supabase functions deploy reserve-upload --project-ref YOUR_PROJECT_REF
   npx supabase functions deploy finalize-upload --project-ref YOUR_PROJECT_REF
   ```

3. Run the updated frontend. Old callers that omit a hint still face authoritative finalization checks.
4. Backfill existing ready tracks before claiming complete coverage (below).
5. Verify renamed identical files reject, different bytes accept, a successful upload can retry, and another user can upload the same file.

The migration removes the old four-argument finalization function, so an old
endpoint must be redeployed. It does not delete audio or alter existing ready rows.

## Existing-track backfill

Existing hashes start null; those tracks cannot be detected as duplicates until
backfilled. `scripts/backfill-content-hashes.ts` pages through unhashed ready rows,
downloads and structurally verifies bytes, and uses the same object-version-aware
finalization RPC to save hashes. Backend credentials are supplied through shell
environment variables; never put the service-role key in a `VITE_` variable.

From the project root, first read/check only:

```sh
.tools/deno/node_modules/.bin/deno run --allow-env --allow-net --config supabase/functions/deno.json scripts/backfill-content-hashes.ts
```

After inspecting the output, add `--apply` to save verified hashes. Neither mode
deletes files. Failures/legacy duplicates print track IDs and cause a nonzero exit.
Resolve existing duplicates through the protected deletion workflow and rerun.
The tool has **not been run** against your project.

## Verification

`npm run test:all` includes browser hashing/errors, mocked endpoint contracts, and
`tests/database/deduplication.test.ts`. That test runs actual migrations/functions
in PGlite's embedded PostgreSQL engine: same-owner duplicate rejection, ready
uniqueness, rejection rollback/expiry retention, retry identity, differing content,
other owners, forged claims, malformed verified hashes, legacy backfill, and
releasing the hash on deleting. It exercises two pending copies finalized in
sequence; PGlite is a single-session engine, so this is not a hosted concurrent-
transaction test. Real Supabase RLS, multi-session locking, Storage, and deployment
integration still require live verification.
