import { FunctionsHttpError } from '@supabase/supabase-js'
import type { ReservationResponse, ReservedTrack, SignedUpload, ReadyTrack } from '../types/uploads'
import { supabase } from './supabase'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // currently 20MB

export async function uploadTrack(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase()

  if (extension !== 'mp3' && extension !== 'wav') {
    throw new Error('Please choose an MP3 or WAV file.')
  }

  if (file.size === 0 || file.size > MAX_FILE_SIZE) {
    throw new Error('Choose a nonempty file smaller than or equal to 20 MB.')
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError) throw authError
  if (!user) throw new Error('Please sign in before uploading.')

  const id = crypto.randomUUID()
  const storagePath = `${user.id}/${id}.${extension}`
  const mimeType = extension === 'mp3' ? 'audio/mpeg' : 'audio/wav'
  const title = file.name.replace(/\.(mp3|wav)$/i, '').trim() || 'Untitled'

  const { error: uploadError } = await supabase.storage
    .from('audio')
    .upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
    })

  if (uploadError) throw uploadError

  const { data: track, error: insertError } = await supabase
    .from('tracks')
    .insert({
      id,
      user_id: user.id,
      title,
      storage_path: storagePath,
      mime_type: mimeType,
      size_bytes: file.size,
    })
    .select()
    .single()

  if (insertError) {
    // Compensate for a failed metadata insert.
    const { error: cleanupError } = await supabase.storage
      .from('audio')
      .remove([storagePath])

    if (cleanupError) {
      throw new Error(
        'Could not save track details or remove the uploaded file. ' +
        'An unused file may remain in storage.',
      )
    }

    throw insertError
  }

  return track
}

export async function getTracks() {
  const { data, error } = await supabase
    .from('tracks')
    .select('id, title, size_bytes, created_at')
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
): Promise<ReservationResponse> {
  const { data, error } = await supabase.functions.invoke<unknown>(
    'reserve-upload',
    {
      body: {
        idempotencyKey,
        filename: file.name,
        sizeBytes: file.size,
      },
    },
  )

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body: unknown = await error.context.json().catch(() => null)

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
