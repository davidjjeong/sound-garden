import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WaveformView } from '../../src/components/studio/WaveformView'
let frame: FrameRequestCallback
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function bars() { return screen.getByRole('img', { name: 'Live music visualizer' }).querySelectorAll('rect') }
function height(i = 0) { return Number(bars()[i].getAttribute('height')) }
it('renders 96 compact rounded dark-green bars with no waveform curve or timeline', () => {
  render(createElement(WaveformView, { readFrequencyBands: () => null, isPlaying: false }))
  expect(bars()).toHaveLength(96)
  expect(bars()[0].parentElement?.getAttribute('fill')).toBe('#303a34')
  expect(bars()[0].getAttribute('rx')).toBe('2.2')
  expect(bars()[0].getAttribute('ry')).toBe('4.4')
  expect(height()).toBe(2)
  expect(screen.queryByRole('slider')).toBeNull()
  expect(screen.getByRole('img').querySelector('path')).toBeNull()
})
it('responds independently to frequency regions and eases motion without rebuilding bars', () => {
  const spectrum = new Float32Array(96)
  spectrum[40] = .5
  render(createElement(WaveformView, { readFrequencyBands: () => spectrum, isPlaying: true }))
  const original = bars()[40]
  const initial = height(40)
  frame(16)
  expect(height(40)).toBeGreaterThan(initial)
  expect(height(0)).toBe(2)
  const peak = height(40)
  spectrum.fill(0)
  frame(32)
  expect(height(40)).toBeLessThan(peak)
  expect(height(40)).toBeGreaterThan(2)
  expect(bars()[40]).toBe(original)
  for (let i = 3; i < 200; i++) frame(i * 16)
  expect(height(40)).toBeCloseTo(2, 4)
})
it('settles to baseline when paused without reading more audio', () => {
  const read = vi.fn(() => new Float32Array(96).fill(.2))
  const { rerender, unmount } = render(createElement(WaveformView, { readFrequencyBands: read, isPlaying: true }))
  expect(height()).toBeGreaterThan(2)
  const count = read.mock.calls.length
  rerender(createElement(WaveformView, { readFrequencyBands: read, isPlaying: false }))
  for (let i = 1; i < 200; i++) frame(i * 16)
  expect(read).toHaveBeenCalledTimes(count)
  expect(height()).toBeCloseTo(2, 4)
  unmount()
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
})
it.each([null, new Float32Array()])('handles absent spectrum data', data => {
  render(createElement(WaveformView, { readFrequencyBands: () => data, isPlaying: true }))
  frame(16)
  expect(height()).toBe(2)
})

it('gives modest audio levels visible height, retains volume response, and caps peaks', () => {
  const spectrum = new Float32Array(96).fill(.03)
  render(createElement(WaveformView, { readFrequencyBands: () => spectrum, isPlaying: true }))
  for (let i = 1; i <= 80; i++) frame(i * 16)
  const normal = height()
  expect(normal).toBeGreaterThan(200)
  expect(normal).toBeLessThan(250)
  expect(normal).toBeLessThan(480)
  spectrum.fill(.01)
  for (let i = 81; i <= 200; i++) frame(i * 16)
  expect(height()).toBeLessThan(normal)
  spectrum.fill(1)
  for (let i = 201; i <= 300; i++) frame(i * 16)
  expect(height()).toBeCloseTo(480, 2)
  expect(height()).toBeLessThanOrEqual(480)
})
