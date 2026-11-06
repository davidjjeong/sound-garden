import { handleRequest } from "../../supabase/functions/cleanup-uploads/index.ts";
import { assert, json, sandbox, trackId, userId } from "./helpers.ts";

const secret = "test-cleanup-secret-32-characters-minimum";
const token = "33333333-3333-4333-8333-333333333333";
const row = {
  id: trackId,
  user_id: userId,
  storage_path: `${userId}/${trackId}.mp3`,
  mime_type: "audio/mpeg",
  status: "deleting",
  deletion_reason: "expired_upload",
  cleanup_claim_token: token,
  cleanup_attempts: 1,
};
const request = (key: string | null = secret, method = "POST") =>
  new Request("https://app.test/cleanup", {
    method,
    headers: key ? { "x-cleanup-secret": key } : {},
  });
async function environment(run: () => Promise<void>) {
  const old = Deno.env.get("CLEANUP_JOB_SECRET");
  await sandbox(async () => {
    Deno.env.set("CLEANUP_JOB_SECRET", secret);
    try {
      await run();
    } finally {
      if (old === undefined) Deno.env.delete("CLEANUP_JOB_SECRET");
      else Deno.env.set("CLEANUP_JOB_SECRET", old);
    }
  });
}
Deno.test("cleanup-uploads: rejects public callers before any upstream call", async () => {
  await environment(async () => {
    let calls = 0;
    globalThis.fetch = () => {
      calls++;
      return Promise.resolve(json([]));
    };
    for (const method of ["GET", "OPTIONS", "DELETE"]) {
      assert((await handleRequest(request(secret, method))).status === 405);
    }
    for (const key of [null, "wrong", "Bearer token"]) {
      assert((await handleRequest(request(key))).status === 401);
    }
    Deno.env.delete("CLEANUP_JOB_SECRET");
    assert((await handleRequest(request())).status === 500);
    assert(calls === 0);
  });
});
Deno.test("cleanup-uploads: safe processing and partial failures", async (t) => {
  await environment(async () => {
    for (
      const scenario of [
        "empty",
        "valid",
        "missing-file",
        "mixed",
        "invalid-path",
        "invalid-owner",
        "wrong-reason",
        "lease-lost",
        "renew-error",
        "remove-error",
        "finish-error",
        "finish-lost",
        "claim-error",
        "claim-malformed",
        "reschedule-error",
      ]
    ) {
      await t.step(scenario, async () => {
        const calls: string[] = [];
        const issues: string[] = [];
        const item = { ...row };
        if (scenario === "invalid-path") {
          item.storage_path = "../other-file.mp3";
        }
        if (scenario === "invalid-owner") item.user_id = "bad";
        if (scenario === "wrong-reason") item.deletion_reason = "user";
        const second = {
          ...row,
          id: "44444444-4444-4444-8444-444444444444",
          storage_path: `${userId}/44444444-4444-4444-8444-444444444444.mp3`,
        };
        let currentId = trackId;
        globalThis.fetch = (input, init) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );
          const name = url.pathname.split("/").pop()!;
          calls.push(name);
          const args = init?.body ? JSON.parse(String(init.body)) : {};
          if (name === "claim_expired_uploads") {
            if (args.p_batch_size !== 10) {
              issues.push("Batch size must be server controlled");
            }
            if (scenario === "claim-error") {
              return Promise.resolve(json({ code: "XX000" }, 400));
            }
            return Promise.resolve(
              json(
                scenario === "claim-malformed"
                  ? {}
                  : scenario === "empty"
                  ? []
                  : scenario === "mixed"
                  ? [item, second]
                  : [item],
              ),
            );
          }
          if (name === "renew_upload_cleanup") {
            currentId = args.p_track_id;
            if (args.p_claim_token !== token) {
              issues.push("Missing claim token");
            }
            if (scenario === "renew-error") {
              return Promise.resolve(json({ code: "XX000" }, 400));
            }
            return Promise.resolve(json(scenario !== "lease-lost"));
          }
          if (url.pathname === "/storage/v1/object/audio") {
            const expected = `${userId}/${currentId}.mp3`;
            if (
              init?.method !== "DELETE" ||
              JSON.stringify(args.prefixes) !== JSON.stringify([expected])
            ) issues.push("Unsafe Storage removal");
            if (
              ["remove-error", "reschedule-error"].includes(scenario) ||
              (scenario === "mixed" && currentId === trackId)
            ) return Promise.resolve(json({ message: "Failed" }, 403));
            return Promise.resolve(
              json(scenario === "missing-file" ? [] : [{ name: expected }]),
            );
          }
          if (name === "finish_upload_cleanup") {
            if (scenario === "finish-error") {
              return Promise.resolve(json({ code: "XX000" }, 400));
            }
            return Promise.resolve(json(scenario !== "finish-lost"));
          }
          if (name === "retry_upload_cleanup") {
            return Promise.resolve(
              scenario === "reschedule-error"
                ? json({ code: "XX000" }, 400)
                : json(true),
            );
          }
          issues.push(`Unexpected ${url.pathname}`);
          return Promise.resolve(json({}, 500));
        };
        const response = await handleRequest(request());
        const body = await response.json();
        assert(issues.length === 0, issues.join(", "));
        if (["claim-error", "claim-malformed"].includes(scenario)) {
          assert(response.status === 503);
          return;
        }
        assert(response.status === 200);
        if (scenario === "empty") {
          assert(body.claimed === 0 && calls.length === 1);
          return;
        }
        if (["valid", "missing-file"].includes(scenario)) {
          assert(body.deleted === 1 && body.failed === 0);
          assert(
            calls.join(",") ===
              "claim_expired_uploads,renew_upload_cleanup,audio,finish_upload_cleanup",
          );
        } else if (scenario === "mixed") {
          assert(body.failed === 1 && body.deleted === 1);
        } else if (["lease-lost", "finish-lost"].includes(scenario)) {
          assert(body.leaseLost === 1);
        } else {assert(
            body.failed === 1 && calls.includes("retry_upload_cleanup"),
          );}
        if (
          [
            "invalid-path",
            "invalid-owner",
            "wrong-reason",
            "lease-lost",
            "renew-error",
          ].includes(scenario)
        ) assert(!calls.includes("audio"));
        if (["remove-error", "reschedule-error"].includes(scenario)) {
          assert(!calls.includes("finish_upload_cleanup"));
        }
      });
    }
  });
});

Deno.test("cleanup-uploads: missing service configuration never claims work", async () => {
  await environment(async () => {
    let calls = 0;
    globalThis.fetch = () => {
      calls++;
      return Promise.resolve(json([]));
    };
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    assert((await handleRequest(request())).status === 500);
    assert(calls === 0);
  });
});
