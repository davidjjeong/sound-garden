import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useHandTracking } from '../../src/hooks/useHandTracking'
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { FakeWorker.instances.push(this) }
  send(data: unknown) { this.onmessage?.({ data } as MessageEvent) }
}
beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('does not start a worker until the camera is enabled', () => {
  const { result } = renderHook(() => useHandTracking(false))
  expect(result.current.status).toBe('idle')
  expect(FakeWorker.instances).toHaveLength(0)
})
it('initializes local assets and displays loading, ready, and model errors', async () => {
  const { result } = renderHook(() => useHandTracking(true))
  await waitFor(() => expect(result.current.status).toBe('loading'))
  const worker = FakeWorker.instances[0]
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'initialize', assetBase: expect.stringContaining('/mediapipe/') })
  act(() => worker.send({ type: 'ready' }))
  expect(result.current.status).toBe('ready')
  act(() => worker.send({ type: 'error', message: 'Model missing' }))
  expect(result.current.error).toBe('Model missing')
  expect(worker.terminate).toHaveBeenCalled()
})
it('terminates and ignores stale messages after disabling; re-enabling starts fresh', async () => {
  const { result, rerender, unmount } = renderHook(({ enabled }) => useHandTracking(enabled), { initialProps: { enabled: true } })
  await waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
  const old = FakeWorker.instances[0]
  const late = old.onmessage!
  rerender({ enabled: false })
  expect(old.terminate).toHaveBeenCalledOnce()
  act(() => late({ data: { type: 'ready' } } as MessageEvent))
  expect(result.current.status).toBe('idle')
  rerender({ enabled: true })
  await waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
  expect(result.current.status).toBe('loading')
  unmount()
  expect(FakeWorker.instances[1].terminate).toHaveBeenCalledOnce()
})
it('reports worker execution and message errors', async () => {
  const { result } = renderHook(() => useHandTracking(true))
  await waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
  act(() => FakeWorker.instances[0].onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent))
  expect(result.current.status).toBe('error')
})
it('reports an unsupported worker constructor', async () => {
  vi.stubGlobal('Worker', class { constructor() { throw new Error('unsupported') } })
  const { result } = renderHook(() => useHandTracking(true))
  await waitFor(() => expect(result.current.status).toBe('error'))
  expect(result.current.error).toContain('unavailable')
})

it('allows one frame in flight, waits for new video frames, and stops on disable', async () => {
  let tick: FrameRequestCallback = () => {}
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { tick = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const bitmap = { close: vi.fn() }
  const capture = vi.fn().mockResolvedValue(bitmap)
  vi.stubGlobal('createImageBitmap', capture)
  const video = { readyState: 4, videoWidth: 640, currentTime: 1 } as HTMLVideoElement
  const ref = { current: video }
  const { result, rerender } = renderHook(({ enabled }) => useHandTracking(enabled, ref), { initialProps: { enabled: true } })
  await waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
  const worker = FakeWorker.instances[0]
  act(() => worker.send({ type: 'ready' }))
  await act(async () => tick(100))
  expect(capture).toHaveBeenCalledOnce()
  act(() => { tick(160); tick(220) })
  expect(capture).toHaveBeenCalledOnce()
  act(() => worker.send({ type: 'result', landmarks: [[{ x: .2, y: .3, z: 0 }]] }))
  expect(result.current.landmarks).toHaveLength(1)
  act(() => tick(280))
  expect(capture).toHaveBeenCalledOnce()
  video.currentTime = 2
  await act(async () => tick(340))
  expect(capture).toHaveBeenCalledTimes(2)
  rerender({ enabled: false })
  act(() => tick(400))
  expect(capture).toHaveBeenCalledTimes(2)
  expect(result.current.landmarks).toEqual([])
})
it('closes a bitmap whose capture completes after disabling', async () => {
  let tick: FrameRequestCallback = () => {}
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { tick = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  let resolve!: (frame: { close: () => void }) => void
  vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise(done => { resolve = done })))
  const ref = { current: { readyState: 4, videoWidth: 640, currentTime: 1 } as HTMLVideoElement }
  const { rerender } = renderHook(({ enabled }) => useHandTracking(enabled, ref), { initialProps: { enabled: true } })
  await waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
  const worker = FakeWorker.instances[0]
  act(() => worker.send({ type: 'ready' }))
  act(() => tick(100))
  rerender({ enabled: false })
  const close = vi.fn()
  await act(async () => resolve({ close }))
  expect(close).toHaveBeenCalledOnce()
  expect(worker.postMessage).toHaveBeenCalledTimes(1)
})

it('clears landmarks while hidden and rejects in-flight results after returning', async () => {
  let hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  let tick: FrameRequestCallback = () => {}
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { tick = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const capture = vi.fn().mockResolvedValue({ close: vi.fn() })
  vi.stubGlobal('createImageBitmap', capture)
  const video = { readyState: 4, videoWidth: 640, currentTime: 1 } as HTMLVideoElement
  const ref = { current: video }
  const { result } = renderHook(() => useHandTracking(true, ref))
  await waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
  const worker = FakeWorker.instances[0]
  act(() => worker.send({ type: 'ready' }))
  await act(async () => tick(100))
  hidden = true
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(result.current.landmarks).toEqual([])
  video.currentTime = 2
  await act(async () => tick(160))
  expect(capture).toHaveBeenCalledOnce()
  hidden = false
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  act(() => worker.send({ type: 'result', landmarks: [[{ x: 1, y: 1, z: 0 }]] }))
  expect(result.current.landmarks).toEqual([])
  await act(async () => tick(220))
  expect(capture).toHaveBeenCalledTimes(2)
  act(() => worker.send({ type: 'result', landmarks: [[{ x: .5, y: .5, z: 0 }]] }))
  expect(result.current.landmarks[0][0].x).toBe(.5)
})
it('handles bitmap capture failure without leaving an inference loop running', async () => {
  let tick: FrameRequestCallback = () => {}
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { tick = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const capture = vi.fn().mockRejectedValue(new Error('capture failed'))
  vi.stubGlobal('createImageBitmap', capture)
  const ref = { current: { readyState: 4, videoWidth: 640, currentTime: 1 } as HTMLVideoElement }
  const { result } = renderHook(() => useHandTracking(true, ref))
  await waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
  const worker = FakeWorker.instances[0]
  act(() => worker.send({ type: 'ready' }))
  await act(async () => tick(100))
  expect(result.current.status).toBe('error')
  expect(result.current.landmarks).toEqual([])
  expect(worker.terminate).toHaveBeenCalled()
  act(() => tick(200))
  expect(capture).toHaveBeenCalledOnce()
})
