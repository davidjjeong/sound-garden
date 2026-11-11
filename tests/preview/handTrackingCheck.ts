const status = document.querySelector('#status')!
const worker = new Worker(new URL('../../src/workers/handTracking.worker.ts', import.meta.url), { type: 'module' })
worker.onmessage = async event => {
  status.textContent += `\n${JSON.stringify(event.data)}`
  if (event.data.type === 'ready') {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    const frame = await createImageBitmap(canvas)
    worker.postMessage({ type: 'frame', frame, timestamp: performance.now() }, [frame])
  }
}
worker.onerror = event => { status.textContent += `\nWorker error: ${event.message || 'no message'} at ${event.filename}:${event.lineno}` }
worker.postMessage({ type: 'initialize', assetBase: `${location.origin}/mediapipe/` })
window.addEventListener('pagehide', () => worker.terminate())
