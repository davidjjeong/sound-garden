import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const auth = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { ...cors, "Cache-Control": "no-store" },
  });
const deleted = (trackId: string) => json({ action: "deleted", trackId });
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)
    ?.[1];
  if (!token) return json({ error: "Authentication required" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    return json({ error: "Server configuration is incomplete" }, 500);
  }

  try {
    const { data: { user }, error: authError } = await createClient(url, anon, {
      auth,
    }).auth.getUser(token);
    if (authError) {
      return json(
        { error: "Could not authenticate session" },
        !authError.status || authError.status >= 500 ? 503 : 401,
      );
    }
    if (!user) return json({ error: "Invalid or expired session" }, 401);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body must be valid JSON" }, 400);
    }
    const id = isObject(body) ? body.trackId : undefined;
    if (typeof id !== "string" || !uuid.test(id)) {
      return json({ error: "Provide a valid trackId" }, 400);
    }
    const trackId = id.toLowerCase();
    const admin = createClient(url, service, { auth });
    const args = { p_user_id: user.id, p_track_id: trackId };
    const { data: track, error: beginError } = await admin.rpc(
      "begin_track_deletion",
      args,
    );
    if (beginError) {
      if (beginError.code === "SG409") {
        return json({
          error: "Only completed tracks can be deleted",
          code: "SG409",
        }, 409);
      }
      console.error("Begin deletion failed", { code: beginError.code });
      return json({
        error: "Could not begin deletion; retry with the same trackId",
      }, 503);
    }
    // Nonexistent and unowned IDs are indistinguishable. Never derive a file path
    // from caller input when the ownership-filtered RPC returned no track.
    if (track === null) return deleted(trackId);
    if (
      !isObject(track) || track.id !== trackId || track.user_id !== user.id ||
      track.status !== "deleting" ||
      (track.mime_type !== "audio/mpeg" && track.mime_type !== "audio/wav")
    ) {
      return json({ error: "Invalid deletion reservation" }, 500);
    }
    const extension = track.mime_type === "audio/mpeg" ? "mp3" : "wav";
    if (track.storage_path !== `${user.id}/${trackId}.${extension}`) {
      return json({ error: "Invalid deletion path" }, 500);
    }
    // Storage remove is idempotent: an absent object can return a successful
    // empty list. Never treat arbitrary 400/404 errors as successful deletion.
    const { error: removalError } = await admin.storage.from("audio").remove([
      track.storage_path,
    ]);
    if (removalError) {
      return json({
        error: "Could not confirm audio deletion; retry with the same trackId",
      }, 503);
    }
    const { error: finishError } = await admin.rpc(
      "finish_track_deletion",
      args,
    );
    if (finishError) {
      if (finishError.code === "SG409") {
        return json({
          error: "Track is not marked for deletion",
          code: "SG409",
        }, 409);
      }
      console.error("Finish deletion failed", { code: finishError.code });
      return json({
        error: "Could not finish deletion; retry with the same trackId",
      }, 503);
    }
    return deleted(trackId);
  } catch {
    // A transport failure does not prove the preceding operation failed.
    return json({
      error: "Could not confirm deletion; retry with the same trackId",
    }, 503);
  }
}

if (import.meta.main) Deno.serve(handleRequest);
