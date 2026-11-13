import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import BenchmarkPanel from '../../src/components/studio/BenchmarkPanel'
import { trackingMetrics } from '../../src/lib/trackingMetrics'
afterEach(() => { cleanup(); trackingMetrics.reset(); trackingMetrics.setAvailable(false); vi.restoreAllMocks(); vi.useRealTimers() })
it('starts, pauses active time when unavailable, stops and resets', () => {
  vi.useFakeTimers()
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  trackingMetrics.setAvailable(true)
  render(createElement(BenchmarkPanel))
  fireEvent.click(screen.getByRole('button', { name: 'Start' }))
  expect(screen.getByRole('status').textContent).toContain('Warming up')
  now = 4000
  act(() => vi.advanceTimersByTime(1000))
  expect(screen.getByRole('status').textContent).toBe('Measuring')
  trackingMetrics.setAvailable(false)
  now = 14000
  act(() => vi.advanceTimersByTime(1000))
  expect(trackingMetrics.snapshot().measuredMs).toBe(1000)
  expect(screen.getByRole('status').textContent).toContain('Waiting')
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
  expect(screen.getByRole('status').textContent).toBe('Stopped')
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(screen.getByRole('status').textContent).toBe('Not started')
})
it('downloads stopped results locally and stops collection on unmount', () => {
  vi.useFakeTimers()
  const create = vi.fn(() => 'blob:test')
  const revoke = vi.fn()
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const { unmount } = render(createElement(BenchmarkPanel))
  fireEvent.change(screen.getByLabelText('Device description'), { target: { value: 'Test laptop' } })
  fireEvent.click(screen.getByRole('button', { name: 'Start' }))
  expect(screen.getByRole('button', { name: 'Export JSON' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
  fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }))
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
  expect(click).toHaveBeenCalledTimes(2)
  expect(create).toHaveBeenCalledTimes(2)
  act(() => vi.advanceTimersByTime(1000))
  expect(revoke).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: 'Start' }))
  unmount()
  expect(trackingMetrics.snapshot().running).toBe(false)
  vi.unstubAllGlobals()
})
