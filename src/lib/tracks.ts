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