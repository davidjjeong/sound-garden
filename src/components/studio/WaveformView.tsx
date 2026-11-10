import { useEffect, useRef } from 'react'

const BAR_COUNT = 96
const EMPTY_BARS = Array.from({ length: BAR_COUNT }, (_, i) => i)
type Props = { readFrequencyBands: () => Float32Array | null; isPlaying: boolean }

export function WaveformView({ readFrequencyBands, isPlaying }: Props) {
  const group = useRef<SVGGElement>(null)
  const playback = useRef({ readFrequencyBands, isPlaying })
  useEffect(() => { playback.current = { readFrequencyBands, isPlaying } }, [readFrequencyBands, isPlaying])
  useEffect(() => {
    const bars = Array.from(group.current?.children ?? []) as SVGRectElement[]
    const heights = new Float32Array(BAR_COUNT)
    let previous: number | null = null
    let frame = 0
    function animate(time = 0) {
      const delta = previous === null ? 16 : Math.min(Math.max(time - previous, 0), 50)
      previous = time
      const spectrum = playback.current.isPlaying ? playback.current.readFrequencyBands() : null
      const levelAt = (i: number) => {
        if (!spectrum?.length) return 0
        const index = Math.max(0, Math.min(BAR_COUNT - 1, i)) / (BAR_COUNT - 1) * (spectrum.length - 1)
        const start = Math.floor(index)
        const fraction = index - start
        return spectrum[start] * (1 - fraction) + spectrum[Math.min(start + 1, spectrum.length - 1)] * fraction
      }
      for (let i = 0; i < BAR_COUNT; i++) {
        // Neighbor blending softens the outline, preserving independent bar motion.
        const level = levelAt(i - 1) * .2 + levelAt(i) * .6 + levelAt(i + 1) * .2
        const target = Math.min(1, Math.log1p(Math.max(0, level) * 35) / Math.log(36))
        // Quick attack follows percussion; a longer release prevents flicker.
        const response = target > heights[i] ? 45 : 160
        heights[i] += (target - heights[i]) * (1 - Math.exp(-delta / response))
        const height = 2 + heights[i] * 310
        bars[i]?.setAttribute('y', String(300 - height / 2))
        bars[i]?.setAttribute('height', String(height))
      }
      frame = requestAnimationFrame(animate)
    }
    animate()
    return () => cancelAnimationFrame(frame)
  }, [])
  return <div className="waveform-view">
    <div className="waveform-canvas waveform-2d live-visualizer">
      <svg viewBox="0 0 1000 600" preserveAspectRatio="none" role="img" aria-label="Live music visualizer">
        <g ref={group} fill="#303a34">
          {EMPTY_BARS.map(i => <rect key={i} x={90 + (i + .5) / BAR_COUNT * 820 - 2.2}
            y="299" width="4.4" height="2" rx="2.2" />)}
        </g>
      </svg>
    </div>
    <div className="waveform-copy"><h2 id="waveform-title">Your sound</h2><p>In motion with your music.</p></div>
  </div>
}
