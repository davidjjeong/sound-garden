import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ fileset: vi.fn(), create: vi.fn() }))
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: mocks.fileset },
  HandLandmarker: { createFromOptions: mocks.create },
}))
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); vi.resetModules() })
it('loads the module WASM runtime and initializes the model once', async () => {
  const worker = { onmessage: null as null | ((event: MessageEvent) => Promise<void>), postMessage: vi.fn() }
  vi.stubGlobal('self', worker)
  mocks.fileset.mockResolvedValue({ wasmLoaderPath: 'module.js' })
  mocks.create.mockResolvedValue({})
  await import('../../src/workers/handTracking.worker')
  const event = { data: { type: 'initialize', assetBase: 'https://example.test/mediapipe/' } } as MessageEvent
  await worker.onmessage!(event)
  await worker.onmessage!(event)
  expect(mocks.fileset).toHaveBeenCalledExactlyOnceWith('https://example.test/mediapipe/wasm', true)
  expect(mocks.create).toHaveBeenCalledOnce()
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'ready' })
})
it('reports initialization errors and allows a later retry', async () => {
  const worker = { onmessage: null as null | ((event: MessageEvent) => Promise<void>), postMessage: vi.fn() }
  vi.stubGlobal('self', worker)
  mocks.fileset.mockRejectedValueOnce(new Error('Runtime missing')).mockResolvedValue({})
  mocks.create.mockResolvedValue({})
  await import('../../src/workers/handTracking.worker')
  const event = { data: { type: 'initialize', assetBase: '/' } } as MessageEvent
  await worker.onmessage!(event)
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'error', message: 'Runtime missing' })
  await worker.onmessage!(event)
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'ready' })
})
