export function AudioPlayer() {
  return (
    <div className="library-player" role="group" aria-label="Audio player — no track selected">
      <button type="button" aria-label="Play" disabled>▶</button>
      <span>--:--</span>
      <div className="player-progress" aria-hidden="true" />
      <span>--:--</span>
    </div>
  )
}
