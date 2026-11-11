# Playback Workflow

Supports track selection, play/pause, volume control, and elapsed time/duration display.

## Code map

| File | Responsibility |
|---|---|
| `src/types/tracks.ts` | Shared library-track and expiring-playback-URL types |
| `src/lib/tracks.ts` | Read ready tracks with Storage paths; sign private audio URLs |
| `src/hooks/useAudioPlayback.ts` | Own one audio element, media events, URL lifecycle, and deletion guards |
| `Studio.tsx` | Connect the library, hook, and presentational player |
| `TrackLibrary.tsx` | Selectable rows, selected/playing indicators, deletion callbacks |
| `AudioPlayer.tsx` | Render accessible playback, seek, volume, loading, and retry controls |

## Selection and loading

1. The ready-only library query includes `storage_path`. Selecting a row passes its
   full track to the hook; searching filters the list without changing playback.
2. Selection immediately pauses/releases the previous source and resets the timeline.
3. The helper validates owner/track UUID path shape and calls Storage's
   `createSignedUrl(path, 3600)` using the existing signed-in Supabase client.
   This grants a temporary bearer URL, not a public bucket or a service-role client.
4. The hook loads the URL into its persistent HTML audio element and attempts play.
   Supabase's owner-folder SELECT policy controls signing. The hosted policy was
   inspected read-only and matches authenticated user IDs to the first folder.
5. A generation counter invalidates older async URL/play responses after switching,
   deletion, or unmount. Clicking the selected row toggles play/pause without signing/reloading a fresh source; an expired URL or playback error uses the existing refresh/retry path.

URLs live only in memory. Do not log them or store them in database/localStorage.
Signing records expiry from request start (conservative) and allows only HTTPS,
except HTTP localhost addresses for development.

## Media state and controls

The hook registers/removes media listeners in one effect. `loadedmetadata` and
`durationchange` set duration and restore a saved seek position; `timeupdate`
updates the slider; `playing`, `pause`, `waiting`, `canplay`, `ended`, and `error`
update actual playback state. A resolved play request alone does not mark playing.

Seek is clamped to finite duration; volume is clamped to 0–1 and retained across
track switches. Ended tracks stay selected and restart at zero on Play. Shuffle,
repeat, previous, and next remain explicitly disabled. Volume support follows the
browser's HTML media capabilities; this stage does not use Web Audio processing.

If autoplay is denied, show “Press Play to start audio” with an enabled Play button.
Signing/network/format failures offer explicit Retry playback; there is no automatic
retry loop. Before resuming, a URL within 30 seconds of expiry is refreshed and the
position restored after new metadata. Explicit retry also requests a fresh URL.
No proactive timer interrupts an already-playing track at URL expiry; a subsequent
fetch/seek error may need Retry playback.

## Deletion

Opening/canceling confirmation does not affect playback. Confirmation reports the
ID before starting deletion: active playback and any pending signing are stopped,
and that ID is blocked from resuming. Other tracks continue normally. On success,
selection/source/time are cleared only if that same track is still selected.

On uncertain deletion failure the active track stays stopped/unavailable, and the
existing deletion UI retains its retry target. It is unsafe to assume the server
left the file intact. Another track can still be selected. This is an extension
of the existing deletion callbacks, not a second deletion implementation.

## Tests

`npm run test:all` runs the existing suites plus:

- `useAudioPlayback.test.ts`: persistent element, switching/stale responses, same-ID
  reuse, metadata/time, seek/volume bounds, pause/resume, URL expiry/restoration,
  autoplay denial, signing/media failure recovery, ended restart, deletion races,
  unmount cleanup, old rejected play promises, and pause during signing.
- `AudioPlayer.test.ts`: rendered title/time, accessible sliders/buttons, disabled
  unsupported controls, no-selection state, error retry, and deletion blocking.
- `TrackLibrary.test.ts`: selection separate from trash, search preserving selection,
  deletion-start callbacks, success-only clearing, and existing confirmation tests.
- `tracks.test.ts`: one-hour signing, conservative expiry, path validation, errors,
  and invalid/unexpected URL protocols.

Media API behavior is mocked in unit tests. Actual personal-file codecs, network
failures, and access isolation need signed-in checks in the real app.

## Isolated browser preview

```sh
npx vite --config tests/preview/vite.config.ts
```

Open `http://127.0.0.1:5181/`. This test-only root renders the real Studio/components
with an isolated Supabase adapter and generated 20-second silent PCM WAVs. It has
no Supabase connection, credentials, or access to user music. Production Vite config
and auth routes are untouched; no mock/preview code is imported by `src/`.

Browser verification passed for real WAV loading/duration, play/pause, seek to
0:08, volume at 35%, and switching/resetting tracks. The personal app tabs were
signed out, so playback against the user's actual library was not claimed as
verified. Tests do not simulate a new public bucket or bypass production auth.

## Try it in your app

Start the normal Vite server, sign in, select a track, and verify play/pause, seek,
volume, and deletion of a disposable selected track. If signing fails, inspect the
Storage SELECT policy/session. No backend deployment is needed for this change.


## Player interaction refinements

