# Hand-tracking latency and throughput

Measured on November 12, 2026 using the development-only benchmark panel.

Across **3,550 measured frames** and **186.8 active seconds**, the app achieved
**20.0 ms median** and **22.2 ms p95 capture-to-result latency**, with **19.0
completed results per second** against a configured 20 FPS capture cap.

## Original exports

These JSON files are unchanged copies of the browser downloads:

1. [tracking-1.json](tracking-1.json)
2. [tracking-4.json](tracking-4.json)
3. [tracking-5.json](tracking-5.json)

The filenames contain benchmark session IDs, not sequential experiment numbers.
Start and Reset advance that counter; the gaps do not indicate missing frames
or establish that additional measured runs occurred.

## Test conditions

The three exports record the same conditions:

- Device description entered by tester: **MacBook Pro M5**.
- Browser user-agent reports **Chrome 156.0.0.0** on macOS.
- Lighting entered by tester: **daylight, desk lamp**.
- Captured image resolution: **640 × 480**.
- Minimum capture interval: **50 ms**, or at most **20 FPS**.
- Warm-up: **3 active seconds per session**, excluded from measured latency/time.
- Processing: MediaPipe Hand Landmarker in a Web Worker, one frame in flight.

Device and lighting are manually entered descriptions, not independently detected
hardware measurements. Playback workload, exact camera distance, and the sequence
of hand movements were not recorded, so these should not be treated as perfectly
controlled experiments.

## Per-run results

| Metric | Run 1 | Run 2 | Run 3 |
|---|---:|---:|---:|
| Export session ID | 1 | 4 | 5 |
| Measured active time | 62.890 s | 62.540 s | 61.391 s |
| Measured frames | 1,193 | 1,183 | 1,174 |
| Median latency (p50) | 20.1 ms | 19.7 ms | 20.0 ms |
| p95 latency | 22.4 ms | 21.7 ms | 22.3 ms |
| p99 latency | 34.2 ms | 33.5 ms | 34.0 ms |
| Maximum latency | 35.9 ms | 34.5 ms | 35.5 ms |
| Achieved throughput | 18.97/s | 18.92/s | 19.12/s |
| Warm-up results excluded | 57 | 57 | 57 |
| Failed / canceled / stale | 0 / 0 / 0 | 0 / 1 / 0 | 0 / 0 / 0 |

The one canceled attempt was excluded from latency samples. Its specific reason
is not included in the export; stopping with a frame in flight is one possible
cause. No failures or stale frames were recorded during these sessions.

## Pooled results

Combining all eligible samples, rather than averaging the runs' percentiles:

- Measured frames: **3,550**.
- Measured active duration: **186.8205 seconds**.
- Median latency: **20.0 ms**.
- p95 latency: **22.2 ms**.
- p99 latency: **34.0 ms**.
- Maximum latency: **35.9 ms**.
- Achieved throughput: **19.002 results/second**.
- Failed attempts: **0**.
- Canceled attempts: **1**.
- Stale attempts: **0**.
- Warm-up results excluded: **171**.

No measured frame took more than 50 ms. This shows processing headroom relative
to the configured capture interval on this setup, not a guarantee of performance
on other devices.

## What latency includes

The main thread timestamps each frame:

```text
Start: immediately before createImageBitmap(video)
  → capture the current image
  → transfer to the worker
  → MediaPipe inference
  → deliver the result to the main thread
End: when the worker-result handler runs
```

Both timestamps use `performance.now()` on the main thread.

This measures **capture-to-result latency**. It does not include camera sensor or
internal buffering, waiting for the next capture opportunity, drawing landmarks,
gesture smoothing, audio output buffering, or the intentional 600 ms palm hold.
It is not full hand-motion-to-audio latency.

The collector excludes frames begun during warm-up, and cancels or rejects
outstanding work on stop, session changes, or visibility changes. Only active,
visible, ready tracking contributes to the measurement clock.

See the [benchmark procedure](../../docs/benchmarks/README.md) and
[collector implementation](../../src/lib/trackingMetrics.ts).

## Hand-present versus no-hand results

| Result | Run 1 | Run 2 | Run 3 | Total |
|---|---:|---:|---:|---:|
| One hand detected | 897 | 922 | 920 | 2,739 |
| No hand detected | 296 | 261 | 254 | 811 |

Both kinds of completed results are included in latency measurements. These
counts are **not recognition accuracy**: there are no per-frame ground-truth
labels describing whether the tester's hand should have been detected.

Likewise, these exports do not establish pinch/palm interaction success rates,
false activation rates, upload throughput, or concurrent deduplication behavior.

## Recompute from the exports

Run from the repository root:

```sh
python3 - <<'PY'
import json
import math
from pathlib import Path

files = [
    'tracking-1.json',
    'tracking-4.json',
    'tracking-5.json',
]
latencies = []
seconds = 0
for name in files:
    path = Path('metrics/hand-tracking') / name
    data = json.loads(path.read_text())
    samples = data['samples']
    assert len(samples) == data['sampleCount']
    assert all(
        s['activeStartMs'] >= data['warmupMs']
        for s in samples
    )
    latencies.extend(s['latencyMs'] for s in samples)
    seconds += data['measuredMs'] / 1000

latencies.sort()
def percentile(fraction):
    rank = math.ceil(len(latencies) * fraction)
    return latencies[max(0, rank - 1)]

print('Frames:', len(latencies))
print('Measured seconds:', seconds)
print('p50 ms:', percentile(.50))
print('p95 ms:', percentile(.95))
print('p99 ms:', percentile(.99))
print('Results/sec:', len(latencies) / seconds)
PY
```

Percentiles use the nearest-rank definition. Throughput uses total eligible
results divided by total measured active seconds. Published display values are
rounded; the JSON retains the original precision.