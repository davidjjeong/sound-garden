import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useHandTracking } from '../../hooks/useHandTracking'
import { useCamera } from '../../hooks/useCamera'
import { useHandControls } from '../../hooks/useHandControls'

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15],
  [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]

type Props = { volume: number; manualVolumeRevision: number; onVolumeChange: (volume: number) => void }

export function GestureControls({ volume, manualVolumeRevision, onVolumeChange }: Props) {
  const { videoRef, enabled, error, start, stop } = useCamera()
  const tracking = useHandTracking(enabled, videoRef)
  const controls = useHandControls({ enabled: enabled && tracking.status === 'ready',
    landmarks: tracking.landmarks, volume, manualVolumeRevision, onVolumeChange })
  const floating = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  function clamp(x: number, y: number) {
    const box = floating.current?.getBoundingClientRect()
    return {
      x: Math.max(8, Math.min(x, window.innerWidth - (box?.width ?? 280) - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - (box?.height ?? 300) - 8)),
    }
  }
  useEffect(() => {
    const resize = () => setPosition(previous => previous ? clamp(previous.x, previous.y) : previous)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const status = tracking.status === 'ready'
    ? tracking.landmarks.length ? 'Hand detected' : 'No hand detected'
    : tracking.status === 'error' ? 'Hand tracking unavailable' : 'Loading hand model…'
  return <div className="camera-controls">
    <button type="button" onClick={enabled ? stop : start}>
      {enabled ? 'Disable camera' : 'Enable camera'}
    </button>
    {error && <p className="camera-error" role="alert">{error}</p>}
    {createPortal(<div ref={floating} className="floating-camera" hidden={!enabled}
      style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}>
      <div className="camera-drag-header">
        <div className="camera-drag-handle" role="button" tabIndex={0}
          aria-label="Move camera preview. Drag or use arrow keys."
          onPointerDown={event => {
            if (event.button !== 0) return
            const box = floating.current!.getBoundingClientRect()
            drag.current = { id: event.pointerId, x: event.clientX - box.left, y: event.clientY - box.top }
            event.currentTarget.setPointerCapture(event.pointerId)
            event.preventDefault()
          }}
          onPointerMove={event => {
            const current = drag.current
            if (current?.id === event.pointerId) setPosition(clamp(event.clientX - current.x, event.clientY - current.y))
          }}
          onPointerUp={() => { drag.current = null }}
          onPointerCancel={() => { drag.current = null }}
          onLostPointerCapture={() => { drag.current = null }}
          onKeyDown={event => {
            if (event.key === 'Escape') { stop(); return }
            const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
            const direction = directions[event.key]
            if (!direction) return
            event.preventDefault()
            const box = floating.current!.getBoundingClientRect()
            const step = event.shiftKey ? 40 : 10
            setPosition(clamp(box.left + direction[0] * step, box.top + direction[1] * step))
          }}>⠿ <span>Hand tracking</span></div>
        <button type="button" className="camera-close" onClick={stop} aria-label="Close camera preview">×</button>
      </div>
      <div className="hand-preview">
        <video ref={videoRef} muted playsInline aria-label="Camera preview for hand tracking" />
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
          {tracking.landmarks.map((hand, index) => <g key={index}>
            {CONNECTIONS.map(([a, b]) => hand[a] && hand[b] && <line key={`${a}-${b}`}
              x1={hand[a].x * 1000} y1={hand[a].y * 1000}
              x2={hand[b].x * 1000} y2={hand[b].y * 1000}
              stroke="#b8f0c9" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
            {hand.map((point, i) => <ellipse key={i} cx={point.x * 1000} cy={point.y * 1000}
              rx="9" ry="12" fill="#fff" stroke="#303a34" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          </g>)}
        </svg>
      </div>
      <div className="camera-status">
        {enabled && <p role="status">{status}</p>}
        {enabled && tracking.status === 'ready' && <p className="pinch-status">
          {controls.mode === 'dragging' ? `Adjusting volume · ${Math.round(volume * 100)}%`
            : controls.mode === 'waitingForRelease' ? 'Release your pinch to grab again' : 'Pinch to adjust volume'}
        </p>}
        {tracking.error && <p role="alert">{tracking.error}</p>}
      </div>
    </div>, document.body)}
  </div>
}
