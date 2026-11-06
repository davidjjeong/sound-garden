import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders, "Cache-Control": "no-store" },
  });
}

const authOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};

const reservationErrors: Record<string, { status: number; message: string }> = {
  "22023": { status: 400, message: "Invalid upload request" },
  SG409: {
    status: 409,
    message: "Upload key conflicts with another request or deletion",
  },
  SG410: {
    status: 410,
    message: "Upload reservation expired; start a new upload",
  },
  SG413: {
    status: 413,
    message: "Your library storage limit has been reached",
  },
};

export async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)
    ?.[1];
  if (!token) return json({ error: "Authentication required" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return json({ error: "Server configuration is incomplete" }, 500);
  }

  try {
    const authClient = createClient(url, anonKey, { auth: authOptions });
    const { data: { user }, error: authError } = await authClient.auth.getUser(
      token,
    );
    if (authError) {
      const unavailable = !authError.status || authError.status >= 500;
      return json({
        error: unavailable
          ? "Authentication service unavailable"
          : "Invalid or expired session",
      }, unavailable ? 503 : 401);
    }
    if (!user) return json({ error: "Invalid or expired session" }, 401);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body must be valid JSON" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return json({ error: "Request body must be an object" }, 400);
    }
    const { idempotencyKey, filename, sizeBytes, contentHash } = body as Record<
      string,
      unknown
    >;
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      (contentHash !== undefined &&
        (typeof contentHash !== "string" ||
          !/^[0-9a-f]{64}$/.test(contentHash))) ||
      typeof idempotencyKey !== "string" || !uuidPattern.test(idempotencyKey) ||
      typeof filename !== "string" || filename.length > 255 ||
      !/\.(mp3|wav)$/i.test(filename) ||
      typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) ||
      sizeBytes <= 0 || sizeBytes > 20 * 1024 * 1024
    ) {
      return json({
        error:
          "Provide an upload UUID, MP3/WAV filename, and size up to 20 MiB",
      }, 400);
    }

    const admin = createClient(url, serviceKey, { auth: authOptions });
    const { data: track, error } = await admin.rpc("reserve_track_upload", {
      p_user_id: user.id,
      p_idempotency_key: idempotencyKey,
      p_filename: filename,
      p_size_bytes: sizeBytes,
      p_content_hash: contentHash ?? null,
    });
    if (error?.code === "SGDUP") {
      return json({
        error: "This file is already in your library.",
        code: "DUPLICATE_TRACK",
      }, 409);
    }
    if (error) {
      const known = reservationErrors[error.code];
      if (known) {
        return json({ error: known.message, code: error.code }, known.status);
      }
      console.error("Reservation RPC failed", { code: error.code });
      return json({ error: "Could not reserve this upload" }, 500);
    }

    const extension = filename.toLowerCase().endsWith(".mp3") ? "mp3" : "wav";
    const expectedMime = extension === "mp3" ? "audio/mpeg" : "audio/wav";
    if (
      !track || typeof track.id !== "string" || !uuidPattern.test(track.id) ||
      track.user_id !== user.id || track.size_bytes !== sizeBytes ||
      track.mime_type !== expectedMime ||
      track.storage_path !== `${user.id}/${track.id}.${extension}`
    ) {
      return json({ error: "Invalid reservation returned by the server" }, 500);
    }
    const publicTrack = {
      id: track.id,
      title: track.title,
      status: track.status,
      storagePath: track.storage_path,
      mimeType: track.mime_type,
      sizeBytes: track.size_bytes,
      expiresAt: track.upload_expires_at,
    };
    if (track.status === "ready") {
      return json({ action: "ready", track: publicTrack });
    }
    if (track.status !== "pending") {
      return json({ error: "Upload cannot proceed" }, 409);
    }

    const expiresAt = Date.parse(track.upload_expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return json({ error: "Upload reservation expired", code: "SG410" }, 410);
    }

    const storage = admin.storage.from("audio");
    // exists() throws for upstream failures other than missing objects.
    let existence: Awaited<ReturnType<typeof storage.exists>>;
    try {
      existence = await storage.exists(track.storage_path);
    } catch {
      return json({
        error: "Unable to check uploaded file; retry this reservation",
      }, 503);
    }
    const { data: exists, error: existsError } = existence;
    // Storage's HEAD endpoint reports missing objects as 400 or 404.
    if (existsError) {
      const status = "status" in existsError ? Number(existsError.status) : NaN;
      if (status !== 400 && status !== 404) {
        return json({
          error: "Unable to check uploaded file; retry this reservation",
        }, 503);
      }
    }
    if (exists) return json({ action: "finalize", track: publicTrack });

    // Signed upload tokens last 2 hours. Do not issue one near reservation expiry.
    // Leave a grace period for in-flight requests before eventual cleanup.
    if (expiresAt - Date.now() < (2 * 60 + 15) * 60 * 1000) {
      return json({
        error: "Upload window closed; start a new upload",
        code: "UPLOAD_WINDOW_CLOSED",
      }, 410);
    }
    const { data: upload, error: signingError } = await storage
      .createSignedUploadUrl(
        track.storage_path,
        { upsert: false },
      );
    if (signingError || !upload) {
      return json({
        error: "Could not authorize upload; retry with the same upload key",
      }, 503);
    }

    return json({
      action: "upload",
      track: publicTrack,
      upload: { bucket: "audio", path: upload.path, token: upload.token },
    });
  } catch {
    return json({ error: "Unable to process the upload reservation" }, 500);
  }
}

if (import.meta.main) Deno.serve(handleRequest);
