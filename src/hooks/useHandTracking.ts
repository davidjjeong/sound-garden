import type { TrackingMetrics, TrackingFrame } from '../lib/trackingMetrics'
import { useEffect, useState, type RefObject } from 'react'
import type { HandPoint, HandTrackingRequest, HandTrackingResponse } from '../types/handTracking'

const EMPTY_LANDMARKS: HandPoint[][] = []

type TrackingState = { status: 'idle' | 'loading' | 'ready' | 'error'; error: string; landmarks: HandPoint[][] }

export function useHandTracking(enabled: boolean, videoRef?: RefObject<HTMLVideoElement | null>) {
  const [state, setState] = useState<TrackingState>({ status: 'idle', error: '', landmarks: [] })
  useEffect(() => {
    if (!enabled) return
    let active = true
    let worker: Worker | undefined
    let scheduled = 0
    let ready = false
    let busy = false
    let lastTime = -Infinity
    let lastVideoTime = -1
    let failed = false
    let visibilityEpoch = 0
    let sentEpoch = 0
    let metrics: TrackingMetrics | undefined
    let measuredFrame: TrackingFrame = null
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('benchmark') === '1') {
      void import('../lib/trackingMetrics').then(module => {
        if (!active || failed) return
        metrics = module.trackingMetrics
        metrics.setAvailable(ready && !document.hidden)
      })
    }
    const visibilityChanged = () => {
      visibilityEpoch++
      metrics?.setAvailable(ready && !document.hidden, 'stale')
      lastVideoTime = -1
      lastTime = -Infinity
      if (active && !failed) setState(previous => ({ ...previous, landmarks: [] }))
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    function capture(timestamp: number) {
      if (!active || failed) return
      scheduled = requestAnimationFrame(capture)
      const video = videoRef?.current
      if (document.hidden || !ready || busy || !video || video.readyState < 2 || !video.videoWidth ||
          timestamp - lastTime < 50 || video.currentTime === lastVideoTime) return
      busy = true
      lastTime = timestamp
      lastVideoTime = video.currentTime
      const captureEpoch = visibilityEpoch
      measuredFrame = metrics?.beginFrame(video.videoWidth, video.videoHeight) ?? null
      const capturedMeasurement = measuredFrame
      void createImageBitmap(video).then(frame => {
        if (!active || failed || document.hidden || captureEpoch !== visibilityEpoch) {
          frame.close()
          metrics?.finishFrame(capturedMeasurement, 'stale')
          busy = false
          return
        }
        try {
          sentEpoch = captureEpoch
          worker!.postMessage({ type: 'frame', frame, timestamp } satisfies HandTrackingRequest, [frame])
        } catch {
          frame.close()
          fail('Could not send a camera frame for hand tracking.')
        }
      }).catch(() => fail('Could not capture a camera frame for hand tracking.'))
    }
    const fail = (message: string) => {
      if (!active) return
      metrics?.finishFrame(measuredFrame, 'failed')
      metrics?.setAvailable(false)
      failed = true
      cancelAnimationFrame(scheduled)
      worker?.terminate()
      setState({ status: 'error', error: message, landmarks: [] })
    }
    // Report startup asynchronously, including Worker-constructor failures.
    queueMicrotask(() => {
      if (!active) return
      setState({ status: 'loading', error: '', landmarks: [] })
      try {
        worker = new Worker(new URL('../workers/handTracking.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<HandTrackingResponse>) => {
          if (!active || failed) return
          const message = event.data
          if (message.type === 'error') fail(message.message)
          else if (message.type === 'result') {
            metrics?.finishFrame(measuredFrame, !document.hidden && sentEpoch === visibilityEpoch ? 'completed' : 'stale', message.landmarks.length)
            measuredFrame = null
            busy = false
            if (!document.hidden && sentEpoch === visibilityEpoch) {
              setState({ status: 'ready', error: '', landmarks: message.landmarks })
            }
          } else if (message.type === 'loading'  || message.type === 'ready') {
            setState({ status: message.type, error: '', landmarks: [] })
            if (message.type === 'ready' && !ready) {
              ready = true
              metrics?.setAvailable(!document.hidden)
              if (videoRef) scheduled = requestAnimationFrame(capture)
            }
          }
        }
        worker.onerror = event => {
          event.preventDefault()
          fail(event.message || 'The hand-tracking worker could not start. Disable the camera and try again.')
        }
        worker.onmessageerror = () => fail('Could not read a hand-tracking response.')
        const assetBase = new URL(`${import.meta.env.BASE_URL}mediapipe/`, window.location.origin).href
        worker.postMessage({ type: 'initialize', assetBase } satisfies HandTrackingRequest)
      } catch (error) {
        const detail = error instanceof Error ? ` ${error.message}` : ''
        fail(`Hand tracking is unavailable in this browser.${detail}`)
      }
    })
    return () => {
      metrics?.setAvailable(false)
      active = false
      document.removeEventListener('visibilitychange', visibilityChanged)
      cancelAnimationFrame(scheduled)
      if (worker) {
        worker.onmessage = null
        worker.onerror = null
        worker.onmessageerror = null
        worker.terminate()
      }
    }
  }, [enabled, videoRef])
  return enabled ? state : { status: 'idle' as const, error: '', landmarks: EMPTY_LANDMARKS }
}
