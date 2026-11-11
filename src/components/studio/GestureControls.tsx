import { useCamera } from '../../hooks/useCamera'

export function GestureControls() {
  const { videoRef, enabled, error, start, stop } = useCamera()

  return (
    <div className="gesture-toolbar">
      <button type="button" onClick={enabled ? stop : start}>
        {enabled ? 'Disable camera' : 'Enable camera'}
      </button>

      <video
        ref={videoRef}
        muted
        playsInline
        aria-label="Camera preview for hand tracking"
        style={{
          display: enabled ? 'block' : 'none',
          width: '100%',
          maxWidth: 240,
          aspectRatio: '4 / 3',
          objectFit: 'cover',
          borderRadius: 12,
          transform: 'scaleX(-1)',
          marginTop: 12,
        }}
      />

      {error && <p role="alert">{error}</p>}
    </div>
  )
}