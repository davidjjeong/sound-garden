import { createClient } from "@supabase/supabase-js";
import { verifyAudio } from "./audio.ts";

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
const ready = (track: Record<string, unknown>) =>
  json({
    action: "ready",
    track: {
      id: track.id,
      title: track.title,
      status: "ready",
      storagePath: track.storage_path,
      mimeType: track.mime_type,
      sizeBytes: track.size_bytes,
      expiresAt: track.upload_expires_at,
    },
  });

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
    const trackId = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).trackId
      : undefined;
    if (typeof trackId !== "string" || !uuid.test(trackId)) {
      return json({ error: "Provide a valid trackId" }, 400);
    }
    const admin = createClient(url, service, { auth });
    const { data: track, error } = await admin.from("tracks").select("*")
      .eq("id", trackId).eq("user_id", user.id).maybeSingle();
    if (error) return json({ error: "Unable to load upload; retry" }, 503);
    if (!track) return json({ error: "Track not found" }, 404);
    if (track.status === "ready") return ready(track);
    if (track.status !== "pending") {
      return json({ error: "Track cannot be finalized" }, 409);
    }
    const expires = Date.parse(track.upload_expires_at);
    if (!Number.isFinite(expires) || expires <= Date.now()) {
      return json(
        { error: "Upload reservation expired; start a new upload" },
        410,
      );
    }
    const extension = track.mime_type === "audio/mpeg" ? "mp3" : "wav";
    if (
      !["audio/mpeg", "audio/wav"].includes(track.mime_type) ||
      track.storage_path !== `${user.id}/${track.id}.${extension}` ||
      !Number.isSafeInteger(track.size_bytes) || track.size_bytes <= 0 ||
      track.size_bytes > 20 * 1024 * 1024
    ) {
      return json({ error: "Invalid upload reservation" }, 409);
    }
    const storage = admin.storage.from("audio");
    const { data: info, error: infoError } = await storage.info(
      track.storage_path,
    );
    if (infoError || !info) {
      const status = Number(
        infoError && "status" in infoError ? infoError.status : NaN,
      );
      return json({
        error: status === 404 || status === 400
          ? "Upload the file before finalizing"
          : "Unable to inspect upload; retry",
      }, status === 404 || status === 400 ? 409 : 503);
    }
    // The SDK camel-cases info response keys.
    if (
      info.size !== track.size_bytes || info.contentType !== track.mime_type
    ) {
      return json({
        error: "Uploaded file size or type does not match reservation",
      }, 422);
    }
    if (!info.id || !info.version) {
      return json({ error: "Storage object identity unavailable; retry" }, 503);
    }
    const { data: file, error: downloadError } = await storage.download(
      track.storage_path,
    );
    if (downloadError || !file) {
      return json({ error: "Unable to verify uploaded file; retry" }, 503);
    }
    if (file.size !== track.size_bytes) {
      return json({ error: "Uploaded file size mismatch" }, 422);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      await verifyAudio(
        bytes,
        track.mime_type,
      );
    } catch {
      return json(
        { error: "File is not a supported, recognizable MP3 or WAV" },
        422,
      );
    }
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const contentHash = Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const { data: finalized, error: finalError } = await admin.rpc(
      "finalize_track_upload",
      {
        p_user_id: user.id,
        p_track_id: track.id,
        p_object_id: info.id,
        p_object_version: info.version,
        p_content_hash: contentHash,
      },
    );
    if (finalError?.code === "SGDUP") {
      // Keep the rejected reservation pending until all issued tokens expire.
      // Immediate deletion could allow token replay to recreate an orphan.
      return json({
        error: "This file is already in your library.",
        code: "DUPLICATE_TRACK",
      }, 409);
    }
    if (finalError) {
      const status =
        ({ SG404: 404, SG409: 409, SG410: 410, SG422: 422 } as Record<
          string,
          number
        >)[finalError.code];
      if (status) {
        return json(
          { error: finalError.message, code: finalError.code },
          status,
        );
      }
      console.error("Finalization RPC failed", { code: finalError.code });
      return json({
        error: "Unable to finalize upload; retry with the same upload key",
      }, 503);
    }
    if (
      !finalized || finalized.id !== track.id || finalized.status !== "ready"
    ) {
      return json({ error: "Invalid finalization result" }, 500);
    }
    return ready(finalized);
  } catch {
    return json({
      error: "Unable to finalize upload; retry with the same upload key",
    }, 503);
  }
}

if (import.meta.main) Deno.serve(handleRequest);
