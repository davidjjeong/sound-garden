import { useHandTracking } from '../../hooks/useHandTracking'
import { useCamera } from '../../hooks/useCamera'

export function GestureControls() {
  const { videoRef, enabled, error, start, stop } = useCamera()

  const tracking = useHandTracking(enabled)

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

      {enabled && <p role="status">
        {tracking.status === 'ready' ? 'Hand model ready — detection comes next.'
          : tracking.status === 'error' ? 'Hand tracking unavailable.' : 'Loading hand model…'}
      </p>}
      {tracking.error && <p role="alert">{tracking.error}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}