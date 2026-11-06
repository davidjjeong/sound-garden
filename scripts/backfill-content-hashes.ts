// Run explicitly against a chosen project. Without --apply this only reads files.
import { createClient } from "@supabase/supabase-js";
import { verifyAudio } from "../supabase/functions/finalize-upload/audio.ts";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  throw new Error("Set backend SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
}
const apply = Deno.args.includes("--apply");
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let cursor = "00000000-0000-0000-0000-000000000000";
let checked = 0;
let failures = 0;
const seen = new Set<string>();
while (true) {
  const { data: rows, error } = await admin.from("tracks").select("*")
    .eq("status", "ready").is("content_sha256", null).gt("id", cursor).order(
      "id",
    ).limit(25);
  if (error) throw new Error("Could not list unhashed tracks");
  if (!rows?.length) break;
  for (const track of rows) {
    cursor = track.id;
    try {
      const extension = track.mime_type === "audio/mpeg" ? "mp3" : "wav";
      if (
        !["audio/mpeg", "audio/wav"].includes(track.mime_type) ||
        track.storage_path !== `${track.user_id}/${track.id}.${extension}` ||
        track.size_bytes <= 0 || track.size_bytes > 20971520
      ) throw new Error("Invalid track");
      const storage = admin.storage.from("audio");
      const { data: info, error: infoError } = await storage.info(
        track.storage_path,
      );
      if (
        infoError || !info?.id || !info.version ||
        info.size !== track.size_bytes
      ) throw new Error("Object mismatch");
      const { data: file, error: downloadError } = await storage.download(
        track.storage_path,
      );
      if (downloadError || !file || file.size !== track.size_bytes) {
        throw new Error("Download failed");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      await verifyAudio(bytes, track.mime_type);
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (seen.has(`${track.user_id}:${hash}`)) {
        throw new Error("Duplicate in backfill batch");
      }
      seen.add(`${track.user_id}:${hash}`);
      const { data: match, error: matchError } = await admin.from("tracks")
        .select("id")
        .eq("user_id", track.user_id).eq("status", "ready").eq(
          "content_sha256",
          hash,
        )
        .neq("id", track.id).limit(1);
      if (matchError) throw new Error("Could not check existing hashes");
      if (match?.length) throw new Error("Duplicate; resolve manually");
      if (apply) {
        const { error: saveError } = await admin.rpc("finalize_track_upload", {
          p_user_id: track.user_id,
          p_track_id: track.id,
          p_object_id: info.id,
          p_object_version: info.version,
          p_content_hash: hash,
        });
        if (saveError) {
          throw new Error(
            saveError.code === "SGDUP"
              ? "Duplicate; resolve manually"
              : "Save failed",
          );
        }
      }
      checked++;
      console.log(`${apply ? "Backfilled" : "Checked"} ${track.id}`);
    } catch (failure) {
      failures++;
      console.error(
        `Skipped ${track.id}: ${
          failure instanceof Error ? failure.message : "Verification failed"
        }`,
      );
    }
  }
}
console.log({ mode: apply ? "apply" : "dry-run", checked, failures });
if (failures) Deno.exitCode = 1;
