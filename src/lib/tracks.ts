import { hashAudioFile } from './contentHash'
import { DuplicateTrackError } from './uploadErrors'
import { FunctionsHttpError } from '@supabase/supabase-js'
import type { ReservationResponse, ReservedTrack, SignedUpload, ReadyTrack } from '../types/uploads'
import { supabase } from './supabase'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // currently 20MB

export async function getTracks() {
  const { data, error } = await supabase
    .from('tracks')
    .select('id, title, size_bytes, created_at')
    .eq('status', 'ready')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isReservedTrack(value: unknown): value is ReservedTrack {
  if (!isObject(value)) return false

  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    (value.status === 'pending' || value.status === 'ready') &&
    typeof value.storagePath === 'string' &&
    typeof value.mimeType === 'string' &&
    typeof value.sizeBytes === 'number' &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 &&
    (value.expiresAt === null ||
      (typeof value.expiresAt === 'string' &&
        Number.isFinite(Date.parse(value.expiresAt))))
  )
}

function isReservationResponse(
  value: unknown,
): value is ReservationResponse {
  if (!isObject(value) || !isReservedTrack(value.track)) return false

  if (value.action === 'ready') {
    return value.track.status === 'ready'
  }

  if (value.track.status !== 'pending' || value.track.expiresAt === null) {
    return false
  }

  if (value.action === 'finalize') return true

  return (
    value.action === 'upload' &&
    isObject(value.upload) &&
    value.upload.bucket === 'audio' &&
    value.upload.path === value.track.storagePath &&
    typeof value.upload.token === 'string' &&
    value.upload.token.length > 0
  )
}

export async function reserveUpload(
  file: File,
  idempotencyKey: string,
  contentHash?: string,
): Promise<ReservationResponse> {
  const hash = contentHash ?? await hashAudioFile(file)
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid audio fingerprint.')
  const { data, error } = await supabase.functions.invoke<unknown>(
    'reserve-upload',
    {
      body: {
        idempotencyKey,
        filename: file.name,
        sizeBytes: file.size,
        contentHash: hash,
      },
    },
  )

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body: unknown = await error.context.json().catch(() => null)
      if (isObject(body) && body.code === 'DUPLICATE_TRACK') throw new DuplicateTrackError()

      throw new Error(
        isObject(body) && typeof body.error === 'string'
          ? body.error
          : 'Could not reserve your upload.',
      )
    }

    throw new Error(error.message)
  }

  if (!isReservationResponse(data)) {
    throw new Error('The server returned an invalid upload reservation.')
  }

  if (data.track.sizeBytes !== file.size) {
    throw new Error('The reservation does not match the selected file.')
  }

  return data
}

/** Transfers bytes only; the track stays pending until backend finalization. */
export async function uploadReservedFile(
  file: File,
  upload: SignedUpload,
): Promise<void> {
  const extension = file.name.split('.').pop()?.toLowerCase()

  if (extension !== 'mp3' && extension !== 'wav') {
    throw new Error('Please choose an MP3 or WAV file.')
  }

  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    throw new Error('Choose a nonempty audio file up to 20 MiB.')
  }

  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  const expectedPath = new RegExp(`^${uuid}/${uuid}\\.${extension}$`, 'i')

  if (
    upload.bucket !== 'audio' ||
    !expectedPath.test(upload.path) ||
    !upload.token.trim()
  ) {
    throw new Error('The upload authorization is invalid. Reserve the upload again.')
  }

  const contentType = extension === 'mp3' ? 'audio/mpeg' : 'audio/wav'
  // File.type can be empty or vary by OS. The SDK uses the Blob's type
  // for multipart uploads, so normalize it without changing the audio bytes.
  const audio = file.slice(0, file.size, contentType)

  try {
    const { error } = await supabase.storage
      .from(upload.bucket)
      .uploadToSignedUrl(upload.path, upload.token, audio, {
        contentType,
        upsert: false,
      })

    if (error) throw error
  } catch {
    // An error does not prove the server failed to store the file.
    // Retry the reservation with the SAME key to discover its actual state.
    // Do not log tokens, delete the file, or silently overwrite it here.
    throw new Error(
      'Could not confirm the audio upload. Retry this upload to check its status.',
    )
  }
}

/** Requests backend verification; never marks a track ready in the browser. */
export async function finalizeUpload(trackId: string): Promise<ReadyTrack> {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  if (!uuidPattern.test(trackId)) {
    throw new Error('A valid track ID is required to finalize the upload.')
  }

  const { data, error } = await supabase.functions.invoke<unknown>(
    'finalize-upload',
    { body: { trackId } },
  )

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body: unknown = await error.context.json().catch(() => null)
      if (isObject(body) && body.code === 'DUPLICATE_TRACK') throw new DuplicateTrackError()

      throw new Error(
        isObject(body) && typeof body.error === 'string'
          ? body.error
          : 'Could not verify the uploaded track. Retry this upload to check its status.',
      )
    }

    throw new Error(
      'Could not confirm track verification. Retry this upload to check its status.',
    )
  }

  if (
    !isObject(data) ||
    data.action !== 'ready' ||
    !isReservedTrack(data.track) ||
    data.track.status !== 'ready' ||
    data.track.id.toLowerCase() !== trackId.toLowerCase()
  ) {
    throw new Error('The server did not return the expected ready track.')
  }

  return { ...data.track, status: 'ready' }
}

/** Deletes through the backend; uncertain failures must retry the same ID. */
export async function deleteTrack(trackId: string): Promise<string> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuid.test(trackId)) throw new Error('A valid track ID is required for deletion.')
  const id = trackId.toLowerCase()
  const { data, error } = await supabase.functions.invoke<unknown>('delete-track', {
    body: { trackId: id },
  })
  if (error) {
    const body: unknown = error instanceof FunctionsHttpError
      ? await error.context.json().catch(() => null) : null
    throw new Error(isObject(body) && typeof body.error === 'string'
      ? body.error : 'Could not confirm deletion. Retry deletion to check its status.')
  }
  if (!isObject(data) || data.action !== 'deleted' || data.trackId !== id) {
    throw new Error('Could not confirm deletion. Retry deletion to check its status.')
  }
  return id
}
