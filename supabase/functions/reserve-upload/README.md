# Reserve an upload

Creates or resumes one user's upload attempt before any bytes are transferred.

## Contract

Authenticated POST body:

```json
{ "idempotencyKey": "<uuid>", "filename": "song.mp3", "sizeBytes": 12345, "contentHash": "<sha256-hex>" }
```

| Action | Meaning | Browser next step |
|---|---|---|
| `upload` | Pending reservation; file absent | Use returned `{ bucket, path, token }`, then finalize |
| `finalize` | Pending reservation; file exists | Skip transfer and finalize |
| `ready` | This attempt already completed | Show the returned track |

Each response includes `track: { id, title, status, storagePath, mimeType,
sizeBytes, expiresAt }`. Reuse the **same key** when retrying uncertain requests.
A new key represents a new attempt. The optional browser hash is an early-check hint; matching a verified ready track for the same owner rejects with 409 / `DUPLICATE_TRACK`.

## Workflow

1. Handle CORS/method checks, validate the session through `auth.getUser`, then validate UUID, extension, filename length, and size (1 byte–20 MiB).
2. Call service-only `reserve_track_upload` with the authenticated user. Its transaction serializes per-user reservations, checks key reuse, reserves a unique path, and enforces the 100 MiB quota.
3. Validate the returned owner/path/size/MIME. Ready tracks return immediately; deleting/expired reservations are rejected.
4. Check Storage existence. Existing bytes return `finalize`; missing bytes allow signing only with at least 2 h 15 min left in the 4-hour reservation.
5. Return a signed upload token with overwrite disabled. Upstream existence/signing failures return retryable 503 responses.

The quota counts pending/ready/deleting rows, including abandoned reservations.
The `cleanup-uploads` worker removes eligible expired pending rows once its migration/deployment/schedule are activated. This endpoint does not upload bytes, inspect audio,
or mark tracks ready. Database and Storage operations are separate steps.

## Activate

1. Apply the reservation schema prerequisites and migrations `202611030001_reserve_upload.sql` and `202611030002_reservation_errors.sql` once. The full protected workflow also needs `202611030003_finalize_upload.sql` and the finalization endpoint.
2. Deploy from the repository root:

   ```sh
   npx supabase functions deploy reserve-upload --project-ref YOUR_PROJECT_REF
   ```

Hosted Supabase supplies URL/anon/service-role environment variables. Config
disables gateway JWT verification; this handler explicitly validates the user.
Never expose the service-role key to the browser.

## Tests

`npm run test:edge` runs the reservation/finalization suites. See
[the test case inventory](../../../tests/README.md#edgereserve-uploadtestts--reservation-and-signed-upload-routing).
Tests mock Supabase HTTP responses; real RPC transactions, RLS, signed tokens,
and concurrent quota/idempotency behavior require hosted integration checks.

See [duplicate prevention](../../../docs/duplicate_prevention.md) for the new migration, rollout, and backfill requirements.
