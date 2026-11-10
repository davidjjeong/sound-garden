import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { AudioPlayback } from '../../hooks/useAudioPlayback'

function formatAudioTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const transport = {
  Shuffle: 'M3 7h3c4 0 8 10 12 10h3M18 14l3 3-3 3M3 17h3c1.5 0 3-1.4 4.5-3.3M13.5 10.3C15 8.4 16.5 7 18 7h3M18 4l3 3-3 3',
  'Previous track': 'M6 6v12M18 6l-9 6 9 6V6Z',
  'Next track': 'M18 6v12M6 6l9 6-9 6V6Z',
  Repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
}
function InactiveControl({ label }: { label: keyof typeof transport }) {
  return <button type="button" aria-label={label} title="Coming later" disabled>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={transport[label]} />
    </svg>
  </button>
}

export function AudioPlayer({ playback }: { playback: AudioPlayback }) {
  const { track, isPlaying, isLoading, isUnavailable, position, duration, volume, error, notice } = playback
  const disabled = !track || isUnavailable
  const [scrub, setScrub] = useState<{ trackId: string; position: number } | null>(null)
  const displayPosition = scrub && scrub.trackId === track?.id ? scrub.position : position
  function commitSeek(value: number) {
    if (scrub && scrub.trackId === track?.id) playback.seek(value)
    setScrub(null)
  }
  return (
    <section className="music-player" aria-label={track ? `Audio player — ${track.title}` : 'Audio player — no track selected'}>
      <div className="player-summary">
        <div className="player-artwork" aria-hidden="true" />
        <div className="player-track-info">
          <h2>{track?.title ?? 'Select a track'}</h2>
          <p>{track ? 'From your library' : 'Your music, ready to play.'}</p>
        </div>
      </div>
      <div className="player-timeline">
        <input className="player-seek" type="range" aria-label="Playback position" min="0"
          max={duration || 1} step="0.1" value={Math.min(displayPosition, duration || 0)}
          aria-valuetext={`${formatAudioTime(displayPosition)} of ${formatAudioTime(duration)}`}
          style={{ '--range-progress': `${duration > 0 ? Math.min(100, displayPosition / duration * 100) : 0}%` } as CSSProperties}
          disabled={disabled || duration <= 0}
          onChange={(event) => track && setScrub({ trackId: track.id, position: Number(event.target.value) })}
          onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
          onKeyUp={(event) => commitSeek(Number(event.currentTarget.value))}
          onBlur={(event) => commitSeek(Number(event.currentTarget.value))}
          onPointerCancel={() => setScrub(null)} />
        <div className="player-times">
          <span>{track ? formatAudioTime(displayPosition) : '--:--'}</span>
          <span>{duration > 0 ? formatAudioTime(duration) : '--:--'}</span>
        </div>
      </div>
      <div className="player-actions" role="group" aria-label="Playback controls">
        <InactiveControl label="Shuffle" />
        <InactiveControl label="Previous track" />
        <button className="player-play" type="button"
          aria-label={isPlaying ? 'Pause' : track ? 'Play' : 'Play — select a track first'}
          disabled={disabled || (isLoading && !isPlaying)}
          onClick={isPlaying ? playback.pause : playback.play}>
          {isLoading && !isPlaying ? <span className="delete-spinner" aria-hidden="true" />
            : <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d={isPlaying ? 'M7 5h4v14H7zM14 5h4v14h-4z' : 'M8 5.5 19 12 8 18.5V5.5Z'} />
            </svg>}
        </button>
        <InactiveControl label="Next track" />
        <InactiveControl label="Repeat" />
      </div>
      <div className="player-volume" role="group" aria-label="Volume controls">
        <button className="player-mute" type="button" aria-label={volume === 0 ? 'Unmute' : 'Mute'}
          aria-pressed={volume === 0} title={volume === 0 ? 'Unmute' : `Mute (${Math.round(volume * 100)}%)`}
          onClick={playback.toggleMute}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 5 6 9H3v6h3l5 4V5Z" />
            <path d={volume === 0 ? 'M16 9l5 6M21 9l-5 6' : volume < .5 ? 'M15 8a6 6 0 0 1 0 8' : 'M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14'} />
          </svg>
        </button>
        <input type="range" aria-label="Volume" min="0" max="1" step="0.01" value={volume}
          style={{ '--range-progress': `${volume * 100}%` } as CSSProperties}
          aria-valuetext={`${Math.round(volume * 100)} percent`} title={`${Math.round(volume * 100)}%`}
          onChange={(event) => playback.setVolume(Number(event.target.value))} />
      </div>
      <p className="player-status" role="status" aria-atomic="true">{isLoading ? 'Loading audio…' : notice}</p>
      {error && <div className="upload-feedback">
        <p role="alert">{error}</p>
        <button type="button" onClick={playback.retry} disabled={isLoading || isUnavailable}>Retry playback</button>
      </div>}
    </section>
  )
}
