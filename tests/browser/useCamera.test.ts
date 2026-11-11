import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCamera } from '../../src/hooks/useCamera'
class Track extends EventTarget { stop = vi.fn() }
function stream() {
  const track = new Track()
  return { track, media: { getTracks: () => [track] } as unknown as MediaStream }
}
let request: ReturnType<typeof vi.fn>
beforeEach(() => {
  request = vi.fn()
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: request } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function setup() {
  const hook = renderHook(() => useCamera())
  const video = { srcObject: null, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement
  hook.result.current.videoRef.current = video
  return { ...hook, video }
}
it('starts only on request, uses video only, and releases on stop', async () => {
  const source = stream()
  request.mockResolvedValue(source.media)
  const { result, video } = setup()
  expect(request).not.toHaveBeenCalled()
  await act(async () => result.current.start())
  expect(request.mock.calls[0][0].audio).toBe(false)
  expect(video.srcObject).toBe(source.media)
  expect(result.current.enabled).toBe(true)
  act(() => result.current.stop())
  expect(source.track.stop).toHaveBeenCalledOnce()
  expect(video.srcObject).toBeNull()
  expect(result.current.enabled).toBe(false)
})
it('prevents duplicate pending starts and closes a stream arriving after unmount', async () => {
  let resolve!: (value: MediaStream) => void
  request.mockReturnValue(new Promise(done => { resolve = done }))
  const { result, unmount } = setup()
  let pending!: Promise<void>
  act(() => { pending = result.current.start(); void result.current.start() })
  expect(request).toHaveBeenCalledOnce()
  unmount()
  const late = stream()
  await act(async () => { resolve(late.media); await pending })
  expect(late.track.stop).toHaveBeenCalledOnce()
})
it('allows restart after canceling a pending permission request and rejects the old result', async () => {
  let resolve!: (value: MediaStream) => void
  request.mockReturnValueOnce(new Promise(done => { resolve = done }))
  const fresh = stream()
  request.mockResolvedValueOnce(fresh.media)
  const { result, video } = setup()
  let pending!: Promise<void>
  act(() => { pending = result.current.start() })
  act(() => result.current.stop())
  await act(async () => result.current.start())
  expect(request).toHaveBeenCalledTimes(2)
  const old = stream()
  await act(async () => { resolve(old.media); await pending })
  expect(old.track.stop).toHaveBeenCalledOnce()
  expect(video.srcObject).toBe(fresh.media)
  expect(result.current.enabled).toBe(true)
})
it('handles a camera disconnect and permits a new start', async () => {
  const source = stream()
  request.mockResolvedValue(source.media)
  const { result, video } = setup()
  await act(async () => result.current.start())
  act(() => source.track.dispatchEvent(new Event('ended')))
  expect(result.current.enabled).toBe(false)
  expect(result.current.error).toContain('disconnected')
  expect(video.srcObject).toBeNull()
  const next = stream()
  request.mockResolvedValueOnce(next.media)
  await act(async () => result.current.start())
  expect(result.current.enabled).toBe(true)
  expect(result.current.error).toBe('')
})
it('releases the stream when preview playback fails', async () => {
  const source = stream()
  request.mockResolvedValue(source.media)
  const { result, video } = setup()
  vi.mocked(video.play).mockRejectedValue(new Error('preview'))
  await act(async () => result.current.start())
  expect(source.track.stop).toHaveBeenCalledOnce()
  expect(result.current.enabled).toBe(false)
  expect(result.current.error).toBeTruthy()
})
it('handles denied permission and releases active resources on unmount', async () => {
  request.mockRejectedValueOnce(new Error('denied'))
  const { result, unmount, video } = setup()
  await act(async () => result.current.start())
  expect(result.current.error).toBeTruthy()
  const source = stream()
  request.mockResolvedValueOnce(source.media)
  await act(async () => result.current.start())
  unmount()
  expect(source.track.stop).toHaveBeenCalledOnce()
  expect(video.srcObject).toBeNull()
})
it('repeated enable/disable does not leave tracks running', async () => {
  const { result } = setup()
  for (let i = 0; i < 5; i++) {
    const source = stream()
    request.mockResolvedValueOnce(source.media)
    await act(async () => result.current.start())
    act(() => result.current.stop())
    expect(source.track.stop).toHaveBeenCalledOnce()
  }
})

it('does not enable the camera when video.play resolves after stop', async () => {
  const source = stream()
  request.mockResolvedValue(source.media)
  const { result, video } = setup()
  let resolve!: () => void
  vi.mocked(video.play).mockReturnValueOnce(new Promise(done => { resolve = done }))
  let pending!: Promise<void>
  await act(async () => { pending = result.current.start(); await Promise.resolve() })
  act(() => result.current.stop())
  await act(async () => { resolve(); await pending })
  expect(result.current.enabled).toBe(false)
  expect(video.srcObject).toBeNull()
  expect(source.track.stop).toHaveBeenCalledOnce()
})
