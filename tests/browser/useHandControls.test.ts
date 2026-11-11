import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useHandControls } from '../../src/hooks/useHandControls'
import { createHandVolumeController, dragVolume, pinchMidpointY } from '../../src/lib/gestures'
function hand(y = .5, gap = .1) {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))
  points[9] = { x: 0, y: 1, z: 0 }
  points[4] = { x: .2, y, z: 0 }
  points[8] = { x: .2 + gap, y, z: 0 }
  return points
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function setup() {
  const controller = createHandVolumeController()
  let timestamp = 0
  return (points = hand(), revision = 0, volume = .5, enabled = true) => {
    timestamp += 50
    return controller.update({ hand: points, manualRevision: revision, volume, enabled, timestamp })
  }
}
it('grabs without changing volume, increases upward and decreases downward', () => {
  const update = setup()
  expect(update()).toEqual({ mode: 'dragging' })
  expect(update(hand(.3)).volume).toBeGreaterThan(.5)
  let result
  for (let i = 0; i < 20; i++) result = update(hand(.7))
  expect(result?.mode).toBe('dragging')
  // Direct mapping verifies direction independent of emission suppression.
  expect(dragVolume(.5, .5, .7)).toBeLessThan(.5)
})
it('ignores tremors and clamps volume at both limits', () => {
  expect(dragVolume(.5, .5, .505)).toBe(.5)
  expect(dragVolume(.5, .5, .495)).toBe(.5)
  expect(dragVolume(.5, .5, -2)).toBe(1)
  expect(dragVolume(.5, .5, 3)).toBe(0)
  expect(pinchMidpointY(undefined)).toBeNull()
  expect(pinchMidpointY(hand(.6))).toBe(.6)
})
it('smooths movement and processes a landmark object only once', () => {
  const update = setup()
  update()
  const moved = hand(.3)
  const first = update(moved).volume!
  expect(first).toBeGreaterThan(.5)
  expect(first).toBeLessThan(dragVolume(.5, .5, .3))
  expect(update(moved).volume).toBeUndefined()
  expect(update(hand(.3)).volume).toBeGreaterThan(first)
})
it('releases on hand loss or disabling and rebases on a new grab', () => {
  const controller = createHandVolumeController()
  const run = (points: ReturnType<typeof hand> | undefined, enabled = true, volume = .5) => controller.update({ hand: points, enabled, volume, manualRevision: 0, timestamp: 100 })
  run(hand())
  expect(run(undefined).mode).toBe('idle')
  expect(run(hand(.2), true, .8)).toEqual({ mode: 'dragging' })
  expect(run(hand(), false).mode).toBe('idle')
  expect(run(hand(.5, .5)).mode).toBe('idle')
})
it('manual input cancels control until release, including a same-value manual edit', () => {
  const update = setup()
  const points = hand()
  update(points)
  expect(update(points, 1)).toEqual({ mode: 'waitingForRelease' })
  expect(update(hand(.2), 1)).toEqual({ mode: 'waitingForRelease' })
  expect(update(hand(.2, .5), 1).mode).toBe('idle')
  expect(update(hand(.2), 1, .75)).toEqual({ mode: 'dragging' })
})
it('hook emits live volume once per new result and not on its own volume renders', () => {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const onVolumeChange = vi.fn()
  const initial = { enabled: true, landmarks: [hand()], volume: .5, manualVolumeRevision: 0, onVolumeChange }
  const { result, rerender } = renderHook(props => useHandControls(props), { initialProps: initial })
  expect(result.current.mode).toBe('dragging')
  expect(onVolumeChange).not.toHaveBeenCalled()
  now = 50
  const landmarks = [hand(.3)]
  rerender({ ...initial, landmarks })
  expect(onVolumeChange).toHaveBeenCalledOnce()
  const volume = onVolumeChange.mock.calls[0][0]
  rerender({ ...initial, landmarks, volume })
  expect(onVolumeChange).toHaveBeenCalledOnce()
  rerender({ ...initial, landmarks, volume, manualVolumeRevision: 1 })
  expect(result.current.mode).toBe('waitingForRelease')
  act(() => { now = 100 })
  rerender({ ...initial, enabled: false, landmarks, volume, manualVolumeRevision: 1 })
  expect(result.current.mode).toBe('idle')
})
