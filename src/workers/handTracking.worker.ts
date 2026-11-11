/// <reference lib="webworker" />

import {
  FilesetResolver,
  HandLandmarker,
} from '@mediapipe/tasks-vision'

let landmarker: HandLandmarker | null = null
let initialization: Promise<void> | null = null

async function initialize() {
  const vision = await FilesetResolver.forVisionTasks(
    '/mediapipe/wasm',
  )

  landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: '/mediapipe/hand_landmarker.task',
      delegate: 'CPU',
    },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  })
}

self.onmessage = async (event: MessageEvent<{ type: 'initialize' }>) => {
  if (event.data.type !== 'initialize') return

  try {
    initialization ??= initialize()
    await initialization

    self.postMessage({ type: 'ready' })
  } catch (error) {
    initialization = null

    self.postMessage({
      type: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Could not initialize hand tracking.',
    })
  }
}