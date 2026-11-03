export function WaveformView() {
  return (
    <div className="waveform-view">
      <div className="waveform-placeholder" aria-hidden="true">
        <div className="waveform-baseline" />
      </div>
      <h2 id="waveform-title">Your sound starts here</h2>
      <p>Upload a track, then press play to bring this space to life.</p>
    </div>
  )
}
