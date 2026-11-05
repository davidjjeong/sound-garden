import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { getTracks } from '../../lib/tracks'
import { useTrackDeletion } from '../../hooks/useTrackDeletion'
import { DeleteTrackDialog, TrashIcon } from './DeleteTrackDialog'
import { useTrackUpload } from '../../hooks/useTrackUpload'

type Track = Awaited<ReturnType<typeof getTracks>>[number]

export function TrackLibrary() {
  const deletion = useTrackDeletion()
  const removedIds = useRef(new Set<string>())
  const [deleteMessage, setDeleteMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [libraryError, setLibraryError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const { status, error: uploadError, completedTrack, canRetry, isUploading, startUpload, retryUpload, reset } = useTrackUpload()
  const [query, setQuery] = useState('')

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

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    await startUpload(file)
  }

  async function handleDelete() {
    const id = await deletion.confirm()
    if (id) {
      removedIds.current.add(id)
      setTracks((current) => current.filter((track) => track.id !== id))
      setDeleteMessage('Track deleted.')
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

  const filteredTracks = tracks.filter((track) =>
    track.title.toLowerCase().includes(query.trim().toLowerCase()),
  )

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
      <input
        ref={inputRef}
        type="file"
        accept=".mp3,.wav"
        onChange={handleUpload}
        disabled={isUploading || loading}
        hidden
      />

      <div className="library-toolbar">
        <div>
          <h1 id="library-title">My library</h1>
          <p>
            {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
          </p>
        </div>

        <button
          className="upload-button"
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading || loading}
        >
          {isUploading ? 'Working…' : '+ Upload audio'}
        </button>
      </div>

      <input
        className="library-search"
        type="search"
        placeholder="Search your music"
        aria-label="Search your music"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

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

      {loading ? (
        <p role="status">Loading your library…</p>
      ) : tracks.length === 0 ? (
        <div className="upload-zone">
          <span className="empty-icon" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 23V9l13-3v14M13 13l13-3" />
              <ellipse cx="9" cy="24" rx="4" ry="3" />
              <ellipse cx="22" cy="21" rx="4" ry="3" />
            </svg>
          </span>
          <h2>Add your first track</h2>
          <p>Choose an MP3 or WAV file, up to 20 MiB.</p>

          <button
            className="upload-button"
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading || loading}
          >
            {isUploading ? 'Working…' : 'Choose files'}
          </button>
        </div>
      ) : filteredTracks.length === 0 ? (
        <p>No tracks match your search.</p>
      ) : (
        <ul className="track-list">
          {filteredTracks.map((track) => (
            <li className="track-row" key={track.id}>
              <span>{track.title}</span>
              <div className="track-row-actions">
                <span className="track-size">{(track.size_bytes / 1024 / 1024).toFixed(1)} MB</span>
                <button className="track-delete" type="button" aria-label={`Delete ${track.title}`}
                  title={`Delete ${track.title}`} disabled={deletion.target !== null}
                  onClick={(event) => { event.stopPropagation(); setDeleteMessage(''); deletion.choose(track) }}>
                  {deletion.isDeleting && deletion.target?.id === track.id
                    ? <span className="delete-spinner" aria-hidden="true" /> : <TrashIcon />}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
