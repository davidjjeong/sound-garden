import { useEffect, useState } from 'react'
import type { HandTrackingRequest, HandTrackingResponse } from '../types/handTracking'

type TrackingState = { status: 'idle' | 'loading' | 'ready' | 'error'; error: string }

export function useHandTracking(enabled: boolean) {
  const [state, setState] = useState<TrackingState>({ status: 'idle', error: '' })
  useEffect(() => {
    if (!enabled) return
    let active = true
    let worker: Worker | undefined
    const fail = (message: string) => {
      if (!active) return
      worker?.terminate()
      setState({ status: 'error', error: message })
    }
    // Report startup asynchronously, including Worker-constructor failures.
    queueMicrotask(() => {
      if (!active) return
      setState({ status: 'loading', error: '' })
      try {
        worker = new Worker(new URL('../workers/handTracking.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<HandTrackingResponse>) => {
          if (!active) return
          const message = event.data
          if (message.type === 'error') fail(message.message)
          else if (message.type === 'loading' || message.type === 'ready') {
            setState({ status: message.type, error: '' })
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
      active = false
      if (worker) {
        worker.onmessage = null
        worker.onerror = null
        worker.onmessageerror = null
        worker.terminate()
      }
    }
  }, [enabled])
  return enabled ? state : { status: 'idle' as const, error: '' }
}
