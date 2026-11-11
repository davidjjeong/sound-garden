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

it('detects landmarks and closes each transferred bitmap, including on failure', async () => {
  const worker = { onmessage: null as null | ((event: MessageEvent) => Promise<void>), postMessage: vi.fn() }
  vi.stubGlobal('self', worker)
  const points = [[{ x: .2, y: .3, z: 0 }]]
  const detectForVideo = vi.fn().mockReturnValue({ landmarks: points })
  mocks.fileset.mockResolvedValue({})
  mocks.create.mockResolvedValue({ detectForVideo })
  await import('../../src/workers/handTracking.worker')
  await worker.onmessage!({ data: { type: 'initialize', assetBase: '/' } } as MessageEvent)
  const frame = { close: vi.fn() }
  await worker.onmessage!({ data: { type: 'frame', frame, timestamp: 100 } } as MessageEvent)
  expect(detectForVideo).toHaveBeenCalledWith(frame, 100)
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'result', landmarks: points })
  expect(frame.close).toHaveBeenCalledOnce()
  detectForVideo.mockImplementationOnce(() => { throw new Error('Inference failed') })
  const failedFrame = { close: vi.fn() }
  await worker.onmessage!({ data: { type: 'frame', frame: failedFrame, timestamp: 150 } } as MessageEvent)
  expect(failedFrame.close).toHaveBeenCalledOnce()
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'error', message: 'Inference failed' })
})
