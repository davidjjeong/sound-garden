import { parseBuffer } from "music-metadata";

/** Structural checks only: metadata parsing is not full audio decoding. */
export async function verifyAudio(bytes: Uint8Array, mime: string) {
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) {
    throw new Error("Invalid audio size");
  }
  const wav = mime === "audio/wav";
  if (!wav && mime !== "audio/mpeg") throw new Error("Unsupported audio type");
  if (
    wav && (
      bytes.length < 44 ||
      new TextDecoder().decode(bytes.subarray(0, 4)) !== "RIFF" ||
      new TextDecoder().decode(bytes.subarray(8, 12)) !== "WAVE"
    )
  ) throw new Error("Invalid WAV header");

  const { format } = await parseBuffer(bytes, {
    mimeType: mime,
    size: bytes.length,
  }, {
    duration: true,
    skipCovers: true,
  });
  if (
    (wav ? format.container !== "WAVE" : format.container !== "MPEG") ||
    !format.duration || !Number.isFinite(format.duration) ||
    format.duration <= 0 ||
    !format.sampleRate || !format.numberOfChannels ||
    (!wav && format.codec !== "MPEG 1 Layer 3" &&
      format.codec !== "MPEG 2 Layer 3" && format.codec !== "MPEG 2.5 Layer 3")
  ) throw new Error("File does not contain supported audio");
}
