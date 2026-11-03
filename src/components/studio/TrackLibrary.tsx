import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { getTracks, uploadTrack } from '../../lib/tracks'

type Track = Awaited<ReturnType<typeof getTracks>>[number]

export function TrackLibrary() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let active = true

    getTracks()
      .then((data) => {
        if (active) setTracks(data)
      })
      .catch((error: unknown) => {
        if (active) {
          setError(
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
  }, [])

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    setUploading(true)
    setError('')

    try {
      const track = await uploadTrack(file)
      setTracks((current) => [track, ...current])
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not upload track.',
      )
    } finally {
      setUploading(false)
    }
  }

  const filteredTracks = tracks.filter((track) =>
    track.title.toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".mp3,.wav"
        onChange={handleUpload}
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
          disabled={uploading || loading}
        >
          {uploading ? 'Uploading…' : '+ Upload audio'}
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

      {error && <p role="alert">{error}</p>}
      {uploading && <p role="status">Uploading your track…</p>}

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
          <p>Choose an MP3 or WAV file, up to 20 MB.</p>

          <button
            className="upload-button"
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Choose files'}
          </button>
        </div>
      ) : filteredTracks.length === 0 ? (
        <p>No tracks match your search.</p>
      ) : (
        <ul className="track-list">
          {filteredTracks.map((track) => (
            <li className="track-row" key={track.id}>
              <span>{track.title}</span>
              <span className="track-size">
                {(track.size_bytes / 1024 / 1024).toFixed(1)} MB
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
