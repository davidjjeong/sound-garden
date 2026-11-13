import { TrackLibraryView } from './TrackLibraryView'
import { useEffect, useRef, useState } from 'react'
import { getTracks } from '../../lib/tracks'
import { useTrackDeletion } from '../../hooks/useTrackDeletion'
import { DeleteTrackDialog } from './DeleteTrackDialog'
import { useTrackUpload } from '../../hooks/useTrackUpload'

import type { LibraryTrack } from '../../types/tracks'

type Props = {
  selectedTrackId?: string | null
  isPlaying?: boolean
  isLoadingTrack?: boolean
  onSelectTrack?: (track: LibraryTrack) => void
  onDeleteStart?: (id: string) => void
  onTrackDeleted?: (id: string) => void
}

export function TrackLibrary({ selectedTrackId, isPlaying, isLoadingTrack, onSelectTrack, onDeleteStart, onTrackDeleted }: Props) {
  const deletion = useTrackDeletion()
  const removedIds = useRef(new Set<string>())
  const [deleteMessage, setDeleteMessage] = useState('')
  const [tracks, setTracks] = useState<LibraryTrack[]>([])
  const [loading, setLoading] = useState(true)
  const [libraryError, setLibraryError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const { status, error: uploadError, completedTrack, canRetry, isUploading, startUpload, retryUpload, reset } = useTrackUpload()

  useEffect(() => {
    let active = true

    getTracks()
      .then((data) => {
        if (active) {
          setTracks(data.filter((track) => !removedIds.current.has(track.id)))
          setLibraryError('')
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLibraryError(
            error instanceof Error ? error.message : 'Could not load tracks.',
          )
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [completedTrack, reloadKey])

  async function handleDelete() {
    if (deletion.target) onDeleteStart?.(deletion.target.id)
    const id = await deletion.confirm()
    if (id) {
      removedIds.current.add(id)
      setTracks((current) => current.filter((track) => track.id !== id))
      setDeleteMessage('Track deleted.')
      onTrackDeleted?.(id)
    }
  }

  const uploadMessage = {
    idle: '',
    reserving: 'Preparing your upload…',
    uploading: 'Uploading your audio…',
    verifying: 'Verifying your track…',
    complete: 'Your track is ready.',
    error: '',
  }[status]

  return (
    <>
      {deletion.isOpen && deletion.target && (
        <DeleteTrackDialog title={deletion.target.title} isDeleting={deletion.isDeleting}
          error={deletion.error} onClose={deletion.close} onConfirm={() => void handleDelete()} />
      )}
      {deletion.error && !deletion.isOpen && (
        <div className="upload-feedback">
          <p role="alert">Could not finish deleting “{deletion.target?.title}”. {deletion.error}</p>
          <button type="button" onClick={deletion.reopen}>Retry deletion</button>
        </div>
      )}
      <p className="upload-status" role="status" aria-atomic="true">{deleteMessage}</p>
      {libraryError && (
        <div className="upload-feedback">
          <p role="alert">{libraryError}</p>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)}>
            Reload library
          </button>
        </div>
      )}
      {uploadError && (
        <div className="upload-feedback">
          <p role="alert">{uploadError}</p>
          <div className="upload-feedback-actions">
            {canRetry && (
              <button type="button" onClick={() => void retryUpload()} disabled={isUploading}>
                Retry upload
              </button>
            )}
            <button type="button" onClick={reset} disabled={isUploading}>Dismiss</button>
          </div>
        </div>
      )}
      <p className="upload-status" role="status" aria-atomic="true">{uploadMessage}</p>

      <TrackLibraryView tracks={tracks} loading={loading} isUploading={isUploading}
        selectedTrackId={selectedTrackId} isPlaying={isPlaying} isLoadingTrack={isLoadingTrack}
        deletingId={deletion.target?.id ?? null} isDeleting={deletion.isDeleting}
        onSelectTrack={onSelectTrack} onUpload={startUpload}
        onDelete={(track) => { setDeleteMessage(''); deletion.choose(track) }} />
    </>
  )
}
