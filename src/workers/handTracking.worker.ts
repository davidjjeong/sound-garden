/// <reference lib="webworker" />
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import type { HandTrackingRequest, HandTrackingResponse } from '../types/handTracking'

let initialization: Promise<HandLandmarker> | null = null
const worker = self as unknown as DedicatedWorkerGlobalScope
const reply = (message: HandTrackingResponse) => worker.postMessage(message)

async function initialize(assetBase: string) {
  const vision = await FilesetResolver.forVisionTasks(`${assetBase}wasm`, true)
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: `${assetBase}hand_landmarker.task`, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: .6,
    minHandPresenceConfidence: .6,
    minTrackingConfidence: .6,
  })
}

worker.onmessage = async (event: MessageEvent<HandTrackingRequest>) => {
  const message = event.data
  if (message.type === 'frame') {
    try {
      if (!initialization) throw new Error('Hand tracking is not initialized.')
      const landmarker = await initialization
      const result = landmarker.detectForVideo(message.frame, message.timestamp)
      reply({ type: 'result', landmarks: result.landmarks })
    } catch (error) {
      reply({ type: 'error', message: error instanceof Error ? error.message : 'Hand detection failed.' })
    } finally {
      message.frame.close()
    }
    return
  }
  reply({ type: 'loading' })
  try {
    initialization ??= initialize(message.assetBase)
    await initialization
    reply({ type: 'ready' })
  } catch (error) {
    initialization = null
    reply({ type: 'error', message: error instanceof Error ? error.message : 'Could not initialize hand tracking.' })
  }
}
