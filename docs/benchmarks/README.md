# Tracking latency benchmark

This is an opt-in **development-only** tool for capture-to-result latency and
achieved tracking throughput.

## Run a session

1. Run `npm run dev` and sign in.
2. Open `/studio?benchmark=1` on that local server.
3. Enable the camera and wait for hand tracking to become ready.
4. Enter your device description and lighting in the benchmark panel.
5. Click **Start**. The first **3 active seconds** are warm-up.
6. Keep the tab visible for **60 measured active seconds**. Move one hand left,
   right, up, and down; open/close fingers, rotate slightly, and occasionally move
   out of view. Do not leave the panel in another browser tab while measuring.
7. Click **Stop**, then **Export JSON** and/or **Export CSV**.
8. Repeat three times under the same conditions. Starting again clears the previous
   session, so export before restarting. Save downloads under `benchmark-results/`
   if storing inside this repository; that directory is ignored by Git.

Music playback is optional. Record whether it was playing in your test notes and
keep the workload consistent across runs. Normal gestures remain active, so they
can still adjust volume or toggle playback during measurement.

## Exactly what is timed

```text
T0: main thread, immediately before createImageBitmap(video)
    → capture bitmap
    → transfer to worker
    → MediaPipe detects hand landmarks
    → return results to main thread
T1: main thread, when the result handler runs

latency = T1 - T0
```

Both timestamps use the main thread's `performance.now()`. Only one frame is in
flight; the capture's measurement token identifies its session. A frame captured
before Start, Reset, or a new session cannot contaminate that new session.

This is **capture-to-result latency**. It excludes camera sensor/internal buffering,
waiting for the next 50 ms capture opportunity, rendering, and intentional gesture
hold time. Model initialization is excluded. Results with zero detected hands
are included: processing a no-hand frame still takes work.

## Accounting

- **Warm-up:** first 3000 ms of active, visible, ready tracking. A frame begun
  during warm-up is excluded even if it finishes after warm-up.
- **Active time:** runs only while a session is running and tracking is ready and
  the document is visible. Disabling camera, tracking failure, and hiding the tab
  pause it. Warm-up resumes rather than restarts across pauses.
- **Measured time:** active time minus the warm-up, floored at zero.
- **p50 / p95:** nearest-rank percentiles of eligible completed frame latencies.
  A dash/null means no samples, not zero latency.
- **Throughput:** eligible completed results divided by measured active seconds.
  This is not the configured 20 FPS capture cap.
- **Failed:** capture/transfer/inference failures associated with pending samples.
- **Canceled:** outstanding samples at Stop, camera disable, or cleanup.
- **Stale:** outstanding samples invalidated across visibility changes or explicitly
  rejected as obsolete. Each token is finalized at most once.

Exclusion counters cover the session, including warm-up. Frames never captured
because tracking was busy are not failures. The collector is not a general network
or frame-drop monitor. It doesn't detect a permanently hung worker; such a run
would show low throughput and outstanding work, rather than invented latency.

Stopping freezes duration and excludes pending work. Exports are enabled after
Stop so the JSON/CSV reflects a completed session. Reset clears session data.
The panel refreshes once per second; frame instrumentation does not trigger React
renders. Percentiles are recomputed only when reading a snapshot/export.

## Export contents

**JSON:** definition, session, start time, configured capture interval/cap, warm-up,
active/measured duration, p50/p95, throughput, counters, metadata, and raw samples.

**CSV:** one eligible completed sample per row:

```text
frame,active_start_ms,latency_ms,hands
```

Metadata includes the manually entered device/lighting, browser user-agent string,
and captured video width/height. No video images, audio, landmarks, credentials,
account IDs, or device IDs are exported. Files download locally; the tool does not
send benchmark results to Supabase or any analytics service.

Review metadata before publishing results. Report device/browser and conditions
with numbers; do not present a single-device result as a universal performance
claim. When pooling runs, compute percentiles from all individual samples and
throughput from total samples divided by total measured time.

## Production isolation

Both panel mounting and tracking instrumentation require:

```ts
import.meta.env.DEV &&
  new URLSearchParams(window.location.search)
    .get('benchmark') === '1'
```

Vercel preview and production deployments use production builds, so their DEV
flag is false. Adding `?benchmark=1` there cannot enable collection. The panel
and collector are dynamically imported inside development guards, allowing Vite
to omit them from production output. This introduces no benchmark camera prompt
or additional audio pipeline.

## Code and tests

- `src/lib/trackingMetrics.ts`: session clock, tokens, counters, percentiles, exports.
- `src/hooks/useHandTracking.ts`: guarded capture/result instrumentation and lifecycle.
- `src/components/studio/BenchmarkPanel.tsx`: session controls and local downloads.
- `tests/browser/trackingMetrics.test.ts`: arithmetic, warm-up boundary, exclusions,
  hidden/unavailable time, session isolation, stop/reset, JSON/CSV.
- `tests/browser/BenchmarkPanel.test.ts`: controls, display refresh, export, cleanup.
- `tests/browser/useHandTracking.test.ts`: capture/result boundary integration and
  rejection of a frame already in flight when measurement begins.

```sh
npm test
npm run lint
npm run build
```

After a production build, inspect `dist/assets` to confirm no benchmark panel
chunk or collector definitions were emitted. Test measurements are synthetic;
real performance values require running the camera sessions described above.
