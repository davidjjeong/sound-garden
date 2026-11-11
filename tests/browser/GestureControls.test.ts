import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { GestureControls } from '../../src/components/studio/GestureControls'
const mocks = vi.hoisted(() => ({ enabled: true, stop: vi.fn(), start: vi.fn(), landmarks: [] as { x: number; y: number; z: number }[][] }))
vi.mock('../../src/hooks/useCamera', () => ({ useCamera: () => ({ videoRef: { current: null }, enabled: mocks.enabled, error: '', start: mocks.start, stop: mocks.stop }) }))
vi.mock('../../src/hooks/useHandTracking', () => ({ useHandTracking: () => ({ status: 'ready', error: '', landmarks: mocks.landmarks }) }))
afterEach(() => { cleanup(); mocks.enabled = true; mocks.landmarks = []; vi.clearAllMocks() })
it('portals the floating preview outside the panel and keeps detection text inside it', () => {
  const { container, rerender } = render(createElement(GestureControls))
  const preview = document.querySelector('.floating-camera')!
  expect(preview.parentElement).toBe(document.body)
  expect(container.contains(preview)).toBe(false)
  expect(container.querySelector('.camera-controls > button')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe('No hand detected')
  mocks.landmarks = [[{ x: .5, y: .5, z: 0 }]]
  rerender(createElement(GestureControls))
  expect(screen.getByRole('status').textContent).toBe('Hand detected')
  expect(container.querySelector('[role="status"]')).toBeNull()
})
it('supports keyboard movement and constrains the preview to the viewport', () => {
  render(createElement(GestureControls))
  const preview = document.querySelector('.floating-camera') as HTMLElement
  vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, width: 280, height: 280 } as DOMRect)
  const handle = screen.getByRole('button', { name: /Move camera preview/ })
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(preview.style.left).toBe('110px')
  fireEvent.keyDown(handle, { key: 'ArrowUp', shiftKey: true })
  expect(preview.style.top).toBe('60px')
  fireEvent.keyDown(handle, { key: 'Escape' })
  expect(mocks.stop).toHaveBeenCalledOnce()
})
it('closes with the close button and keeps the video mounted while disabled', () => {
  const { rerender } = render(createElement(GestureControls))
  fireEvent.click(screen.getByRole('button', { name: 'Close camera preview' }))
  expect(mocks.stop).toHaveBeenCalledOnce()
  mocks.enabled = false
  rerender(createElement(GestureControls))
  const preview = document.querySelector('.floating-camera') as HTMLElement
  expect(preview.hidden).toBe(true)
  expect(preview.querySelector('video')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Enable camera' }))
  expect(mocks.start).toHaveBeenCalledOnce()
})
