# Concurrent duplicate-upload benchmark

## Results — November 12, 2026

**All four live batches passed**, using normal authenticated access to the hosted
Supabase endpoints and a dedicated test account.

[Raw evidence: run-3846def1-78b5-46d5-a6ef-59990b901e0e.json](run-3846def1-78b5-46d5-a6ef-59990b901e0e.json)

| Batch | Concurrent attempts | Transfers started | Ready rows | Duplicate responses | Unexpected errors |
|---|---:|---:|---:|---:|---:|
| Full workflow | 2 | 2 | 1 | 1 | 0 |
| Full workflow | 5 | 5 | 1 | 4 | 0 |
| Full workflow | 10 | 10 | 1 | 9 | 0 |
| Reservation barrier | 10 | 10 | 1 | 9 | 0 |

Across 27 attempts, four unique fixtures produced **four ready tracks and 23
expected HTTP 409 duplicate responses**. Every duplicate was rejected during
finalization. All attempts reached Storage transfer; this is stronger evidence
of finalization race handling than reservation-only rejection. It still does not
prove exact overlap of byte transfers or server transactions.

Database queries confirmed one ready row per fixture hash. All 27 known Storage
objects downloaded successfully and matched their fixture SHA-256, including
all four winners. The pending duplicate rows and files remained present, as
expected immediately after the race.

**Cleanup remains deferred, not verified:** 23 pending duplicate rows/files await
expiry, the configured grace period, and the scheduled cleanup worker. They were
not deleted early. Cross-user isolation and failure-injection recovery were not
part of this live run.

These small-fixture tests measure correctness under concurrency, not production
capacity, large-file performance, or a general upload success rate. The durations
in the raw report cover workflow attempts and exclude the post-run verification
reads; they should not be presented as an upload-throughput benchmark.

## What the experiment does

For one dedicated test user, submit independent upload attempts for identical
bytes with different idempotency keys. Each batch uses a new generated WAV and
SHA-256, avoiding collisions with earlier batches or personal audio.

Run these bounded batches:

1. Two complete workflows concurrently.
2. Five complete workflows concurrently.
3. Ten complete workflows concurrently.
4. Ten concurrent reservations, then a barrier before transfers and finalization.

The fourth batch deliberately allows reservations to finish before any transfer
starts, stressing server-side finalization races. It uses the real endpoints,
not direct database writes. It is a coordinated stress test, not a measurement
of normal user request scheduling.

Each fixture is a generated one-second, 8 kHz mono PCM WAV: 16,044 bytes. The run
contains at most 27 attempts and roughly 423 KiB of fixture transfer if all reach
Storage. It is not a load-capacity or upload-throughput benchmark.

## Credentials

Create `.env.benchmark.local` at the repository root:

```dotenv
BENCHMARK_EMAIL=YOUR_DEDICATED_TEST_ACCOUNT
BENCHMARK_PASSWORD=YOUR_TEST_PASSWORD
```

This file is ignored by the existing `.env.*` rule. Never commit it or put
credentials in command arguments, reports, or chat. The runner also loads the
existing `.env.local` for the Supabase URL and publishable key.

Use a confirmed, dedicated account. The runner signs in with normal user access;
it does not use a service-role key, create accounts, alter policies, or bypass RLS.
It creates test rows/files and leaves them for verification and normal cleanup.

## Run

Requires Node.js with `process.loadEnvFile` support and installed dependencies.
From the repository root:

```sh
node scripts/upload-benchmark.mjs --run
```

The runner stops after an unsuccessful batch and saves available evidence. It
does not retry uncertain uploads automatically: fresh retries could obscure the
initial race results. SDK errors and raw response bodies are not exported because
they may contain sensitive request details.

## Verification

For each batch, require:

- Exactly one ready response and N−1 expected `DUPLICATE_TRACK` outcomes.
- No unexpected request/contract errors.
- Exactly one ready database row for the authenticated user and fixture hash.
- That row's verified server hash equals the fixture hash.
- Its Storage file downloads successfully and hashes to the original bytes.

Record the stage of each duplicate response and how many transfers actually
started. Ten concurrent attempts does not necessarily mean ten simultaneous
transfers: reservations can reject duplicates before transfer.

The report also records all matching pending rows and known file states. Surviving
pending copies are not immediate deduplication failures: signed-upload tokens
remain usable until expiry, so the existing cleanup workflow deliberately waits
until expiry plus grace. This runner never deletes them prematurely.

## Cleanup verification

After the pending reservations expire, the cleanup grace elapses, and the normal
scheduled worker runs, use the same test account for a read-only check:

```sh
node scripts/upload-benchmark.mjs --recheck \
  metrics/concurrent-uploads/run-RUN_ID.json
```

This retrieves the current row states and checks previously recorded object IDs
at their owner-scoped paths. Save the recheck report before claiming cleanup
success. A missing/unreadable object is not assumed absent unless Storage reports
404; other errors are marked unverified.

Ready winner tracks are intentionally retained. Delete only those test tracks
through the application's normal deletion flow when finished reviewing results.

## Evidence and limits

Reports include generated fixture hashes, attempt keys, track IDs, status codes,
outcome categories, durations, row states, and downloaded-file hash checks.
They exclude login credentials, bearer/signed-upload tokens, email addresses,
and the owner-ID Storage prefix. Fixture audio is generated, not user music.

A per-batch `passed` value verifies immediate same-user deduplication and the
winner file. It does **not** certify deferred cleanup, another user's isolation,
production capacity, or success under every network failure.

Cross-user upload independence remains a separate experiment requiring a second
test identity. Reservation barriers make requests overlap at the client; they do
not prove exact simultaneous scheduling inside hosted PostgreSQL.

## Automated tests

`tests/browser/uploadBenchmark.test.ts` checks WAV generation, distinct keys,
workflow/barrier orchestration, duplicate handling before transfer, failure
classification, and omission of secret response data. Its Supabase responses are
mocked and must not be represented as hosted concurrency results.
