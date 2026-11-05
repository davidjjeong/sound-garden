import { handleRequest } from "../../supabase/functions/delete-track/index.ts";
import {
  assert,
  commonRequestTests,
  json,
  request,
  sandbox,
  trackId,
  userId,
} from "./helpers.ts";

commonRequestTests("delete-track", handleRequest, { trackId });

Deno.test("delete-track: ownership, ordered deletion, failures, and retries", async (t) => {
  await sandbox(async () => {
    for (
      const scenario of [
        "valid",
        "wav",
        "missing",
        "missing-file",
        "pending",
        "begin-error",
        "wrong-owner",
        "wrong-id",
        "wrong-state",
        "wrong-mime",
        "wrong-path",
        "malformed",
        "remove-error",
        "remove-not-found-error",
        "remove-throws",
        "finish-error",
        "finish-conflict",
        "uppercase-id",
      ]
    ) {
      await t.step(scenario, async () => {
        const stages: string[] = [];
        const problems: string[] = [];
        const path = `${userId}/${trackId}.${
          scenario === "wav" ? "wav" : "mp3"
        }`;
        const track = {
          id: trackId,
          user_id: userId,
          status: "deleting",
          storage_path: path,
          mime_type: scenario === "wav" ? "audio/wav" : "audio/mpeg",
        };
        if (scenario === "wrong-owner") track.user_id = trackId;
        if (scenario === "wrong-id") track.id = userId;
        if (scenario === "wrong-state") track.status = "ready";
        if (scenario === "wrong-mime") track.mime_type = "text/plain";
        if (scenario === "wrong-path") {
          track.storage_path = `${userId}/${userId}.mp3`;
        }
        globalThis.fetch = (input, init) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );
          if (url.pathname === "/auth/v1/user") {
            stages.push("auth");
            return Promise.resolve(json({ id: userId }));
          }
          if (
            url.pathname.endsWith("/begin_track_deletion") ||
            url.pathname.endsWith("/finish_track_deletion")
          ) {
            const begin = url.pathname.endsWith("/begin_track_deletion");
            stages.push(begin ? "begin" : "finish");
            const args = JSON.parse(String(init?.body));
            if (args.p_user_id !== userId || args.p_track_id !== trackId) {
              problems.push(
                "RPC must use authenticated owner and canonical ID",
              );
            }
            if (begin) {
              if (scenario === "pending") {
                return Promise.resolve(json({ code: "SG409" }, 400));
              }
              if (scenario === "begin-error") {
                return Promise.resolve(json({ code: "XX000" }, 400));
              }
              return Promise.resolve(
                json(
                  scenario === "missing"
                    ? null
                    : scenario === "malformed"
                    ? []
                    : track,
                ),
              );
            }
            if (scenario === "finish-error" || scenario === "finish-conflict") {
              return Promise.resolve(
                json({
                  code: scenario === "finish-conflict" ? "SG409" : "XX000",
                }, 400),
              );
            }
            return Promise.resolve(json(null));
          }
          if (url.pathname === "/storage/v1/object/audio") {
            stages.push("remove");
            if (
              init?.method !== "DELETE" ||
              JSON.stringify(JSON.parse(String(init.body)).prefixes) !==
                JSON.stringify([path])
            ) problems.push("Must remove only the exact authorized path");
            if (scenario === "remove-throws") {
              return Promise.reject(new Error("Connection lost"));
            }
            if (
              scenario === "remove-error" ||
              scenario === "remove-not-found-error"
            ) {
              return Promise.resolve(
                json(
                  { message: "Storage unavailable" },
                  scenario === "remove-error" ? 403 : 404,
                ),
              );
            }
            return Promise.resolve(
              json(scenario === "missing-file" ? [] : [{ name: path }]),
            );
          }
          problems.push(`Unexpected upstream request: ${url.pathname}`);
          return Promise.resolve(json({ error: "Unexpected request" }, 500));
        };
        const response = await handleRequest(
          request({
            trackId: scenario === "uppercase-id"
              ? trackId.toUpperCase()
              : trackId,
            userId: trackId,
            storagePath: "ignored/untrusted.mp3",
          }),
        );
        const body = await response.json();
        const success = [
          "valid",
          "wav",
          "missing",
          "missing-file",
          "uppercase-id",
        ].includes(scenario);
        const corrupt = [
          "wrong-owner",
          "wrong-id",
          "wrong-state",
          "wrong-mime",
          "wrong-path",
          "malformed",
        ].includes(scenario);
        const status = success
          ? 200
          : corrupt
          ? 500
          : ["pending", "finish-conflict"].includes(scenario)
          ? 409
          : 503;
        assert(
          response.status === status,
          `${scenario}: expected ${status}, got ${response.status}`,
        );
        assert(problems.length === 0, problems.join(", "));
        if (success) {
          assert(body.action === "deleted" && body.trackId === trackId);
        }
        const stopAtBegin = corrupt ||
          ["pending", "begin-error", "missing"].includes(scenario);
        const removalFails = [
          "remove-error",
          "remove-not-found-error",
          "remove-throws",
        ].includes(scenario);
        assert(
          JSON.stringify(stages) === JSON.stringify(
            stopAtBegin
              ? ["auth", "begin"]
              : removalFails
              ? ["auth", "begin", "remove"]
              : ["auth", "begin", "remove", "finish"],
          ),
          `${scenario}: unsafe operation order`,
        );
      });
    }
  });
});

