export const userId = "22222222-2222-4222-8222-222222222222";
export const trackId = "11111111-1111-4111-8111-111111111111";
export function assert(
  value: unknown,
  message = "Assertion failed",
): asserts value {
  if (!value) throw new Error(message);
}
export const json = (body: unknown, status = 200) =>
  Response.json(body, { status });
export const request = (
  body: unknown,
  headers = { Authorization: "Bearer token" },
) =>
  new Request("https://app.test/upload", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

/** Restore process globals even when an assertion fails; never contact Supabase. */
export async function sandbox(run: () => Promise<void>) {
  const fetch = globalThis.fetch;
  const keys = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const values = keys.map((key) => Deno.env.get(key));
  keys.forEach((key, i) =>
    Deno.env.set(key, i === 0 ? "https://test.supabase.co" : "test-key")
  );
  try {
    await run();
  } finally {
    globalThis.fetch = fetch;
    keys.forEach((key, i) =>
      values[i] === undefined
        ? Deno.env.delete(key)
        : Deno.env.set(key, values[i]!)
    );
  }
}

export function commonRequestTests(
  name: string,
  handler: (request: Request) => Promise<Response>,
  validBody: unknown,
) {
  Deno.test(`${name}: HTTP and authentication guards`, async (t) => {
    await sandbox(async () => {
      let calls = 0;
      globalThis.fetch = () => {
        calls++;
        return Promise.resolve(json({ id: userId }));
      };
      for (const method of ["OPTIONS", "GET", "PUT"]) {
        await t.step(method, async () => {
          const response = await handler(
            new Request("https://app.test", { method }),
          );
          assert(response.status === (method === "OPTIONS" ? 204 : 405));
          assert(response.headers.get("Access-Control-Allow-Origin") === "*");
          assert(
            calls === 0,
            "Method guards must not contact upstream services",
          );
        });
      }
      for (const header of [undefined, "Basic token", "Bearer", "Bearer a b"]) {
        await t.step(`malformed authorization: ${header}`, async () => {
          const response = await handler(
            new Request("https://app.test", {
              method: "POST",
              headers: header ? { Authorization: header } : {},
              body: "{}",
            }),
          );
          assert(response.status === 401);
          assert(calls === 0);
        });
      }
      await t.step("missing server configuration", async () => {
        Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
        try {
          assert((await handler(request(validBody))).status === 500);
        } finally {
          Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
        }
        assert(calls === 0);
      });
      for (const status of [401, 503]) {
        await t.step(`auth service returns ${status}`, async () => {
          globalThis.fetch = () =>
            Promise.resolve(json({ message: "Auth failed" }, status));
          assert((await handler(request(validBody))).status === status);
        });
      }
      await t.step("auth rejects missing session", async () => {
        globalThis.fetch = () =>
          Promise.resolve(json({ message: "Session missing" }, 403));
        assert((await handler(request(validBody))).status === 401);
      });
      for (const raw of ["{", "null", "[]", '"text"', "{}"]) {
        await t.step(`invalid body: ${raw}`, async () => {
          let upstream = 0;
          globalThis.fetch = () => {
            upstream++;
            return Promise.resolve(json({ id: userId }));
          };
          const response = await handler(
            new Request("https://app.test", {
              method: "POST",
              headers: { Authorization: "Bearer token" },
              body: raw,
            }),
          );
          assert(response.status === 400);
          assert(
            upstream === 1,
            "Invalid input must stop after authentication",
          );
          assert(response.headers.get("Cache-Control") === "no-store");
        });
      }
    });
  });
}
