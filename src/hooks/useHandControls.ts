import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { createHandVolumeController, type HandControlMode } from '../lib/gestures'
import type { HandPoint } from '../types/handTracking'

type Options = {
  enabled: boolean
  landmarks: HandPoint[][]
  volume: number
  manualVolumeRevision: number
  onVolumeChange: (volume: number) => void
}

export function useHandControls({ enabled, landmarks, volume, manualVolumeRevision, onVolumeChange }: Options) {
  const controller = useRef<ReturnType<typeof createHandVolumeController> | null>(null)
  const [mode, setMode] = useState<HandControlMode>('idle')
  const inputs = useEffectEvent(() => ({ volume, onVolumeChange }))
  useEffect(() => {
    controller.current ??= createHandVolumeController()
    const current = inputs()
    const result = controller.current.update({
      hand: landmarks[0], enabled, volume: current.volume,
      manualRevision: manualVolumeRevision, timestamp: performance.now(),
    })
    // External landmark results drive interaction state; volume renders do not replay frames.
    setMode(result.mode)
    if (result.volume !== undefined) current.onVolumeChange(result.volume)
  }, [enabled, landmarks, manualVolumeRevision])
  return { mode: enabled ? mode : 'idle' }
}
