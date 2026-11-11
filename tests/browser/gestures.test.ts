import { expect, it } from 'vitest'
import { detectPinch } from '../../src/lib/gestures'
import type { HandPoint } from '../../src/types/handTracking'

function makeHand(gap: number, scale = 1): HandPoint[] {
  const hand = Array.from({ length: 21 }, () => ({
    x: 0,
    y: 0,
    z: 0,
  }))

  hand[0] = { x: 0, y: 0, z: 0 }
  hand[9] = { x: 0, y: scale, z: 0 }
  hand[4] = { x: 0, y: scale, z: 0 }
  hand[8] = { x: gap * scale, y: scale, z: 0 }

  return hand
}

it('starts pinching at or below the start threshold', () => {
  expect(detectPinch(makeHand(0.2), false)).toBe(true)
  expect(detectPinch(makeHand(0.25), false)).toBe(true)
  expect(detectPinch(makeHand(0.3), false)).toBe(false)
})

it('holds an existing pinch until the release threshold', () => {
  expect(detectPinch(makeHand(0.3), true)).toBe(true)
  expect(detectPinch(makeHand(0.4), true)).toBe(false)
  expect(detectPinch(makeHand(0.5), true)).toBe(false)
})

it('preserves detection when the hand changes size', () => {
  for (const scale of [0.1, 0.5, 1]) {
    expect(detectPinch(makeHand(0.2, scale), false)).toBe(true)
    expect(detectPinch(makeHand(0.5, scale), true)).toBe(false)
  }
})

it('releases when the hand is missing or incomplete', () => {
  expect(detectPinch(undefined, true)).toBe(false)
  expect(detectPinch([], true)).toBe(false)
  expect(detectPinch(makeHand(0.2).slice(0, 20), true)).toBe(false)
})

it('rejects a zero-size palm', () => {
  expect(detectPinch(makeHand(0.2, 0), true)).toBe(false)
})

it('rejects invalid landmark coordinates', () => {
  for (const index of [0, 4, 8, 9]) {
    for (const coordinate of ['x', 'y', 'z'] as const) {
      for (const value of [NaN, Infinity, -Infinity]) {
        const hand = makeHand(0.2)
        hand[index][coordinate] = value

        expect(detectPinch(hand, true)).toBe(false)
      }
    }
  }
})