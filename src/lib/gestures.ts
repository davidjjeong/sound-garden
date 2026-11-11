import type { HandPoint } from '../types/handTracking'

const PINCH_START = 0.25
const PINCH_RELEASE = 0.4

function distance(a: HandPoint, b: HandPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function detectPinch(
  hand: readonly HandPoint[] | undefined,
  wasPinching: boolean,
): boolean {
  if (!hand || hand.length !== 21) return false

  const wrist = hand[0]
  const thumbTip = hand[4]
  const indexTip = hand[8]
  const middleKnuckle = hand[9]

  const points = [wrist, thumbTip, indexTip, middleKnuckle]

  if (
    points.some(point =>
      !point ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.z)
    )
  ) {
    return false
  }

  const palmSize = distance(wrist, middleKnuckle)

  if (palmSize < 0.0001) return false

  const pinchRatio = distance(thumbTip, indexTip) / palmSize

  return wasPinching
    ? pinchRatio < PINCH_RELEASE
    : pinchRatio <= PINCH_START
}
export function pinchMidpointY(hand: readonly HandPoint[] | undefined): number | null {
  if (!hand?.[4] || !hand[8]) return null
  const y = (hand[4].y + hand[8].y) / 2
  return Number.isFinite(y) ? y : null
}

export function dragVolume(startVolume: number, startY: number, currentY: number) {
  const displacement = startY - currentY
  const outsideDeadZone = Math.sign(displacement) * Math.max(0, Math.abs(displacement) - .012)
  return Math.max(0, Math.min(1, startVolume + outsideDeadZone * 2))
}

export type HandControlMode = 'idle' | 'dragging' | 'waitingForRelease'

/** Stateful interaction math; has no React, camera, or audio dependencies. */
export function createHandVolumeController() {
  let pinching = false
  let mode: HandControlMode = 'idle'
  let revision: number | undefined
  let lastHand: readonly HandPoint[] | undefined
  let startY = 0
  let smoothY = 0
  let startVolume = 0
  let lastVolume = 0
  let lastTime = 0
  return {
    update(input: {
      hand?: readonly HandPoint[]; enabled: boolean; volume: number
      manualRevision: number; timestamp: number
    }): { mode: HandControlMode; volume?: number } {
      const manualOverride = revision !== undefined && revision !== input.manualRevision
      revision = input.manualRevision
      if (!input.enabled || !input.hand) {
        pinching = false
        mode = 'idle'
        lastHand = undefined
        return { mode }
      }
      if (input.hand === lastHand && !manualOverride) return { mode }
      lastHand = input.hand
      const nextPinch = detectPinch(input.hand, pinching)
      const y = pinchMidpointY(input.hand)
      if (!nextPinch || y === null) {
        pinching = false
        mode = 'idle'
        return { mode }
      }
      const wasPinching = pinching
      pinching = true
      if (manualOverride || mode === 'waitingForRelease') {
        mode = 'waitingForRelease'
        return { mode }
      }
      if (!wasPinching) {
        mode = 'dragging'
        startY = smoothY = y
        startVolume = lastVolume = input.volume
        lastTime = input.timestamp
        return { mode }
      }
      const elapsed = Math.max(0, Math.min(100, input.timestamp - lastTime))
      lastTime = input.timestamp
      smoothY += (y - smoothY) * (1 - Math.exp(-elapsed / 80))
      const volume = dragVolume(startVolume, startY, smoothY)
      if (Math.abs(volume - lastVolume) < .002) return { mode }
      lastVolume = volume
      return { mode, volume }
    },
  }
}

/** Extended fingers plus separated thumb/index; independent of screen orientation. */
export function detectOpenPalm(hand: readonly HandPoint[] | undefined): boolean {
  if (!hand || hand.length !== 21 || hand.some(p => !p || ![p.x, p.y, p.z].every(Number.isFinite))) return false
  const palm = distance(hand[0], hand[9])
  if (palm < .0001 || distance(hand[4], hand[8]) / palm < .45) return false
  for (const base of [5, 9, 13, 17]) {
    const a = hand[base], b = hand[base + 1], c = hand[base + 3]
    const ab = distance(a, b), bc = distance(b, c)
    if (ab < .0001 || bc < .0001) return false
    const cosine = ((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) + (a.z - b.z) * (c.z - b.z)) / (ab * bc)
    if (cosine > -.85 || distance(hand[0], c) < distance(hand[0], b) * 1.15) return false
  }
  return distance(hand[0], hand[4]) > distance(hand[0], hand[3]) * 1.05
}

export function createPalmHoldController() {
  let started: number | null = null
  let lastTime: number | null = null
  let latched = false
  let previousHand: readonly HandPoint[] | undefined
  return {
    update(hand: readonly HandPoint[] | undefined, enabled: boolean, allowed: boolean, timestamp: number) {
      if (!enabled || !detectOpenPalm(hand)) {
        started = lastTime = null
        latched = false
        previousHand = undefined
        return { progress: 0, latched: false, trigger: false }
      }
      if (hand === previousHand) return { progress: started === null ? 0 : Math.min(1, ((lastTime ?? timestamp) - started) / 600), latched, trigger: false }
      previousHand = hand
      if (!allowed || latched) {
        started = null
        lastTime = timestamp
        return { progress: 0, latched, trigger: false }
      }
      if (lastTime === null || timestamp - lastTime > 250) started = timestamp
      lastTime = timestamp
      started ??= timestamp
      const progress = Math.min(1, Math.max(0, (timestamp - started) / 600))
      if (progress >= 1) { latched = true; started = null }
      return { progress, latched, trigger: progress >= 1 }
    },
  }
}
