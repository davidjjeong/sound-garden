import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { trackingMetrics } from '../../lib/trackingMetrics'
import './BenchmarkPanel.css'

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const display = (value: number | null, suffix = '') => value === null ? '—' : `${value.toFixed(1)}${suffix}`

export default function BenchmarkPanel() {
  const [snapshot, setSnapshot] = useState(() => trackingMetrics.snapshot())
  const [device, setDevice] = useState('')
  const [lighting, setLighting] = useState('')
  const refresh = () => setSnapshot(trackingMetrics.snapshot())
  useEffect(() => {
    const timer = window.setInterval(refresh, 1000)
    return () => { window.clearInterval(timer); trackingMetrics.stop() }
  }, [])
  const phase = !snapshot.running ? snapshot.startedAt ? 'Stopped' : 'Not started'
    : !snapshot.available ? 'Waiting for visible, ready camera'
    : snapshot.activeMs < snapshot.warmupMs ? 'Warming up (3 active seconds)' : 'Measuring'
  return createPortal(<aside className="benchmark-panel" aria-label="Development tracking benchmark">
    <header><strong>Tracking benchmark</strong><span>DEV ONLY</span></header>
    <p>Capture-to-result latency. No images are recorded.</p>
    <label>Device description<input value={device} disabled={snapshot.running} onChange={e => setDevice(e.target.value)} placeholder="e.g. MacBook Air M2" /></label>
    <label>Lighting<input value={lighting} disabled={snapshot.running} onChange={e => setLighting(e.target.value)} placeholder="e.g. daylight, desk lamp" /></label>
    <div className="benchmark-actions">
      <button disabled={snapshot.running} onClick={() => {
        trackingMetrics.start({ device, lighting, browser: navigator.userAgent })
        refresh()
      }}>Start</button>
      <button disabled={!snapshot.running} onClick={() => { trackingMetrics.stop(); refresh() }}>Stop</button>
      <button onClick={() => { trackingMetrics.reset(); refresh() }}>Reset</button>
    </div>
    <p role="status">{phase}</p>
    <dl>
      <div><dt>Measured active time</dt><dd>{(snapshot.measuredMs / 1000).toFixed(1)} s</dd></div>
      <div><dt>Measured frames</dt><dd>{snapshot.sampleCount}</dd></div>
      <div><dt>p50 / p95</dt><dd>{display(snapshot.p50Ms)} / {display(snapshot.p95Ms, ' ms')}</dd></div>
      <div><dt>Achieved throughput</dt><dd>{display(snapshot.resultsPerSecond, ' results/s')}</dd></div>
      <div><dt>Warm-up frames excluded</dt><dd>{snapshot.counts.warmupExcluded}</dd></div>
      <div><dt>Failed / canceled / stale</dt><dd>{snapshot.counts.failed} / {snapshot.counts.canceled} / {snapshot.counts.stale}</dd></div>
    </dl>
    <p>Measure for 60 active seconds after warm-up, then Stop. Repeat three times. The configured capture cap is 20 FPS.</p>
    <div className="benchmark-actions">
      <button disabled={snapshot.running || !snapshot.startedAt} onClick={() => download(`tracking-${snapshot.session}.json`, trackingMetrics.exportJson(), 'application/json')}>Export JSON</button>
      <button disabled={snapshot.running || !snapshot.startedAt} onClick={() => download(`tracking-${snapshot.session}.csv`, trackingMetrics.exportCsv(), 'text/csv')}>Export CSV</button>
    </div>
  </aside>, document.body)
}
