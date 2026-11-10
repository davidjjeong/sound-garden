# Upload workflow tests

```sh
npm test               # browser + embedded PostgreSQL tests (Vitest)
npm run test:watch     # browser tests while editing
npm run test:edge      # endpoint/audio tests (Deno)
npm run test:all       # both suites
```

Run from the repository root after `npm ci`. Edge tests use the local Deno binary
at `.tools/deno/node_modules/.bin/deno`, the shared `supabase/functions/deno.json`
imports, and a temporary Deno cache. VS Code enables Deno for `tests/edge/` only.
All services are mocked: no credentials, live uploads, or deletions are used.

## Layout

```text
tests/
├── browser/
│   ├── TrackLibrary.test.ts
│   ├── tracks.test.ts
│   └── useTrackUpload.test.ts
└── edge/
    ├── delete-track.test.ts
    ├── helpers.ts
    ├── reserve-upload.test.ts
    └── finalize-upload.test.ts
```

## Browser cases

### `browser/useTrackUpload.test.ts` — orchestration and React lifecycle

- Reserve → transfer → verify occurs in order; completion waits for verification.
- Uncertain transfer: retry retains the original file/key; an existing object skips reupload.
- Lost finalization response: an already-ready reservation completes without repeating transfer/verification.
- Reservation failure stops transfer and verification; error text reaches the UI.
- Rapid second submission and retry while busy do not start another operation.
- Reset while busy is ignored; reset after failure clears the retained retry.
- Retry before any attempt is a no-op.
- Unmount during reservation stops transfer; unmount during transfer stops verification.
- Empty files, unsupported extensions, files over 20 MiB, and names over 255 characters are rejected locally.
- Uppercase WAV and exactly 20 MiB are accepted by local validation.
- Selecting the same file again creates a fresh key; verified hash checks separately enforce content deduplication.

### `browser/tracks.test.ts` — Supabase helper contracts

- Reservation sends the supplied key, filename, and byte count unchanged.
- Rejects mismatched signed paths, empty tokens, pending tracks labeled ready, and reserved size mismatches.
- Rejects null/unknown responses, missing/invalid pending expiry, and fractional sizes.
- MP3/WAV transfer normalizes Blob MIME; signed upload uses the expected bucket/path/token and `upsert: false`.
- Wrong bucket, blank token, traversal path, and mismatched extension stop before Storage access.
- Empty, unsupported, and oversize transfer inputs stop before Storage access.
- Transfer errors remain uncertain/retryable; the helper performs one transfer and no finalization.
- Invalid finalization IDs stop before invocation.
- Rejects pending tracks, wrong IDs, and wrong actions in finalization responses; accepts the expected ready track.
- JSON endpoint errors retain useful messages; non-JSON HTTP failures and transport failures reject safely.

### `browser/TrackLibrary.test.ts` — deletion interaction

- Trash opens a named confirmation with Cancel focused; no deletion occurs before confirmation.
- Cancel and Escape close without calling the endpoint.
- Success removes only the target, updates the count, and shows the empty state for the last track.
- In-flight deletion disables confirmation/cancel and blocks duplicate clicks and Escape dismissal.
- Failure remains retryable after closing/reopening; retry uses the original track ID.
- Native dialog visibility is simulated in jsdom; actual focus trapping/restoration and appearance need a browser check.

Additional `tracks.test.ts` deletion cases: invalid IDs stop locally; valid calls send
only trackId; null/wrong-action/wrong-ID responses fail; server errors are preserved.

## Edge cases

### `edge/helpers.ts` — shared test utilities

Restores environment variables and mocked fetch after each suite. Registers the
following request guards for **all three endpoints**:

- OPTIONS → 204 with CORS; GET/PUT → 405; no upstream calls.
- Missing, Basic, empty Bearer, and multi-token authorization → 401 before upstream calls.
- Missing service-role configuration → 500 before upstream calls.
- Auth rejection/session missing → 401; Auth service failure → 503.
- Malformed JSON, null, array, string, and missing-field bodies → 400 after authentication only.
- Error responses include CORS/no-store headers where asserted.

### `edge/reserve-upload.test.ts` — reservation and signed-upload routing

- New MP3, uppercase WAV, 1-byte minimum, and exact 20 MiB maximum produce upload authorization.
- Existing object returns `finalize`, including near expiry; ready track returns `ready`.
- Deleting → 409; expired/null/invalid expiry → 410.
- Missing object with less than 2 h 15 min remaining rejects signing, including just below the boundary.
- Storage HEAD 400/404 means missing and permits signing; HEAD 403 returns retryable 503.
- Failed signing or a response without a token returns 503.
- RPC input/conflict/expiry/quota codes map to 400/409/410/413; unknown failures → 500.
- Null RPC row, wrong owner/path/size/MIME, and invalid track ID → 500 before signing.
- Bad/null key, unsupported/null/overlong filename, zero/negative/fractional/string/null/oversize byte count → 400 before reservation.
- RPC receives the authenticated owner and original key; upload output uses the expected path/token.
- Non-upload routes never sign; signing never enables overwrite; reservation never calls finalization.

### `edge/finalize-upload.test.ts` — verification and ready transition

