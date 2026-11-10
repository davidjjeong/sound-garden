import { createAudioEngine, type AudioEngine } from '../../src/lib/audioEngine'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAudioPlayback } from '../../src/hooks/useAudioPlayback'
import { getTrackPlaybackUrl } from '../../src/lib/tracks'
import type { LibraryTrack } from '../../src/types/tracks'

const engineMock = vi.hoisted(() => ({
  resume: vi.fn<() => Promise<void>>(),
  setVolume: vi.fn<(volume: number) => void>(),
  readWaveForm: vi.fn<AudioEngine['readWaveForm']>(),
  dispose: vi.fn<() => Promise<void>>(),
}))
vi.mock('../../src/lib/audioEngine', () => ({ createAudioEngine: vi.fn() }))

vi.mock('../../src/lib/tracks', () => ({ getTrackPlaybackUrl: vi.fn() }))
const sign = vi.mocked(getTrackPlaybackUrl)
const track: LibraryTrack = { id: '11111111-1111-4111-8111-111111111111', title: 'Soft Orbit',
  storage_path: '22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111.wav', size_bytes: 100, created_at: '2026-11-10' }
const other = { ...track, id: '33333333-3333-4333-8333-333333333333', title: 'Another track' }
const instances: FakeAudio[] = []
class FakeAudio extends EventTarget {
  src = ''; currentSrc = ''; preload = ''; crossOrigin = ''
  currentTime = 0; duration = NaN; volume = 1; paused = true; ended = false
  error: { code: number } | null = null
  constructor() { super(); instances.push(this) }
  play = vi.fn(async () => { this.paused = false; this.emit('playing') })
  pause = vi.fn(() => { this.paused = true; this.emit('pause') })
  load = vi.fn(() => { if (!this.src) { this.currentTime = 0; this.duration = NaN } })
  removeAttribute(name: string) { if (name === 'src') this.src = '' }
  emit(event: string) { this.dispatchEvent(new Event(event)) }
}
beforeEach(() => {
  vi.resetAllMocks()
  engineMock.resume.mockResolvedValue(undefined)
  engineMock.dispose.mockResolvedValue(undefined)
  engineMock.readWaveForm.mockReturnValue(new Float32Array(2048))
  vi.mocked(createAudioEngine).mockReturnValue(engineMock)
  instances.length = 0
  vi.stubGlobal('Audio', FakeAudio)
  sign.mockImplementation(async (item) => ({ url: `https://audio.test/${item.id}.wav`, expiresAt: Date.now() + 3600000 }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function select() {
  const hook = renderHook(() => useAudioPlayback())
  await act(async () => { hook.result.current.select(track) })
  return { ...hook, media: instances[0] }
}

it('creates one persistent element and selects/plays a signed source', async () => {
  const { result, media } = await select()
  expect(instances).toHaveLength(1)
  expect(media.crossOrigin).toBe('anonymous')
  expect(result.current.track).toEqual(track)
  expect(result.current.isPlaying).toBe(true)
  await act(async () => { result.current.select(other) })
  expect(instances).toHaveLength(1)
  expect(media.src).toContain(other.id)
})
it('ignores an older signed URL arriving after the user selects another track', async () => {
  let resolve!: (value: { url: string; expiresAt: number }) => void
  sign.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const { result } = renderHook(() => useAudioPlayback())
  act(() => result.current.select(track))
  await act(async () => { result.current.select(other) })
  await act(async () => { resolve({ url: 'https://audio.test/stale.wav', expiresAt: Date.now() + 3600000 }) })
  expect(instances[0].src).toContain(other.id)
  expect(result.current.track?.id).toBe(other.id)
})
it('does not reload when selecting the same track', async () => {
  const { result } = await select()
  act(() => result.current.select(track))
  expect(sign).toHaveBeenCalledOnce()
})
it('updates duration/time from media events and clamps seeks/volume', async () => {
  const { result, media } = await select()
  act(() => { media.duration = 180; media.emit('loadedmetadata'); media.currentTime = 12; media.emit('timeupdate') })
  expect(result.current.duration).toBe(180)
  expect(result.current.position).toBe(12)
  act(() => result.current.seek(999))
  expect(media.currentTime).toBe(180)
  act(() => result.current.seek(-10))
  expect(media.currentTime).toBe(0)
  act(() => result.current.setVolume(.4))
  expect(engineMock.setVolume).toHaveBeenLastCalledWith(.4)
  act(() => result.current.setVolume(9))
  expect(engineMock.setVolume).toHaveBeenLastCalledWith(1)
  act(() => result.current.setVolume(-1))
  expect(engineMock.setVolume).toHaveBeenLastCalledWith(0)
})
it('ignores invalid seeks before metadata and nonfinite values', async () => {
  const { result, media } = await select()
  act(() => { result.current.seek(10); result.current.setVolume(NaN) })
  expect(media.currentTime).toBe(0)
  expect(result.current.volume).toBe(1)
})
it('pause and resume reuse an unexpired source', async () => {
  const { result, media } = await select()
  act(() => result.current.pause())
  expect(result.current.isPlaying).toBe(false)
  await act(async () => { result.current.play() })
  expect(result.current.isPlaying).toBe(true)
  expect(sign).toHaveBeenCalledOnce()
  expect(media.play).toHaveBeenCalledTimes(2)
})
it('refreshes an expired URL and restores position after metadata', async () => {
  const { result, media } = await select()
  act(() => { media.duration = 180; media.currentTime = 40; media.emit('timeupdate'); result.current.pause() })
  const original = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(original + 3600000)
  await act(async () => { result.current.play() })
  expect(sign).toHaveBeenCalledTimes(2)
  act(() => { media.duration = 180; media.emit('loadedmetadata') })
  expect(media.currentTime).toBe(40)
})
it('handles autoplay rejection with a Play prompt instead of a fatal error', async () => {
  const { result } = renderHook(() => useAudioPlayback())
  instances[0].play.mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError'))
  await act(async () => { result.current.select(track) })
  expect(result.current.isPlaying).toBe(false)
  expect(result.current.error).toBe('')
  expect(result.current.notice).toMatch(/Press Play/)
  await act(async () => { result.current.play() })
  expect(result.current.isPlaying).toBe(true)
})
it('reports signing errors and retries with a new URL', async () => {
  sign.mockRejectedValueOnce(new Error('Forbidden'))
  const { result } = await select()
  expect(result.current.error).toMatch(/Could not load/)
  await act(async () => { result.current.retry() })
  expect(result.current.error).toBe('')
  expect(result.current.isPlaying).toBe(true)
})
it('reports media decode errors and supports explicit retry', async () => {
  const { result, media } = await select()
  act(() => { media.error = { code: 4 }; media.emit('error') })
  expect(result.current.error).toMatch(/format/)
  await act(async () => { result.current.retry() })
  expect(sign).toHaveBeenCalledTimes(2)
})
it('ends playback and restarts from zero on Play', async () => {
  const { result, media } = await select()
  act(() => { media.currentTime = 180; media.ended = true; media.emit('ended') })
  expect(result.current.isPlaying).toBe(false)
  await act(async () => { result.current.play() })
  expect(media.currentTime).toBe(0)
})
it('active deletion invalidates playback and clears selection only after success', async () => {
  const { result, media } = await select()
  act(() => result.current.beginDeletion(track.id))
  expect(media.src).toBe('')
  expect(result.current.isUnavailable).toBe(true)
  expect(result.current.track?.id).toBe(track.id)
  await act(async () => { result.current.play(); result.current.retry() })
  expect(sign).toHaveBeenCalledOnce()
  act(() => result.current.completeDeletion(track.id))
  expect(result.current.track).toBeNull()
  expect(result.current.duration).toBe(0)
})
it('deleting another track does not stop playback', async () => {
  const { result, media } = await select()
  const pauses = media.pause.mock.calls.length
  act(() => { result.current.beginDeletion(other.id); result.current.completeDeletion(other.id) })
  expect(result.current.isPlaying).toBe(true)
  expect(media.pause).toHaveBeenCalledTimes(pauses)
})
it('deletion prevents an in-flight signed URL from starting audio', async () => {
  let resolve!: (value: { url: string; expiresAt: number }) => void
  sign.mockReturnValueOnce(new Promise((done) => { resolve = done }))
  const { result } = renderHook(() => useAudioPlayback())
  act(() => result.current.select(track))
  act(() => result.current.beginDeletion(track.id))
  await act(async () => { resolve({ url: 'https://audio.test/deleted.wav', expiresAt: Date.now() + 3600000 }) })
  expect(instances[0].play).not.toHaveBeenCalled()
  expect(instances[0].src).toBe('')
})
it('unmount releases the source and prevents pending signing from starting audio', async () => {
  let resolve!: (value: { url: string; expiresAt: number }) => void
  sign.mockReturnValueOnce(new Promise((done) => { resolve = done }))
  const { result, unmount } = renderHook(() => useAudioPlayback())
  act(() => result.current.select(track))
  unmount()
  await act(async () => { resolve({ url: 'https://audio.test/late.wav', expiresAt: Date.now() + 3600000 }) })
  expect(instances[0].play).not.toHaveBeenCalled()
  expect(instances[0].src).toBe('')
})

it('ignores a rejected old play promise after switching tracks', async () => {
  const { result, media } = await select()
  let reject!: (reason: Error) => void
  act(() => result.current.pause())
  media.play.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  await act(async () => { result.current.play() })
  await act(async () => { result.current.select(other) })
  await act(async () => { reject(new Error('Old playback interrupted')) })
  expect(result.current.track?.id).toBe(other.id)
  expect(result.current.error).toBe('')
})
it('pause during URL loading prevents delayed autoplay', async () => {
  let resolve!: (value: { url: string; expiresAt: number }) => void
  sign.mockReturnValueOnce(new Promise((done) => { resolve = done }))
  const { result } = renderHook(() => useAudioPlayback())
  act(() => { result.current.select(track); result.current.pause() })
  await act(async () => { resolve({ url: 'https://audio.test/paused.wav', expiresAt: Date.now() + 3600000 }) })
  expect(instances[0].play).not.toHaveBeenCalled()
  expect(result.current.isPlaying).toBe(false)
  expect(result.current.isLoading).toBe(false)
})
it('an ended track with an expired URL restarts at the beginning', async () => {
  const { result, media } = await select()
  act(() => { media.duration = 180; media.currentTime = 180; media.ended = true; media.emit('ended') })
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3600000)
  await act(async () => { result.current.play() })
  act(() => { media.duration = 180; media.emit('loadedmetadata') })
  expect(media.currentTime).toBe(0)
})

it('mute restores the last nonzero volume and preserves it across track switches', async () => {
  const { result } = await select()
  act(() => result.current.setVolume(.35))
  act(() => result.current.toggleMute())
  expect(engineMock.setVolume).toHaveBeenLastCalledWith(0)
  await act(async () => { result.current.select(other) })
  expect(result.current.volume).toBe(0)
  act(() => result.current.toggleMute())
  expect(engineMock.setVolume).toHaveBeenLastCalledWith(.35)
  expect(result.current.volume).toBe(.35)
  act(() => result.current.setVolume(0))
  act(() => result.current.toggleMute())
  expect(engineMock.setVolume).toHaveBeenLastCalledWith(.35)
})


it('clicking the selected row pauses and resumes at the current position without resigning', async () => {
  const { result, media } = await select()
  act(() => { media.currentTime = 12; media.emit('timeupdate'); result.current.select(track) })
  expect(result.current.isPlaying).toBe(false)
  await act(async () => { result.current.select(track) })
  expect(result.current.isPlaying).toBe(true)
  expect(media.currentTime).toBe(12)
  expect(sign).toHaveBeenCalledOnce()
})
it('clicking the selected row during signing cancels delayed autoplay', async () => {
  let resolve!: (value: { url: string; expiresAt: number }) => void
  sign.mockReturnValueOnce(new Promise((done) => { resolve = done }))
  const { result } = renderHook(() => useAudioPlayback())
  act(() => { result.current.select(track); result.current.select(track) })
  await act(async () => { resolve({ url: 'https://audio.test/paused.wav', expiresAt: Date.now() + 3600000 }) })
  expect(instances[0].play).not.toHaveBeenCalled()
  await act(async () => { result.current.select(track) })
  expect(result.current.isPlaying).toBe(true)
})


it('creates the engine lazily and reuses it across pauses and track switches', async () => {
  const { result } = renderHook(() => useAudioPlayback())
  expect(createAudioEngine).not.toHaveBeenCalled()
  expect(result.current.readWaveForm()).toBeNull()
  act(() => result.current.setVolume(.3))
  await act(async () => { result.current.select(track) })
  expect(createAudioEngine).toHaveBeenCalledWith(instances[0])
  expect(engineMock.setVolume).toHaveBeenLastCalledWith(.3)
  expect(instances[0].volume).toBe(1)
  act(() => result.current.pause())
  await act(async () => { result.current.play(); result.current.select(other) })
  expect(createAudioEngine).toHaveBeenCalledOnce()
  expect(engineMock.dispose).not.toHaveBeenCalled()
  expect(result.current.readWaveForm()).toBe(engineMock.readWaveForm.mock.results[0].value)
})
it('resumes the audio context before requesting element playback', async () => {
  const { media } = await select()
  expect(engineMock.resume.mock.invocationCallOrder[0]).toBeLessThan(media.play.mock.invocationCallOrder[0])
})
it.each(['pause', 'deletion', 'unmount'])('does not start audio after %s during context resume', async (action) => {
  let resume!: () => void
  engineMock.resume.mockReturnValueOnce(new Promise((resolve) => { resume = resolve }))
  const { result, unmount } = renderHook(() => useAudioPlayback())
  await act(async () => { result.current.select(track) })
  expect(engineMock.resume).toHaveBeenCalledOnce()
  if (action === 'unmount') unmount()
  else act(() => action === 'pause' ? result.current.pause() : result.current.beginDeletion(track.id))
  await act(async () => { resume() })
  expect(instances[0].play).not.toHaveBeenCalled()
})
it('shows a recoverable error when resuming the context fails', async () => {
  engineMock.resume.mockRejectedValueOnce(new Error('Context unavailable'))
  const { result, media } = await select()
  expect(result.current.error).toMatch(/Playback could not start/)
  expect(media.play).not.toHaveBeenCalled()
  await act(async () => { result.current.retry() })
  expect(result.current.isPlaying).toBe(true)
  expect(createAudioEngine).toHaveBeenCalledOnce()
})
it('disposes the engine only on unmount and handles rejected cleanup', async () => {
  engineMock.dispose.mockRejectedValueOnce(new Error('Already closed'))
  const { result, unmount } = await select()
  await act(async () => { result.current.select(other) })
  expect(engineMock.dispose).not.toHaveBeenCalled()
  await act(async () => { unmount() })
  expect(engineMock.dispose).toHaveBeenCalledOnce()
})
