const status = document.querySelector('#status')!
const worker = new Worker(new URL('../../src/workers/handTracking.worker.ts', import.meta.url), { type: 'module' })
worker.onmessage = event => { status.textContent += `\n${JSON.stringify(event.data)}` }
worker.onerror = event => { status.textContent += `\nWorker error: ${event.message || 'no message'} at ${event.filename}:${event.lineno}` }
worker.postMessage({ type: 'initialize', assetBase: `${location.origin}/mediapipe/` })
window.addEventListener('pagehide', () => worker.terminate())
