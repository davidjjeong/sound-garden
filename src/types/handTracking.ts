export type HandPoint = { x: number; y: number; z: number }
export type HandTrackingRequest =
  | { type: 'initialize'; assetBase: string }
  | { type: 'frame'; frame: ImageBitmap; timestamp: number }
export type HandTrackingResponse =
  | { type: 'loading' }
  | { type: 'ready' }
  | { type: 'result'; landmarks: HandPoint[][] }
  | { type: 'error'; message: string }
