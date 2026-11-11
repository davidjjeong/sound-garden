export type HandTrackingRequest = { type: 'initialize'; assetBase: string }
export type HandTrackingResponse =
  | { type: 'loading' }
  | { type: 'ready' }
  | { type: 'error'; message: string }
