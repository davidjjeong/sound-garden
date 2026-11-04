import { handleRequest } from "../../supabase/functions/reserve-upload/index.ts";
import {
  assert,
  commonRequestTests,
  json,
  request,
  sandbox,
  trackId,
  userId,
} from "./helpers.ts";

const valid = { idempotencyKey: trackId, filename: "song.mp3", sizeBytes: 3 };
commonRequestTests("reserve-upload", handleRequest, valid);

Deno.test("reserve-upload: validation, routing, and retry contracts", async (t) => {
  await sandbox(async () => {
    const cases = [
      { name: "new MP3", status: 200, action: "upload" },
      {
        name: "uppercase WAV",
        status: 200,
        action: "upload",
        filename: "song.WAV",
      },
      { name: "minimum size", status: 200, action: "upload", size: 1 },
      { name: "maximum size", status: 200, action: "upload", size: 20971520 },
      {
        name: "file already exists",
        status: 200,
        action: "finalize",
        exists: true,
      },
      {
        name: "existing file near expiry",
        status: 200,
        action: "finalize",
        exists: true,
        remaining: 1000,
      },
      { name: "already ready", status: 200, action: "ready", state: "ready" },
      { name: "deleting", status: 409, state: "deleting" },
      { name: "expired", status: 410, remaining: -1000 },
      { name: "missing expiry", status: 410, expiry: null },
      { name: "invalid expiry", status: 410, expiry: "invalid" },
      { name: "signing window closed", status: 410, remaining: 60 * 60 * 1000 },
      {
        name: "signing window boundary",
        status: 410,
        remaining: 135 * 60 * 1000 - 1000,
      },
      {
        name: "missing object HEAD 400",
        status: 200,
        action: "upload",
        head: 400,
      },
      {
        name: "missing object HEAD 404",
        status: 200,
        action: "upload",
        head: 404,
      },
      { name: "storage check forbidden", status: 503, head: 403 },
      { name: "signing fails", status: 503, signing: 403 },
      { name: "signing returns no token", status: 503, noToken: true },
      { name: "RPC invalid input", status: 400, code: "22023" },
      { name: "RPC idempotency conflict", status: 409, code: "SG409" },
      { name: "RPC expired", status: 410, code: "SG410" },
      { name: "RPC quota exceeded", status: 413, code: "SG413" },
      { name: "RPC unknown failure", status: 500, code: "XX000" },
      { name: "RPC returns null", status: 500, badTrack: "null" },
      { name: "RPC wrong owner", status: 500, badTrack: "owner" },
      { name: "RPC wrong path", status: 500, badTrack: "path" },
      { name: "RPC wrong size", status: 500, badTrack: "size" },
      { name: "RPC wrong MIME", status: 500, badTrack: "mime" },
      { name: "RPC invalid ID", status: 500, badTrack: "id" },
    ];
    for (const test of cases) {
      await t.step(test.name, async () => {
        const body = {
          ...valid,
          filename: test.filename ?? valid.filename,
          sizeBytes: test.size ?? 3,
        };
        const wav = body.filename.endsWith("WAV");
        const path = `${userId}/${trackId}.${wav ? "wav" : "mp3"}`;
        const track = {
          id: trackId,
          user_id: userId,
          title: "song",
          status: test.state ?? "pending",
          storage_path: path,
          size_bytes: body.sizeBytes,
          mime_type: wav ? "audio/wav" : "audio/mpeg",
          upload_expires_at: "expiry" in test
            ? test.expiry
            : new Date(Date.now() + (test.remaining ?? 4 * 3600000))
              .toISOString(),
        };
        if (test.badTrack === "owner") track.user_id = trackId;
        if (test.badTrack === "path") track.storage_path = "wrong/path.mp3";
        if (test.badTrack === "size") track.size_bytes++;
        if (test.badTrack === "mime") track.mime_type = "text/plain";
        if (test.badTrack === "id") track.id = "invalid";
        const calls: { url: URL; init?: RequestInit }[] = [];
        globalThis.fetch = (input, init) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );
          calls.push({ url, init });
          if (url.pathname === "/auth/v1/user") {
            return Promise.resolve(json({ id: userId }));
          }
          if (url.pathname === "/rest/v1/rpc/reserve_track_upload") {
            return Promise.resolve(
              test.code
                ? json({ code: test.code, message: "Database error" }, 400)
                : json(test.badTrack === "null" ? null : track),
            );
          }
          if (init?.method === "HEAD") {
            return Promise.resolve(
              new Response(null, {
                status: test.head ?? (test.exists ? 200 : 404),
              }),
            );
          }
          if (url.pathname.includes("/object/upload/sign/")) {
            return Promise.resolve(
              test.signing
                ? json({ message: "Signing failed" }, test.signing)
                : json({
                  url: `/object/upload/sign/audio/${path}${
                    test.noToken ? "" : "?token=signed-token"
                  }`,
                }),
            );
          }
          throw new Error(`Unexpected request ${url}`);
        };
        const response = await handleRequest(request(body));
        const result = await response.json();
        assert(
          response.status === test.status,
          `${test.name}: ${response.status}`,
        );
        const rpc = calls.find((call) =>
          call.url.pathname.endsWith("/reserve_track_upload")
        );
        assert(rpc, "Reservation RPC expected");
        const args = JSON.parse(String(rpc.init?.body));
        assert(
          args.p_user_id === userId &&
            args.p_idempotency_key === valid.idempotencyKey,
        );
        const signed = calls.filter((call) =>
          call.url.pathname.includes("/object/upload/sign/")
        );
        if (test.action) {
          assert(result.action === test.action);
          assert(result.track.storagePath === path);
          assert(
            !("user_id" in result.track),
            "Do not expose raw database rows",
          );
          if (test.action === "upload") {
            assert(
              result.upload.token === "signed-token" &&
                result.upload.path === path,
            );
            assert(signed.length === 1);
            assert(
              new Headers(signed[0].init?.headers).get("x-upsert") !== "true",
            );
          }
        }
        if (test.action !== "upload" && !test.signing && !test.noToken) {
          assert(signed.length === 0);
        }
        assert(
          !calls.some((call) =>
            call.url.pathname.includes("/finalize_track_upload")
          ),
        );
      });
    }
    const invalid = [
      { idempotencyKey: "bad" },
      { idempotencyKey: null },
      { filename: "image.png" },
      { filename: "a".repeat(256) + ".mp3" },
      { filename: null },
      { sizeBytes: 0 },
      { sizeBytes: -1 },
      { sizeBytes: 1.5 },
      { sizeBytes: "3" },
      { sizeBytes: 20971521 },
      { sizeBytes: null },
    ];
    for (const patch of invalid) {
      await t.step(`invalid input ${JSON.stringify(patch)}`, async () => {
        let calls = 0;
        globalThis.fetch = () => {
          calls++;
          return Promise.resolve(json({ id: userId }));
        };
        assert(
          (await handleRequest(request({ ...valid, ...patch }))).status === 400,
        );
        assert(calls === 1, "Invalid request must not create a reservation");
      });
    }
  });
});
