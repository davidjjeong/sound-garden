import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createPalmHoldController, detectOpenPalm } from '../../src/lib/gestures'
import { useHandControls } from '../../src/hooks/useHandControls'
function openHand() {
  const hand = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))
  hand[1] = { x: -.1, y: .2, z: 0 }
  hand[2] = { x: -.2, y: .3, z: 0 }
  hand[3] = { x: -.3, y: .4, z: 0 }
  hand[4] = { x: -.5, y: .6, z: 0 }
  for (const [i, base] of [5, 9, 13, 17].entries()) {
    const x = (i - 1.5) * .2
    for (let joint = 0; joint < 4; joint++) hand[base + joint] = { x, y: .4 + joint * .22, z: 0 }
  }
  return hand
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('recognizes extended fingers at different scales and orientations', () => {
  expect(detectOpenPalm(openHand())).toBe(true)
  const rotated = openHand().map(p => ({ x: -p.y * .2, y: p.x * .2, z: p.z * .2 }))
  expect(detectOpenPalm(rotated)).toBe(true)
})
it('rejects bent fingers, pinch, incomplete and invalid hands', () => {
  const bent = openHand()
  bent[8] = { ...bent[5] }
  expect(detectOpenPalm(bent)).toBe(false)
  const pinch = openHand()
  pinch[4] = { ...pinch[8] }
  expect(detectOpenPalm(pinch)).toBe(false)
  expect(detectOpenPalm(undefined)).toBe(false)
  expect(detectOpenPalm([])).toBe(false)
  const invalid = openHand()
  invalid[8].x = NaN
  expect(detectOpenPalm(invalid)).toBe(false)
})
it('holds for 600 ms, triggers once, and requires release before another toggle', () => {
  const hold = createPalmHoldController()
  expect(hold.update(openHand(), true, true, 0).progress).toBe(0)
  for (let time = 100; time <= 500; time += 100) expect(hold.update(openHand(), true, true, time).trigger).toBe(false)
  expect(hold.update(openHand(), true, true, 600).trigger).toBe(true)
  expect(hold.update(openHand(), true, true, 700)).toMatchObject({ latched: true, trigger: false })
  hold.update(undefined, true, true, 800)
  hold.update(openHand(), true, true, 900)
  for (let time = 1000; time <= 1400; time += 100) hold.update(openHand(), true, true, time)
  expect(hold.update(openHand(), true, true, 1500).trigger).toBe(true)
})
it('does not complete a hold using stale frames or gaps in detection', () => {
  const hold = createPalmHoldController()
  const hand = openHand()
  hold.update(hand, true, true, 0)
  expect(hold.update(hand, true, true, 700).trigger).toBe(false)
  expect(hold.update(openHand(), true, true, 800).progress).toBe(0)
  expect(hold.update(openHand(), true, true, 900).progress).toBeCloseTo(1 / 6)
  expect(hold.update(undefined, true, true, 950).progress).toBe(0)
  expect(hold.update(openHand(), true, true, 1000).progress).toBe(0)
})
it('does not toggle when playback is unavailable and preserves a fired latch through loading', () => {
  const hold = createPalmHoldController()
  for (let time = 0; time <= 1000; time += 100) expect(hold.update(openHand(), true, false, time).trigger).toBe(false)
  for (let time = 1100; time <= 1600; time += 100) hold.update(openHand(), true, true, time)
  expect(hold.update(openHand(), true, true, 1700).trigger).toBe(true)
  expect(hold.update(openHand(), true, false, 1800).latched).toBe(true)
  expect(hold.update(openHand(), true, true, 1900).trigger).toBe(false)
  expect(hold.update(openHand(), false, true, 2000).latched).toBe(false)
})
it('hook toggles playback once after a full hold and reports progress', () => {
  let time = 0
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  const onTogglePlayback = vi.fn()
  const options = { enabled: true, landmarks: [openHand()], volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn(), canTogglePlayback: true, onTogglePlayback }
  const { result, rerender } = renderHook(props => useHandControls(props), { initialProps: options })
  for (time = 100; time <= 500; time += 100) rerender({ ...options, landmarks: [openHand()] })
  expect(result.current.palmProgress).toBeCloseTo(5 / 6)
  time = 600
  const landmarks = [openHand()]
  rerender({ ...options, landmarks })
  expect(onTogglePlayback).toHaveBeenCalledOnce()
  expect(result.current.palmLatched).toBe(true)
  rerender({ ...options, landmarks, volume: .6 })
  expect(onTogglePlayback).toHaveBeenCalledOnce()
  time = 700
  rerender({ ...options, landmarks: [openHand()] })
  expect(onTogglePlayback).toHaveBeenCalledOnce()
  expect(options.onVolumeChange).not.toHaveBeenCalled()
})
