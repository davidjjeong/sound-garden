# How Sound Garden’s hand gestures work

A code walkthrough of **pinch-and-drag volume** and **open-palm hold play/pause**.

This guide describes the implemented system, not a future design. It uses short
sections and small code excerpts so you can read it on a phone. Excerpts sometimes
omit surrounding code; follow the source links for complete implementations.

## Contents

1. [The complete workflow](#1-the-complete-workflow)
2. [Which file does what](#2-which-file-does-what)
3. [Starting and stopping the camera](#3-starting-and-stopping-the-camera)
4. [Loading MediaPipe](#4-loading-mediapipe)
5. [Sending frames to the worker](#5-sending-frames-to-the-worker)
6. [Receiving and drawing landmarks](#6-receiving-and-drawing-landmarks)
7. [Recognizing a pinch](#7-recognizing-a-pinch)
8. [Turning a pinch into a volume grab](#8-turning-a-pinch-into-a-volume-grab)
9. [Making volume movement smooth](#9-making-volume-movement-smooth)
10. [Respecting manual volume controls](#10-respecting-manual-volume-controls)
11. [Updating the slider, sound, and visualizer](#11-updating-the-slider-sound-and-visualizer)
12. [Recognizing an open palm](#12-recognizing-an-open-palm)
13. [Holding, triggering, and rearming](#13-holding-triggering-and-rearming)
14. [How the React hook coordinates both gestures](#14-how-the-react-hook-coordinates-both-gestures)
15. [Connecting the gestures to playback](#15-connecting-the-gestures-to-playback)
16. [What the preview displays](#16-what-the-preview-displays)
17. [Interruptions and cleanup](#17-interruptions-and-cleanup)
18. [Tests and limitations](#18-tests-and-limitations)
19. [Settings you can tune](#19-settings-you-can-tune)

## 1. The complete workflow

The browser runs two connected pipelines:

```text
Camera stream
  → video element
  → captured image
  → worker + MediaPipe
  → hand landmarks
  → gesture controllers
  → existing player actions
```

```text
Audio player
  → volume gain
  → frequency analyser
  → speakers
       + live visualizer
```

The gesture system calls player functions. It does not create a second player,
record the song, or upload camera images to Supabase.

**What uses machine learning?** MediaPipe’s pretrained model estimates hand
landmarks. Our TypeScript geometry and state machines decide whether those points
mean “pinching,” “open palm,” or a valid interaction. We did not train a new model
or add MediaPipe’s separate Gesture Recognizer classifier.

## 2. Which file does what

**Camera lifecycle:**
[useCamera.ts](../../src/hooks/useCamera.ts)

Requests permission, attaches a stream to the preview, handles disconnects, and
releases resources.

**Tracking lifecycle:**
[useHandTracking.ts](../../src/hooks/useHandTracking.ts)

Starts the worker, captures camera frames, prevents a processing backlog, and
stores returned landmarks.

**ML inference:**
[handTracking.worker.ts](../../src/workers/handTracking.worker.ts)

Loads the runtime/model and runs hand-landmark detection outside the UI thread.

**Message contracts:**
[handTracking.ts](../../src/types/handTracking.ts)

Defines the messages and point types shared by the worker and React.

**Gesture geometry and state machines:**
[gestures.ts](../../src/lib/gestures.ts)

Detects poses and manages volume grabs and palm holds. It has no camera, React,
or audio dependencies, so synthetic points can test it directly.

**React coordination:**
[useHandControls.ts](../../src/hooks/useHandControls.ts)

Feeds new landmarks to both controllers and dispatches player callbacks.

**Preview and feedback:**
[GestureControls.tsx](../../src/components/studio/GestureControls.tsx)

Combines camera, tracking, and interaction hooks; draws landmarks; renders the
floating preview and gesture instructions.

**Player wiring:**
[Studio.tsx](../../src/components/studio/Studio.tsx),
[useAudioPlayback.ts](../../src/hooks/useAudioPlayback.ts), and
[audioEngine.ts](../../src/lib/audioEngine.ts).

## 3. Starting and stopping the camera

Clicking **Enable camera** calls `useCamera.start()`:

```ts
navigator.mediaDevices.getUserMedia({
  video: {
    facingMode: 'user',
    width: { ideal: 640 },
    height: { ideal: 480 },
  },
  audio: false,
})
```

The dimensions are preferences, not guarantees. No microphone is requested.

The returned `MediaStream` is attached with:

```ts
video.srcObject = stream
await video.play()
```

Only after preview playback succeeds does the hook mark the camera enabled.

A resource record stores the stream, attached video, startup generation, and
listener cleanup. A generation is a request identifier: stopping or unmounting
changes it, so a late permission response cannot activate an obsolete stream.

The preview video remains mounted while hidden. Otherwise `videoRef.current`
could be missing when the camera starts.

## 4. Loading MediaPipe

When the camera becomes enabled, `useHandTracking` creates a module worker:

```ts
new Worker(
  new URL(
    '../workers/handTracking.worker.ts',
    import.meta.url,
  ),
  { type: 'module' },
)
```

The hook sends an initialization message containing the local asset base URL.
The worker reports `loading`, then initializes:

```ts
const vision = await FilesetResolver
  .forVisionTasks(`${assetBase}wasm`, true)
```

The second argument selects the **ES-module WASM loader**, matching the module
worker. A classic-script loader caused a startup mismatch during development.

The model configuration includes:

```ts
{
  runningMode: 'VIDEO',
  numHands: 1,
  minHandDetectionConfidence: 0.6,
  minHandPresenceConfidence: 0.6,
  minTrackingConfidence: 0.6,
}
```

These are separate detection/presence/tracking thresholds. They are not a single
“gesture confidence” score.

The CPU delegate runs inside the worker. This keeps synchronous inference off
the main thread, though actual speed still depends on hardware.

A shared initialization promise prevents duplicate model loads in one worker.
Failure clears that promise so initialization can retry. Success reports `ready`.

The model and runtime are served from `public/mediapipe/`. Camera processing then
runs locally. The worker is terminated when tracking is disabled.

## 5. Sending frames to the worker

The capture loop uses `requestAnimationFrame`, but does not process every render.
It checks:

- Is the model ready?
- Is the tab visible?
- Is the video ready and nonempty?
- Has at least **50 ms** passed since capture?
- Has `video.currentTime` changed?
- Is another capture/inference already in flight?

Fifty milliseconds gives a maximum of about **20 captures per second**. It is a
cap, not a guaranteed frame rate.

Before capturing, the hook sets:

```ts
busy = true
```

It creates an `ImageBitmap` from the video, then transfers it:

```ts
worker.postMessage(
  { type: 'frame', frame, timestamp },
  [frame],
)
```

The transfer list moves ownership to the worker. Until a result returns, `busy`
prevents another frame from being sent. Slow inference therefore drops capture
opportunities instead of accumulating an increasingly delayed queue.

Inside the worker:

```ts
const result = landmarker.detectForVideo(
  message.frame,
  message.timestamp,
)
```

It replies with `result.landmarks`. Regardless of success or failure:

```ts
finally {
  message.frame.close()
}
```

If capture finishes after disable or a tab switch, the main thread closes the
bitmap instead of transferring it.

## 6. Receiving and drawing landmarks

The shared point type is:

```ts
type HandPoint = {
  x: number
  y: number
  z: number
}
```

`landmarks` is an array of hands. Each detected hand normally contains **21
points**. We configure one hand and use `landmarks[0]`; an empty array means no
hand was returned for that frame.

Important indices:

- `0`: wrist.
- `4`: thumb tip.
- `8`: index fingertip.
- `9`: middle-finger base knuckle.
- `5`, `9`, `13`, `17`: the four non-thumb base knuckles.

Image-space X and Y are normalized to the image dimensions. Y increases downward.
Z is a model-estimated relative depth coordinate; these are **not physical meters**.
Our geometry uses these coordinates as a practical heuristic, not a calibrated
3D measurement system.

The overlay maps normalized X/Y into an SVG coordinate space:

```ts
x = point.x * 1000
y = point.y * 1000
```

Video and overlay share the same mirrored wrapper. We mirror presentation, not
volume math: moving upward still decreases Y. Using the video's intrinsic aspect
ratio avoids cropping that would misalign the overlay.

## 7. Recognizing a pinch

Function: `detectPinch(hand, wasPinching)`.

First, it rejects a missing/incomplete hand or nonfinite coordinates in the four
points used by the detector. It also rejects a palm size below `0.0001`, avoiding
unstable division.

Distance uses:

```ts
Math.hypot(
  a.x - b.x,
  a.y - b.y,
  a.z - b.z,
)
```

The two measurements are:

```text
Palm size:
  wrist (0) → middle knuckle (9)

Pinch gap:
  thumb tip (4) → index tip (8)
```

Then:

```ts
pinchRatio = pinchGap / palmSize
```

If the hand appears twice as large, both distances approximately double, keeping
the ratio similar. This reduces sensitivity to camera distance; it does not
eliminate perspective, rotation, or depth-estimation effects.

The thresholds depend on previous state:

```ts
return wasPinching
  ? pinchRatio < 0.4
  : pinchRatio <= 0.25
```

This is **hysteresis**: different thresholds for entering and leaving a state.

Example sequence:

```text
0.50 → not pinching
0.24 → pinch begins
0.30 → pinch stays active
0.39 → still pinching
0.40 → pinch releases
```

Without this gap, tiny landmark movements near one threshold could rapidly switch
between grab and release.

## 8. Turning a pinch into a volume grab

Factory: `createHandVolumeController()`.

It returns an `update()` function with persistent closure state. React keeps the
controller instance in a ref, so it survives renders.

There are three modes:

- **`idle`**: no active grab.
- **`dragging`**: an active pinch controls volume.
- **`waitingForRelease`**: manual input interrupted control; release before grabbing.

The hand position is the fingertips' midpoint:

```ts
y = (hand[4].y + hand[8].y) / 2
```

On the transition from not pinching to pinching:

```ts
startY = smoothY = y
startVolume = lastVolume = input.volume
lastTime = input.timestamp
```

The controller returns `dragging` **without a volume command**. Touching your
fingers together therefore does not jump the volume.

Later results measure movement relative to this saved anchor. They do not map
absolute camera height directly to an absolute volume.

Missing/invalid hand data, release, or disabling clears the grab. A later pinch
records a new anchor using the volume currently displayed.

## 9. Making volume movement smooth

The controller applies three protections.

### Time-based smoothing

```ts
elapsed = clamp(timestamp - lastTime, 0, 100)

smoothY += (y - smoothY)
  * (1 - Math.exp(-elapsed / 80))
```

Here `clamp` abbreviates the actual `Math.max/Math.min` expression.

**80 ms is a time constant**, not an 80 ms delay followed by a jump. Each result
moves the smoothed position partway toward the measured position. The elapsed-time
formula makes the behavior less dependent on detection frame rate.

The 100 ms elapsed cap avoids a very large smoothing step after a long interval.

### Movement dead zone

```ts
displacement = startY - smoothY

outsideDeadZone = Math.sign(displacement)
  * Math.max(0, Math.abs(displacement) - 0.012)
```

Movement within **1.2% of image height** does nothing. Beyond that, only movement
outside the dead zone counts. Subtracting the dead zone prevents a sudden step
when crossing its boundary.

### Mapping and clamping

```ts
volume = clamp(
  startVolume + outsideDeadZone * 2,
  0,
  1,
)
```

Upward movement reduces Y, making `startY - smoothY` positive. Volume rises.
Downward movement makes it negative. Volume falls.

Worked example, after smoothing catches up:

```text
Starting volume: 0.50
Starting Y:      0.60
Smoothed Y:      0.50

Displacement:   0.10
Outside zone:   0.10 - 0.012 = 0.088
Volume change:  0.088 × 2 = 0.176
New volume:     0.676, about 68%
```

Finally, changes smaller than **0.002** from the last emitted volume are suppressed.
That's 0.2 percentage points, not a 2% threshold. Small changes can accumulate
until they become meaningful.

The controller updates volume on new results. It does not emit delayed movement
commands after release.

## 10. Respecting manual volume controls

A changed volume value alone cannot tell us where the change came from. It could
be the slider or the gesture itself.

The playback hook therefore maintains `manualVolumeRevision`:

```ts
function setVolume(value: number) {
  if (!Number.isFinite(value)) return
  setManualVolumeRevision(n => n + 1)
  applyVolume(value)
}

function setGestureVolume(value: number) {
  applyVolume(value)
}
```

The slider uses `setVolume`. Mute also routes through it. Gestures use
`setGestureVolume`.

Both change volume, but only manual calls increment the revision. Even a manual
call with the same numeric value counts as an override.

The volume controller compares the revision with its previous value. If manual
input arrives while pinching:

```text
dragging
  → waitingForRelease
  → release fingers
  → idle
  → new pinch
  → dragging with a fresh anchor
```

This prevents the old gesture anchor from overwriting the user's manual choice.

## 11. Updating the slider, sound, and visualizer

Both entry points use `applyVolume()`:

```ts
const volume = Math.max(0, Math.min(value, 1))
volumeRef.current = volume
if (volume > 0) lastAudibleVolume.current = volume
engine.current?.setVolume(volume)
setState(previous => ({ ...previous, volume }))
```

The state update moves the slider and changes the percentage shown in the preview.
The audio-engine call updates the gain node using its existing short smoothing.
The last audible volume supports mute/unmute restoration.

Because gain precedes the analyser:

```text
Gesture volume change
  → audio gain changes
  → analyser sees adjusted audio
  → visualizer bars respond
```

The visualizer has its own display-only gain and compression. It responds to
volume, but bar height is not a linear percentage copy of the volume slider.

Volume can be set before the audio engine exists. Its ref stores the value so
playback can apply it when the engine is created.

## 12. Recognizing an open palm

Function: `detectOpenPalm(hand)`.

It checks geometry rather than relying on finger tips being “above” knuckles on
the screen. This makes it more tolerant of rotating the hand in the image, though
it does not guarantee recognition from every 3D angle.

### A. Validate all points

Require 21 points with finite X, Y, and Z values. Reject a near-zero palm size.

### B. Separate thumb and index

```ts
distance(hand[4], hand[8]) / palm >= 0.45
```

This prevents a pinch from also being treated as an open palm.

### C. Check the four fingers

Loop over base indices:

```ts
[5, 9, 13, 17]
```

For each finger:

```ts
a = hand[base]      // MCP: base knuckle
b = hand[base + 1]  // PIP: next joint
c = hand[base + 3]  // fingertip
```

The implementation measures the angle between vectors **b→a** and **b→c**:

```text
cosine = dot(b→a, b→c)
         / (length(b→a) × length(b→c))
```

A straight finger produces a cosine close to `-1`, representing an angle close to
180°. The detector requires:

```ts
cosine <= -0.85
```

That corresponds to an angle of roughly **148° or greater**. It is a tolerance
for an extended finger, not a requirement for perfectly straight fingers.

It also requires:

```ts
wristToTip >= wristToPIP * 1.15
```

So the fingertip must reach farther from the wrist than the middle joint. The
current detector doesn't separately inspect the DIP joint or require equal gaps
between every finger.

### D. Check thumb extension

```ts
wristToThumbTip > wristToThumbIP * 1.05
```

All these checks must pass. A bent finger, near-pinch, or invalid hand rejects
the open-palm pose.

## 13. Holding, triggering, and rearming

Factory: `createPalmHoldController()`.

Recognizing one open-palm frame is not enough to toggle playback. The controller
adds time and state.

Its persistent variables are:

- `started`: when the current eligible hold began.
- `lastTime`: time of the previous accepted result.
- `latched`: whether this hold already triggered.
- `previousHand`: the last landmark-array object processed.

### Start and advance a hold

For fresh, eligible open-palm results:

```ts
progress = Math.min(
  1,
  (timestamp - started) / 600,
)
```

The timestamp supplied here comes from `performance.now()` when the React
coordinator processes results. The worker separately receives the capture-loop
timestamp for MediaPipe's video API.

Example, assuming results arrive regularly:

```text
0 ms:    open palm starts, 0%
200 ms:  about 33%
400 ms:  about 67%
600 ms:  trigger, latch
```

The action fires on the first eligible result at or after 600 ms. With discrete
tracking updates, that may be slightly later than exactly 600 ms.

### Prevent repeated toggles

At completion:

```ts
latched = true
started = null
```

Subsequent open-palm results do not trigger again. You must change the pose or
remove your hand before starting another hold.

This is what prevents:

```text
play → pause → play → pause
```

while someone simply keeps their palm raised.

### Reject interrupted or stale holds

An incomplete hold resets if:

- The hand disappears or is no longer an open palm.
- Tracking is disabled.
- The gap between fresh open-palm results exceeds **250 ms**.

Repeated processing of the exact same landmark-array object does not advance
progress. React renders alone cannot finish a hold.

A temporary loss of playback eligibility clears an unfinished hold but preserves
an already-fired latch. Otherwise, a play request entering a loading state could
rearm the still-open hand and trigger an unintended pause.

## 14. How the React hook coordinates both gestures

`useHandControls` keeps both controller instances in refs and visible interaction
status in React state.

For each relevant update, it runs the **volume controller first**:

```ts
const result = controller.current.update({
  hand: landmarks[0],
  enabled,
  volume: current.volume,
  manualRevision: manualVolumeRevision,
  timestamp: performance.now(),
})
```

If it returns a numeric volume, the hook invokes `onVolumeChange(volume)`.

Then it runs the palm controller with this eligibility rule:

```ts
canTogglePlayback && result.mode === 'idle'
```

An active volume grab or manual-override waiting state therefore blocks a
playback toggle. This is interaction conflict resolution, not a preference for
volume in the UI.

A completed hold calls `onTogglePlayback()` once.

The effect depends on:

```ts
[
  enabled,
  landmarks,
  manualVolumeRevision,
  canTogglePlayback,
]
```

`useEffectEvent` supplies the latest volume and callback functions without making
every volume-render or callback identity change replay the same landmarks.
Controller-level identity checks provide another guard against duplicate input.

If the same hand data is rendered again, it isn't treated as a newly observed
movement or additional evidence of a held pose.

## 15. Connecting the gestures to playback

`Studio.tsx` provides the real player functions:

```ts
onVolumeChange={playback.setGestureVolume}
```

For play/pause, the callback checks current playback state:

```ts
if (playback.isPlaying) {
  playback.pause()
} else {
  playback.play()
}
```

Eligibility requires:

```ts
Boolean(playback.track)
  && !playback.isLoading
  && !playback.isUnavailable
```

Thus, a track must be selected, available, and outside its loading state.
The code does not bypass the player's existing signed-URL, retry, autoplay, or
media-event handling.

If the browser blocks programmatic playback, a hand gesture is not guaranteed
to count as a browser-approved user activation. The existing player can ask for
a manual Play click.

## 16. What the preview displays

The floating card separates three things:

**Tracking status:** model loading, hand detected, initial hand search, hand lost,
or tracking failure.

**Persistent instructions and values:**

```text
Volume                       65%
Pinch + move up / down

Play / pause             Playing
Open palm · hold for 0.6s
```

**Interaction feedback:**

- `Ready for gestures` when idle.
- `Adjusting volume · …%` while dragging.
- `Release your pinch to grab again` after manual override.
- `Keep holding to play/pause` during an incomplete palm hold.
- `Lower or change your hand to rearm` after a fired hold.

Playback status is derived from actual player props, not an optimistic message
or a temporary confirmation timer. When playback is unavailable and not playing,
the status value is a dash and the row asks you to select a track first.

The hold progress uses a dark-green, rounded native progress element. Its fill
has an 80 ms CSS transition between updates, disabled for reduced-motion settings.
That visual transition does not change the 600 ms detection threshold.

The preview is rendered into `document.body` using a React portal. It is fixed
above the page, so changing status doesn't resize the library or visualizer.
The guide uses fixed spacing; the card supports pointer dragging, keyboard
movement, and closing the camera.

## 17. Interruptions and cleanup

### Hand loss

An empty landmark result clears the volume grab and palm hold/latch. The current
volume is preserved. Fresh detection can start a new interaction.

### Hidden tab

`useHandTracking` listens for `visibilitychange`:

1. Advance a visibility epoch (a generation counter).
2. Clear landmark state, resetting gestures.
3. Skip capture while `document.hidden` is true.
4. Ignore results from before the visibility change.
5. Resume with fresh video frames when visible.

The camera itself remains enabled in the background; inference/capture pauses.
An outstanding inference keeps the busy lock until it replies, avoiding overlap.
A captured image whose epoch is obsolete is closed without being sent.

### Camera disconnect

A camera track's `ended` event stops the camera resources and sets a reconnect
message. Disabling tracking then terminates the worker and clears gesture input.

### Disable or navigation away

The camera hook invalidates startup, removes track listeners, stops tracks, and
detaches `video.srcObject`. The tracking hook removes its visibility listener,
cancels animation, and terminates its worker.

Late permission responses and image captures cannot revive the old session.
The gesture controllers dispatch no background movement timers after release.

### Tracking failure

The tracking hook stops its loop, terminates the worker, reports an error, and
clears landmarks. Gesture control becomes disabled. The camera preview may remain
active until you disable it; audio playback and manual controls remain separate.

## 18. Tests and limitations

The relevant automated tests are:

- [gestures.test.ts](../../tests/browser/gestures.test.ts): pinch boundaries,
  hysteresis, hand-size scaling, missing hands, zero palm size, invalid coordinates.
- [useHandControls.test.ts](../../tests/browser/useHandControls.test.ts): no jump on
  grab, direction, dead zone, limits, smoothing, duplicate input, release, re-grab,
  manual override, and callback feedback protection.
- [palmGesture.test.ts](../../tests/browser/palmGesture.test.ts): pose geometry,
  scaling/rotation, hold duration, one-shot latch, rearm, stale frames, eligibility,
  and React callback integration.
- [useAudioPlayback.test.ts](../../tests/browser/useAudioPlayback.test.ts): shared
  playback behavior and distinguishing gesture volume from manual revisions.
- [useCamera.test.ts](../../tests/browser/useCamera.test.ts): permission races,
  cancellation/retry, disconnects, repeated starts/stops, and cleanup.
- [useHandTracking.test.ts](../../tests/browser/useHandTracking.test.ts): worker
  lifecycle, one frame in flight, late capture, hidden tabs, and stale results.
- [handTrackingWorker.test.ts](../../tests/browser/handTrackingWorker.test.ts):
  model initialization, inference results/errors, and closing transferred images.
- [GestureControls.test.ts](../../tests/browser/GestureControls.test.ts): floating
  preview, instructions/status, pinch feedback, resets, and playback status.

Run the main suite:

```sh
npm test
npm run lint
npm run build
```

These tests largely use mocked media resources or synthetic landmarks. They don't
prove physical camera behavior, recognition accuracy for every person, or latency
on every device. A separate camera-free browser diagnostic runs the real model
on a blank image; it proves runtime/inference startup, not recognition quality.

Current limitations include:

- One hand is configured; there is no explicit hand-identity locking across users.
- A palm is classified using geometric heuristics, not a custom trained classifier.
- Normalized image coordinates are approximate geometry, not metric 3D positions.
- Gestures depend on lighting, occlusion, hand angle, and device performance.
- There is no automatic inference watchdog that times out a permanently stalled
  worker. The palm controller's 250 ms rule prevents advancing a hold across a
  long result gap, but it is not a worker timeout mechanism.

## 19. Settings you can tune

**Pinch start: `0.25`.** Smaller requires a tighter pinch.

**Pinch release: `0.4`.** Keep this above the start threshold to preserve hysteresis.

**Volume dead zone: `0.012`.** Larger ignores more small motion but requires more
movement before adjustment begins.

**Volume sensitivity: `2`.** Larger changes volume more for the same vertical travel.

**Position smoothing: `80 ms`.** Larger is steadier but feels slower.

**Minimum emitted volume change: `0.002`.** Larger reduces update frequency but
makes volume steps coarser.

**Palm hold: `600 ms`.** Longer reduces accidental toggles but adds interaction time.

**Palm result-gap reset: `250 ms`.** Longer tolerates slower inference but accepts
longer interruptions within a hold.

**Frame interval: `50 ms`.** Controls the capture-rate cap. Lowering it won't make
inference faster if the worker is already busy.

Tune one parameter at a time, using the same song and camera setup. Keep the
state-machine tests passing and then verify comfort with the actual webcam.
