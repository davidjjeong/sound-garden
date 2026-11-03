export function AudioPlayer() {
  return (
    <section className="music-player" aria-label="Audio player — no track selected">
      <div className="player-summary">
      <div className="player-artwork" aria-hidden="true">
        <svg viewBox="0 0 300 300" fill="none">
          <path d="M-25 200C70 70 230 25 330 95M-40 345C75 180 270 380 335 205" stroke="white" strokeOpacity=".55" strokeWidth="1.4" />
        </svg>
      </div>

      <div className="player-track-info">
        <h2>Select a track</h2>
        <p>Your music, ready to play.</p>
      </div>

      </div>

      <div className="player-timeline">
        <div className="player-seek-track" aria-hidden="true" />
        <div className="player-times"><span>--:--</span><span>--:--</span></div>
      </div>

      <div className="player-actions" role="group" aria-label="Playback controls">
        <button type="button" aria-label="Shuffle" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h3c4 0 8 10 12 10h3M18 14l3 3-3 3M3 17h3c1.5 0 3-1.4 4.5-3.3M13.5 10.3C15 8.4 16.5 7 18 7h3M18 4l3 3-3 3" /></svg>
        </button>
        <button type="button" aria-label="Previous track" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6v12M18 6l-9 6 9 6V6Z" /></svg>
        </button>
        <button className="player-play" type="button" aria-label="Play — select a track first" disabled>
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5 19 12 8 18.5V5.5Z" /></svg>
        </button>
        <button type="button" aria-label="Next track" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6v12M6 6l9 6-9 6V6Z" /></svg>
        </button>
        <button type="button" aria-label="Repeat" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" /></svg>
        </button>
      </div>
    </section>
  )
}
