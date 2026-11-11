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
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
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