Deno.test("delete-track: a lost finish response can be retried without deleting twice", async () => {
  await sandbox(async () => {
    let removed = 0;
    let finished = false;
    const path = `${userId}/${trackId}.mp3`;
    globalThis.fetch = (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/auth/v1/user") {
        return Promise.resolve(json({ id: userId }));
      }
      if (url.pathname.endsWith("/begin_track_deletion")) {
        return Promise.resolve(json(
          finished ? null : {
            id: trackId,
            user_id: userId,
            status: "deleting",
            storage_path: path,
            mime_type: "audio/mpeg",
          },
        ));
      }
      if (url.pathname === "/storage/v1/object/audio") {
        removed++;
        return Promise.resolve(json([]));
      }
      if (url.pathname.endsWith("/finish_track_deletion")) {
        finished = true;
        return Promise.reject(new Error("Lost response"));
      }
      throw new Error("Unexpected request");
    };
    assert((await handleRequest(request({ trackId }))).status === 503);
    assert((await handleRequest(request({ trackId }))).status === 200);
    assert(removed === 1);
  });
});

Deno.test("delete-track: resumes after Storage failure or failed database completion", async (t) => {
  for (const failure of ["storage", "finish"]) {
    await t.step(failure, async () => {
      await sandbox(async () => {
        let attempt = 0;
        let exists = true;
        let finished = false;
        let finishCalls = 0;
        const path = `${userId}/${trackId}.mp3`;
        globalThis.fetch = (input) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );
          if (url.pathname === "/auth/v1/user") {
            return Promise.resolve(json({ id: userId }));
          }
          if (url.pathname.endsWith("/begin_track_deletion")) {
            attempt++;
            return Promise.resolve(json(
              finished ? null : {
                id: trackId,
                user_id: userId,
                status: "deleting",
                storage_path: path,
                mime_type: "audio/mpeg",
              },
            ));
          }
          if (url.pathname === "/storage/v1/object/audio") {
            if (attempt === 1 && failure === "storage") {
              return Promise.resolve(json({ message: "Failed" }, 403));
            }
            const result = exists ? [{ name: path }] : [];
            exists = false;
            return Promise.resolve(json(result));
          }
          if (url.pathname.endsWith("/finish_track_deletion")) {
            finishCalls++;
            if (attempt === 1 && failure === "finish") {
              return Promise.resolve(json({ code: "XX000" }, 400));
            }
            finished = true;
            return Promise.resolve(json(null));
          }
          throw new Error("Unexpected request");
        };
        assert((await handleRequest(request({ trackId }))).status === 503);
        assert(!finished);
        if (failure === "storage") assert(finishCalls === 0 && exists);
        else assert(!exists);
        assert((await handleRequest(request({ trackId }))).status === 200);
        assert(finished && !exists);
      });
    });
  }
});
