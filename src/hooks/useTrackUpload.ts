import { DuplicateTrackError } from '../lib/uploadErrors'
import { useEffect, useRef, useState } from 'react'
import {
  finalizeUpload,
  reserveUpload,
  uploadReservedFile,
} from '../lib/tracks'
import type { ReadyTrack } from '../types/uploads'

type UploadStatus =
  | 'idle'
  | 'reserving'
  | 'uploading'
  | 'verifying'
  | 'complete'
  | 'error'

type UploadState = {
  status: UploadStatus // current stage
  error: string | null // message to display (if any)
  completedTrack: ReadyTrack | null // verified ready track (if any)
  canRetry: boolean // whether a retained attempt is available
}

type UploadAttempt = {
  file: File
  idempotencyKey: string
}

const initialState: UploadState = {
  status: 'idle',
  error: null,
  completedTrack: null,
  canRetry: false,
}

export function useTrackUpload() {
  const [state, setState] = useState<UploadState>(initialState)
  const attemptRef = useRef<UploadAttempt | null>(null) // retains file and idempotency key for retries
  const busyRef = useRef(false) // immediately blocks duplicate submissions
  const mountedRef = useRef(true) // tracks whether component is still mounted
  const generationRef = useRef(0) // identifies reqs that belong to an obsolete component lifecycle

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      attemptRef.current = null
    }
  }, [])

  async function run(attempt: UploadAttempt): Promise<ReadyTrack | null> {
    if (busyRef.current || !mountedRef.current) return null

    // Unlike state, a ref changes immediately, blocking rapid duplicate clicks.
    busyRef.current = true
    const generation = generationRef.current
    const active = () =>
      mountedRef.current && generationRef.current === generation
    const transition = (status: UploadStatus) => {
      if (active()) setState({ status, error: null, completedTrack: null, canRetry: false })
    }

    try {
      transition('reserving')
      const reservation = await reserveUpload(
        attempt.file,
        attempt.idempotencyKey,
      )
      if (!active()) return null

      let track: ReadyTrack
      if (reservation.action === 'ready') {
        // The response validator checked readiness; keep the return type precise.
        track = { ...reservation.track, status: 'ready' }
      } else {
        if (reservation.action === 'upload') {
          transition('uploading')
          await uploadReservedFile(attempt.file, reservation.upload)
          if (!active()) return null
        }

        // An existing file skips transfer and goes straight to verification.
        transition('verifying')
        track = await finalizeUpload(reservation.track.id)
        if (!active()) return null
      }

      attemptRef.current = null
      setState({ status: 'complete', error: null, completedTrack: track, canRetry: false })
      return track
    } catch (error) {
      const duplicate = error instanceof DuplicateTrackError
      if (duplicate) attemptRef.current = null
      if (active()) {
        setState({
          status: 'error',
          error: error instanceof Error ? error.message : 'Upload failed. Please try again.',
          completedTrack: null,
          canRetry: !duplicate,
        })
      }
      // Preserve the file and key: an uncertain request may have succeeded.
      return null
    } finally {
      busyRef.current = false
    }
  }

  async function startUpload(file: File): Promise<ReadyTrack | null> {
    if (busyRef.current || !mountedRef.current) return null

    const extension = file.name.split('.').pop()?.toLowerCase()
    if (
      (extension !== 'mp3' && extension !== 'wav') ||
      file.name.length > 255 ||
      file.size <= 0 || file.size > 20 * 1024 * 1024
    ) {
      attemptRef.current = null
      setState({
        status: 'error',
        error: 'Choose a nonempty MP3 or WAV up to 20 MiB, with a filename of at most 255 characters.',
        completedTrack: null,
        canRetry: false,
      })
      return null
    }

    const attempt = { file, idempotencyKey: crypto.randomUUID() }
    attemptRef.current = attempt
    return run(attempt)
  }

  async function retryUpload(): Promise<ReadyTrack | null> {
    const attempt = attemptRef.current
    return attempt ? run(attempt) : null
  }

  function reset() {
    // Resetting UI is not cancellation or deletion of a server reservation.
    if (busyRef.current) return
    attemptRef.current = null
    setState(initialState)
  }

  return {
    ...state,
    startUpload,
    retryUpload,
    reset,
    isUploading:
      state.status === 'reserving' ||
      state.status === 'uploading' ||
      state.status === 'verifying',
  }
}
