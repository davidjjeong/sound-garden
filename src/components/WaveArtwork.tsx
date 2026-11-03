import { useId, useState } from 'react'

/** Decorative illustration, independent of the future live audio renderer. */
export function WaveArtwork() {
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const paths = Array.from({ length: 12 }, (_, layer) => {
    const points = Array.from({ length: 241 }, (_, i) => {
      const x = 30 + i * 2
      const envelope = Math.exp(-Math.pow((i - 118) / 73, 2))
      const y = 170 + Math.sin(i * 0.105 + layer * 0.12) * envelope * 76
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
    return <path key={layer} d={points} transform={`translate(${layer * 3},${-layer * 5})`} opacity={1 - layer * 0.065} />
  })

  return (
    <button
      type="button"
      className={`wave-artwork${expanded ? ' is-expanded' : ''}`}
      aria-label="Toggle waveform illustration amplitude"
      aria-pressed={expanded}
      onClick={() => setExpanded(!expanded)}
    >
      <svg viewBox="0 0 570 340" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" x2="1">
            <stop stopColor="#76bc96" />
            <stop offset=".5" stopColor="#bfa0d6" />
            <stop offset="1" stopColor="#92d4b3" />
          </linearGradient>
        </defs>
        <path d="M28 205H548 M55 255H520 M85 290H490" stroke="#dcd0e5" opacity=".3" />
        <g className="wave-traces" fill="none" stroke={`url(#${id})`} strokeWidth="1.65">
          {paths}
        </g>
      </svg>
      <span className="wave-artwork-hint">A little movement changes everything <span aria-hidden="true">↗</span></span>
    </button>
  )
}
