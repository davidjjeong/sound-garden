import { createClient } from "@supabase/supabase-js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

async function authorized(supplied: string, expected: string) {
  const encoder = new TextEncoder();
  const a = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
  );
  const b = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  );
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export async function handleRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const secret = Deno.env.get("CLEANUP_JOB_SECRET");
  if (!secret || secret.length < 32) {
    return json({ error: "Cleanup authorization is not configured" }, 500);
  }
  const supplied = request.headers.get("x-cleanup-secret");
  if (!supplied || !(await authorized(supplied, secret))) {
    return json({ error: "Unauthorized" }, 401);
  }
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) {
    return json({ error: "Server configuration is incomplete" }, 500);
  }
  // Bound every upstream call. A failed request may have completed remotely;
  // matching claim tokens and lease expiry handle that uncertainty.
  const boundedFetch: typeof fetch = (input, init) =>
    fetch(input, {
      ...init,
      signal: AbortSignal.timeout(8000),
    });
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: boundedFetch },
  });
  try {
    const { data: rows, error } = await admin.rpc("claim_expired_uploads", {
      p_batch_size: 10,
    });
    if (error || !Array.isArray(rows) || rows.length > 10) {
      return json({ error: "Could not claim cleanup work; retry later" }, 503);
    }
    const counts = {
      claimed: rows.length,
      deleted: 0,
      failed: 0,
      leaseLost: 0,
      deferred: 0,
    };
    const deadline = Date.now() + 90000;
    for (const row of rows) {
      if (Date.now() >= deadline) {
        counts.deferred++;
        continue;
      }
      const validClaim = record(row) && typeof row.id === "string" &&
        uuid.test(row.id) &&
        typeof row.cleanup_claim_token === "string" &&
        uuid.test(row.cleanup_claim_token);
      const args = validClaim
        ? { p_track_id: row.id, p_claim_token: row.cleanup_claim_token }
        : null;
      let stage = "validation";
      try {
        if (
          !validClaim || typeof row.user_id !== "string" ||
          !uuid.test(row.user_id) ||
          row.status !== "deleting" ||
          row.deletion_reason !== "expired_upload" ||
          !["audio/mpeg", "audio/wav"].includes(String(row.mime_type)) ||
          row.storage_path !==
            `${row.user_id}/${row.id}.${
              row.mime_type === "audio/mpeg" ? "mp3" : "wav"
            }`
        ) {
          throw new Error("Invalid cleanup claim");
        }
        stage = "lease";
        const renewed = await admin.rpc("renew_upload_cleanup", args!);
        if (renewed.error) throw new Error("Renewal failed");
        if (renewed.data !== true) {
          counts.leaseLost++;
          continue;
        }
        stage = "storage";
        const removal = await admin.storage.from("audio").remove([
          row.storage_path,
        ]);
        if (removal.error) throw new Error("Removal failed");
        stage = "finish";
        const finished = await admin.rpc("finish_upload_cleanup", args!);
        if (finished.error) throw new Error("Completion failed");
        if (finished.data !== true) {
          counts.leaseLost++;
          continue;
        }
        counts.deleted++;
      } catch {
        counts.failed++;
        console.error("Upload cleanup failed", {
          trackId: validClaim ? row.id : "invalid",
          stage,
          attempt: record(row) ? row.cleanup_attempts : undefined,
        });
        if (args) {
          try {
            const rescheduled = await admin.rpc("retry_upload_cleanup", args);
            if (rescheduled.error) {
              console.error("Cleanup retry scheduling failed", {
                trackId: row.id,
              });
            }
          } catch {
            console.error("Cleanup retry scheduling unavailable", {
              trackId: row.id,
            });
          }
        }
      }
    }
    // Partial failures are explicit; other rows still get processed.
    return json(counts);
  } catch {
    return json({
      error: "Cleanup unavailable; outstanding leases will expire",
    }, 503);
  }
}

if (import.meta.main) Deno.serve(handleRequest);
