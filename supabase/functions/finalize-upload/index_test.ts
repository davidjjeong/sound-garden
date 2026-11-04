import { handleRequest } from "./index.ts";
import { verifyAudio } from "./audio.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function wav() {
  const bytes = new Uint8Array(44 + 1600);
  const view = new DataView(bytes.buffer);
  const label = (at: number, text: string) =>
    bytes.set(new TextEncoder().encode(text), at);
  label(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  label(8, "WAVE");
  label(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, "data");
  view.setUint32(40, 1600, true);
  return bytes;
}
Deno.test("audio verification accepts PCM WAV and rejects mislabeled content", async () => {
  await verifyAudio(wav(), "audio/wav");
  for (
    const [bytes, mime] of [[wav(), "audio/mpeg"], [
      new Uint8Array(100),
      "audio/wav",
    ]] as const
  ) {
    let rejected = false;
    try {
      await verifyAudio(bytes, mime);
    } catch {
      rejected = true;
    }
    assert(rejected, "Mislabeled content must fail");
  }
});

Deno.test("recognizes MP3 frame structure", async () => {
  // Synthetic frames test format recognition, not successful audio decoding.
  const bytes = new Uint8Array(417 * 12);
  for (let i = 0; i < 12; i++) bytes.set([0xff, 0xfb, 0x90, 0x00], i * 417);
  await verifyAudio(bytes, "audio/mpeg");
});

Deno.test("finalization: auth, ownership, retries, and verification before commit", async (t) => {
  const originalFetch = globalThis.fetch;
  const keys = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const old = keys.map((key) => Deno.env.get(key));
  keys.forEach((key, i) =>
    Deno.env.set(key, i === 0 ? "https://test.supabase.co" : "test-key")
  );
  const id = "11111111-1111-4111-8111-111111111111";
  const user = "22222222-2222-4222-8222-222222222222";
  const base = {
    id,
    user_id: user,
    title: "Test",
    status: "pending",
    mime_type: "audio/wav",
    storage_path: `${user}/${id}.wav`,
    size_bytes: wav().length,
    upload_expires_at: new Date(Date.now() + 3600000).toISOString(),
  };
  try {
    for (
      const scenario of [
        "unauthenticated",
        "missing",
        "ready",
        "invalid",
        "valid",
      ]
    ) {
      await t.step(scenario, async () => {
        let committed = false;
        let storageCalls = 0;
        globalThis.fetch = (input, init) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );
          const response = (body: unknown) =>
            Promise.resolve(Response.json(body));
          if (url.pathname === "/auth/v1/user") return response({ id: user });
          if (url.pathname === "/rest/v1/tracks") {
            assert(
              url.searchParams.get("user_id") === `eq.${user}`,
              "Must filter by authenticated owner",
            );
            return response(
              scenario === "missing" ? null : {
                ...base,
                status: scenario === "ready" ? "ready" : "pending",
              },
            );
          }
          if (url.pathname.includes("/storage/")) storageCalls++;
          if (url.pathname.includes("/object/info/")) {
            return response({
              id,
              version: "v1",
              size: base.size_bytes,
              content_type: "audio/wav",
            });
          }
          if (url.pathname.includes("/object/")) {
            return Promise.resolve(
              new Response(
                scenario === "invalid"
                  ? new Uint8Array(base.size_bytes)
                  : wav(),
              ),
            );
          }
          if (url.pathname === "/rest/v1/rpc/finalize_track_upload") {
            const args = JSON.parse(String(init?.body));
            assert(args.p_user_id === user && args.p_object_version === "v1");
            committed = true;
            return response({
              ...base,
              status: "ready",
              upload_expires_at: null,
            });
          }
          throw new Error(`Unexpected request: ${url.pathname}`);
        };
        const result = await handleRequest(
          new Request("https://app.test/finalize", {
            method: "POST",
            headers: scenario === "unauthenticated"
              ? {}
              : { Authorization: "Bearer token" },
            body: JSON.stringify({ trackId: id }),
          }),
        );
        const expected = ({
          unauthenticated: 401,
          missing: 404,
          ready: 200,
          invalid: 422,
          valid: 200,
        } as Record<string, number>)[scenario];
        assert(
          result.status === expected,
          `${scenario}: ${result.status}: ${await result.text()}`,
        );
        assert(
          committed === (scenario === "valid"),
          "Only verified uploads may commit",
        );
        if (["unauthenticated", "missing", "ready"].includes(scenario)) {
          assert(storageCalls === 0);
        }
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) =>
      old[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, old[i]!)
    );
  }
});