- Owner filter is present; missing track → 404; ready retry → 200 without Storage access.
- Expired/invalid expiry → 410; deleting/invalid path → 409.
- Metadata size/MIME mismatch → 422; missing object → 409; inspection failure → 503.
- Missing object version → 503; failed download → 503; downloaded size mismatch → 422.
- Invalid audio → 422 before the finalization RPC.
- RPC conflict/expiry/missing/invalid-object codes map to 409/410/404/422; unknown RPC failure → 503.
- Invalid non-ready RPC result → 500; valid verification calls RPC with owner/object version and returns ready.
- Only the valid scenario records a successful mocked commit.
- Generated PCM WAV and synthetic MP3 frames pass format recognition; mislabeled/random content fails.
- Empty/oversize audio, unsupported MIME, truncated WAV header, missing RIFF/WAVE markers, and zero sample data fail.

### `edge/delete-track.test.ts` — protected, retryable deletion

- Missing/unowned track returns indistinguishable success without Storage access.
- Successful MP3/WAV deletion calls begin → Storage remove → finish, with the authenticated owner and exact path.
- Pending upload conflict → 409; begin RPC failure → 503; neither removes files.
- Wrong returned owner/ID/state/MIME/path or malformed row → 500 before Storage access.
- Missing file (successful empty removal) still finishes database deletion.
- Storage failure, thrown transport error, or ambiguous 404 → 503 without calling finish.
- Finish conflict → 409; finish failure → 503 and remains retryable.
- Lost finish response retries against the now-missing row without another removal.
- Retry after Storage failure completes both steps; retry after finish failure handles the already-absent file.
- Additional client owner/path fields are ignored; IDs are canonicalized.
- Shared HTTP/auth/body guards also apply to this endpoint.

## Coverage limits

Browser and edge suites execute helpers/hooks and endpoint code, **not hosted PostgreSQL**. The local database suite described below additionally executes SQL.
RPC errors and returned rows are simulated; the tests do not prove SQL correctness,
RLS isolation, idempotency uniqueness, concurrent quota enforcement, row locking,
real signed-token expiry, or real object replacement during verification.

Those require a separate Supabase integration test project and two test users.
Also outstanding: UI-level upload/playback checks, full audio decoding/browser
codec compatibility, hosted cleanup scheduling/integration, active-track playback cleanup, and hosted multi-session deduplication checks. No test claims unimplemented features exist. Audio recognition is
structural, not proof that every audio frame decodes.


## Duplicate-prevention coverage

- `browser/contentHash.test.ts`: known SHA-256 vector, identical renamed bytes,
  different bytes, and cached retries.
- Browser helper/hook tests: hash in reservation request, typed duplicate errors
  from either endpoint, no retry after duplicate rejection, new attempts still
  receive distinct idempotency keys.
- Edge tests: valid/invalid hints, duplicate error mapping, and finalization hash
  computed from actual downloaded bytes rather than the request hint.
- `database/deduplication.test.ts`: executes the SQL migrations/functions in
  embedded PostgreSQL (PGlite), checking per-user uniqueness, two pending copies,
  rollback/expiry retention, retries, differing content, other users, forged
  claims, invalid hashes, legacy backfill, and release on deletion.

The earlier mocked-test coverage limits still apply to hosted SQL/RLS/Storage.
The database suite now executes SQL locally, but PGlite uses one session and
cannot prove live multi-session concurrency. Full rollout/backfill and cleanup
limits are documented in [duplicate prevention](../docs/duplicate_prevention.md).


## Expired-upload cleanup coverage

- `edge/cleanup-uploads.test.ts`: method/job-secret guards, missing configuration,
  empty work, successful/missing-file removal, mixed batch failures, invalid
  owner/path/reason, lost lease, renewal/removal/completion failures, and retry
  scheduling failure. Checks removal ordering and exact Storage paths.
- `database/upload-cleanup.test.ts`: executes the migration in PGlite. Tests expiry
  plus grace, unexpired/ready/null-expiry exclusions, user-deletion separation,
  active leases, expired lease reclaim, token replacement, stale-worker fencing,
  renewal, exponential retry delay/cap, matching completion, missing-row completion,
  batch limits, finalization rejection after claim, and restricted execution.
- Scheduler setup is optional SQL under `supabase/schedules/`, not an enabled
  migration. pg_cron/pg_net/Vault and genuine multi-session SKIP LOCKED behavior
  require hosted verification. No live files are deleted by these tests.


## Playback coverage

See [playback workflow](../docs/playback_workflow.md) for architecture and the
isolated real-browser preview command. `browser/useAudioPlayback.test.ts` covers
media state, source signing/expiry, stale async work, autoplay/failure recovery,
seek/volume, ended restart, deletion, and unmount. `browser/AudioPlayer.test.ts`
covers accessible controls/disabled states/errors; library/helper tests cover
selection, deletion callbacks, private-path signing, and malformed URLs.
The preview uses generated silent audio and no hosted data; personal-library
codec/access verification still requires a signed-in browser.


## Web Audio engine coverage

- `browser/audioEngine.test.ts`: source → gain → analyser → speakers connection,
  suspended/running context resume behavior and failures, volume clamping and
  smoothing, invalid-volume rejection, reusable 2048-sample waveform buffer, and
  disconnect/close order.
- Playback-hook tests now mock the engine independently of the media element.
  Volume assertions target gain and UI state; element volume remains at 1. Tests
  cover lazy creation, one engine across track switches, volume set before play,
  resume-before-play ordering, pause/deletion/unmount during pending resume,
  recoverable resume failure, waveform access, and disposal on unmount only.
- Player component fixtures include `readWaveForm`; the Three.js renderer remains
  outside these changes. Web Audio nodes are mocked, so audible output, real
  autoplay rules, and cross-origin analyser samples require browser verification.
