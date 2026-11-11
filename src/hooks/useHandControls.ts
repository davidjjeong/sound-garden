import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { createPalmHoldController, createHandVolumeController, type HandControlMode } from '../lib/gestures'
import type { HandPoint } from '../types/handTracking'

type Options = {
  enabled: boolean
  landmarks: HandPoint[][]
  volume: number
  manualVolumeRevision: number
  onVolumeChange: (volume: number) => void
  canTogglePlayback?: boolean
  onTogglePlayback?: () => void
}

export function useHandControls({ enabled, landmarks, volume, manualVolumeRevision, onVolumeChange, canTogglePlayback = false, onTogglePlayback }: Options) {
  const controller = useRef<ReturnType<typeof createHandVolumeController> | null>(null)
  const palm = useRef<ReturnType<typeof createPalmHoldController> | null>(null)
  const [palmState, setPalmState] = useState({ progress: 0, latched: false })
  const [mode, setMode] = useState<HandControlMode>('idle')
  const inputs = useEffectEvent(() => ({ volume, onVolumeChange, onTogglePlayback }))
  useEffect(() => {
    controller.current ??= createHandVolumeController()
    palm.current ??= createPalmHoldController()
    const current = inputs()
    const result = controller.current.update({
      hand: landmarks[0], enabled, volume: current.volume,
      manualRevision: manualVolumeRevision, timestamp: performance.now(),
    })
    // External landmark results drive interaction state; volume renders do not replay frames.
    setMode(result.mode)
    if (result.volume !== undefined) current.onVolumeChange(result.volume)
    const hold = palm.current.update(landmarks[0], enabled,
      canTogglePlayback && result.mode === 'idle', performance.now())
    setPalmState({ progress: hold.progress, latched: hold.latched })
    if (hold.trigger) current.onTogglePlayback?.()
  }, [enabled, landmarks, manualVolumeRevision, canTogglePlayback])
  return { mode: enabled ? mode : 'idle', palmProgress: enabled ? palmState.progress : 0, palmLatched: enabled && palmState.latched }
}
