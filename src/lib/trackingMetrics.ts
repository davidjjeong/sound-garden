export type FrameOutcome = 'completed' | 'failed' | 'canceled' | 'stale'
type Sample = { frame: number; activeStartMs: number; latencyMs: number; hands: number }
type Frame = { session: number; id: number; started: number; activeStart: number; eligible: boolean }
const WARMUP_MS = 3000

/** Nearest-rank percentiles; null means no measured frames, not zero latency. */
export function percentile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1))]
}

export function createTrackingMetrics(clock = () => performance.now()) {
  let session = 0
  let running = false
  let available = false
  let activeMs = 0
  let segmentStart: number | null = null
  let startedAt: string | null = null
  let samples: Sample[] = []
  let nextFrame = 0
  let counts = { attempted: 0, completed: 0, warmupExcluded: 0, failed: 0, canceled: 0, stale: 0 }
  let metadata: Record<string, string | number> = {}
  const pending = new Map<number, Frame>()
  function elapsed(now: number) {
    return activeMs + (segmentStart === null ? 0 : Math.max(0, now - segmentStart))
  }
  function excludePending(reason: 'canceled' | 'stale') {
    counts[reason] += pending.size
    pending.clear()
  }
  function stop() {
    if (!running) return
    activeMs = elapsed(clock())
    segmentStart = null
    running = false
    excludePending('canceled')
  }
  function reset() {
    stop()
    session++
    activeMs = 0
    startedAt = null
    samples = []
    nextFrame = 0
    metadata = {}
    counts = { attempted: 0, completed: 0, warmupExcluded: 0, failed: 0, canceled: 0, stale: 0 }
  }
  function snapshot() {
    const duration = elapsed(clock())
    const measuredMs = Math.max(0, duration - WARMUP_MS)
    const latencies = samples.map(sample => sample.latencyMs)
    return {
      schemaVersion: 1, session, startedAt, running, available,
      warmupMs: WARMUP_MS, activeMs: duration, measuredMs,
      sampleCount: samples.length,
      p50Ms: percentile(latencies, .5), p95Ms: percentile(latencies, .95),
      resultsPerSecond: measuredMs > 0 ? samples.length / (measuredMs / 1000) : null,
      counts: { ...counts }, metadata: { ...metadata },
      pendingFrames: pending.size,
      definition: 'Capture-to-result: before createImageBitmap to worker result arrival on main thread.',
    }
  }
  return {
    start(info: Record<string, string | number> = {}) {
      reset()
      running = true
      startedAt = new Date().toISOString()
      metadata = { ...info, captureIntervalMs: 50, configuredMaxFps: 20 }
      if (available) segmentStart = clock()
    },
    stop, reset, snapshot,
    setAvailable(value: boolean, reason: 'canceled' | 'stale' = 'canceled') {
      if (available === value) return
      const now = clock()
      activeMs = elapsed(now)
      segmentStart = null
      available = value
      if (!value) excludePending(reason)
      if (running && value) segmentStart = now
    },
    beginFrame(width: number, height: number): Frame | null {
      if (!running || !available) return null
      const now = clock()
      const activeStart = elapsed(now)
      const frame = { session, id: ++nextFrame, started: now, activeStart, eligible: activeStart >= WARMUP_MS }
      pending.set(frame.id, frame)
      counts.attempted++
      metadata.cameraWidth = width
      metadata.cameraHeight = height
      return frame
    },
    finishFrame(frame: Frame | null, outcome: FrameOutcome, hands = 0) {
      if (!frame || frame.session !== session || pending.get(frame.id) !== frame) return
      pending.delete(frame.id)
      if (outcome !== 'completed') { counts[outcome]++; return }
      counts.completed++
      if (!frame.eligible) { counts.warmupExcluded++; return }
      const latency = clock() - frame.started
      if (!Number.isFinite(latency) || latency < 0) { counts.failed++; counts.completed--; return }
      samples.push({ frame: frame.id, activeStartMs: frame.activeStart, latencyMs: latency, hands })
    },
    exportJson() { return JSON.stringify({ ...snapshot(), samples: samples.map(sample => ({ ...sample })) }, null, 2) },
    exportCsv() {
      return ['frame,active_start_ms,latency_ms,hands', ...samples.map(s => `${s.frame},${s.activeStartMs},${s.latencyMs},${s.hands}`)].join('\n')
    },
  }
}
export type TrackingMetrics = ReturnType<typeof createTrackingMetrics>
export type TrackingFrame = ReturnType<TrackingMetrics['beginFrame']>
export const trackingMetrics = /* @__PURE__ */ createTrackingMetrics()