Artwork is solid dark green with no decorative strokes. Timeline and volume use
borderless custom range tracks/thumbs with keyboard focus indicators. Timeline
movement previews a local position and commits one seek on pointer release,
keyboard release, or blur; buffering does not disable a timeline with known duration.
The speaker button mutes and restores the last nonzero volume, including across
track switches. Only the bounded track list scrolls; row height/spacing stay stable.
The isolated preview now includes 14 generated tracks to check overflow.


## Live music visualizer

`WaveformView` renders 96 rounded, centered dark-green SVG bars on a white
background. These are live frequency levels, not a whole-track waveform or a
seekable timeline. The player retains the seek control.

1. The audio engine routes source → gain → analyser → speakers, so volume affects
   both sound and visual levels. Its FFT size is 2048, with analyser smoothing 0.35.
2. `readFrequencyBands()` reads decibels into a reusable buffer, converts them to
   linear power, and returns RMS amplitude for 96 logarithmic bands from 40 Hz to
   the lower of 16 kHz or Nyquist. Low bands can share FFT bins at this resolution;
   the display does not imply 96 independently resolved frequencies.
3. `useAudioPlayback` exposes the reader; `Studio` passes it and playback state to
   the visualizer. No second player, download, or offline decoding is needed.
4. On each animation frame, the visualizer blends neighboring bands (20/60/20%),
   applies 4× visual-only sensitivity and logarithmic display compression, then
   eases bar levels with a 45 ms
   attack and 160 ms release. These are time constants, not fixed transition lengths.
5. Bars expand symmetrically about the centerline, span 82% of the panel width,
   and settle to small baseline marks on pause, silence, or missing data.
   Peak height is capped at 80% of the SVG drawing area, below reserved heading
   space. Visual sensitivity changes neither playback gain nor analyser data.
6. SVG attributes update directly using reused level arrays, without per-frame
   React state changes. Unmount cancels the animation frame. No WebGL is required.

Automated tests cover structure, independent frequency response, decay, pause,
missing data, buffer reuse, decibel conversion, and animation cleanup. Actual
appearance, audio synchronization, and browser media behavior need browser review.


## Pinch-and-drag volume

`GestureControls` passes hand landmarks to `useHandControls`; inference remains
in `useHandTracking` and the worker. `gestures.ts` contains the pure detector,
midpoint/dead-zone mapping, and stateful interaction controller.

- Pinch starts at thumb/index distance divided by palm size ≤ 0.25; it releases
  at ≥ 0.4. A new grab records current volume and fingertip midpoint Y, without
  emitting a volume change.
- While pinching, Y is eased with an 80 ms time constant. Movement outside a
  0.012 normalized-image dead zone maps to volume with sensitivity 2 and clamps
  to 0–1. Changes smaller than 0.002 are suppressed. Only new landmark objects
  advance the controller; playback-state renders do not replay tracking frames.
- Release, missing/invalid hand data, tracking failure, or camera disable ends the
  grab and preserves volume. Re-grabbing uses the current volume and position.
- Manual slider and mute actions increment `manualVolumeRevision`. Gesture edits
  do not. A manual edit cancels the grab and requires release before re-grabbing.
- `setGestureVolume` and manual `setVolume` share `applyVolume`, including gain
  updates, UI state, clamping, and last-audible-volume preservation. The analyser
  remains after gain, so the visualizer follows the adjusted audio.

The preview displays instructions, live volume percentage during a grab, or a
release-to-rearm message after manual override. Webcam testing is still needed
to tune pinch thresholds, dead zone, and sensitivity for comfort.


## Open-palm play/pause

`detectOpenPalm` checks all 21 finite landmarks, four extended fingers (joint
alignment and fingertip distance from the wrist), an extended thumb, and separation
between thumb/index. This is a heuristic over MediaPipe landmarks, not a newly
trained gesture classifier.

`createPalmHoldController` requires 600 ms of fresh open-palm results and emits one
trigger per hold. It resets incomplete holds after hand loss, pose change, disable,
or a detection gap over 250 ms. Identical result objects cannot advance progress.
After firing it stays latched until the pose changes or hand leaves; temporary
player loading does not rearm it. Pinch-volume modes block palm toggles.

Studio enables toggling only for a selected, available track outside loading and
routes the action to the existing `play()`/`pause()` methods. The floating preview
shows a hold-progress bar, action instructions, and release-to-rearm feedback.
An autoplay-blocked `play()` still uses the player's existing manual-play notice.

Tests use synthetic landmarks to check pose rejection, scale/orientation, hold
boundaries, one-shot firing, interrupted/stale results, playback eligibility, and
hook callback integration. Real-camera pose tolerance and comfort require testing.


## Gesture guide and feedback

The floating camera preview keeps a fixed-height guide below the video with volume
and play/pause instructions. Active gestures are highlighted; play/pause guidance
is dimmed when no track is eligible. Detection feedback distinguishes initial hand
search from hand loss and resets when the camera is disabled.

The play/pause row persistently shows the actual player state, independently of
hand activity. Its instruction reads “Open palm · hold for 0.6s”; the volume row
shows the current percentage and pinch/movement instructions. Idle feedback is
“Ready for gestures”, giving neither gesture priority in the UI. Feedback changes
only during volume adjustment, palm holds, or release-to-rearm. Playback status
has no confirmation timer and does not optimistically change when a toggle is
requested. This presentation does not change recognition thresholds or playback.
