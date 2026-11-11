import * as handControls from '../../src/hooks/useHandControls'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { GestureControls } from '../../src/components/studio/GestureControls'
const mocks = vi.hoisted(() => ({ enabled: true, stop: vi.fn(), start: vi.fn(), landmarks: [] as { x: number; y: number; z: number }[][] }))
vi.mock('../../src/hooks/useCamera', () => ({ useCamera: () => ({ videoRef: { current: null }, enabled: mocks.enabled, error: '', start: mocks.start, stop: mocks.stop }) }))
vi.mock('../../src/hooks/useHandTracking', () => ({ useHandTracking: () => ({ status: 'ready', error: '', landmarks: mocks.landmarks }) }))
afterEach(() => { cleanup(); mocks.enabled = true; mocks.landmarks = []; vi.clearAllMocks(); vi.restoreAllMocks(); vi.useRealTimers() })
it('portals the floating preview outside the panel and keeps detection text inside it', () => {
  const { container, rerender } = render(createElement(GestureControls, { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn() }))
  const preview = document.querySelector('.floating-camera')!
  expect(preview.parentElement).toBe(document.body)
  expect(container.contains(preview)).toBe(false)
  expect(container.querySelector('.camera-controls > button')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe('No hand detected')
  mocks.landmarks = [[{ x: .5, y: .5, z: 0 }]]
  rerender(createElement(GestureControls, { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn() }))
  expect(screen.getByRole('status').textContent).toBe('Hand detected')
  expect(container.querySelector('[role="status"]')).toBeNull()
})
it('supports keyboard movement and constrains the preview to the viewport', () => {
  render(createElement(GestureControls, { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn() }))
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
  const { rerender } = render(createElement(GestureControls, { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn() }))
  fireEvent.click(screen.getByRole('button', { name: 'Close camera preview' }))
  expect(mocks.stop).toHaveBeenCalledOnce()
  mocks.enabled = false
  rerender(createElement(GestureControls, { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn() }))
  const preview = document.querySelector('.floating-camera') as HTMLElement
  expect(preview.hidden).toBe(true)
  expect(preview.querySelector('video')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Enable camera' }))
  expect(mocks.start).toHaveBeenCalledOnce()
})

function pinchHand(gap: number) {
  const hand = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))
  hand[9] = { x: 0, y: 1, z: 0 }
  hand[4] = { x: 0, y: 1, z: 0 }
  hand[8] = { x: gap, y: 1, z: 0 }
  return hand
}
it('shows pinch hysteresis and releases when tracking loses the hand', () => {
  const { rerender } = render(createElement(GestureControls, { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn() }))
  expect(screen.getByText('Ready for gestures')).toBeTruthy()
  mocks.landmarks = [pinchHand(.2)]
  rerender(createElement(GestureControls, { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn() }))
  expect(screen.getByText('Adjusting volume · 50%')).toBeTruthy()
  mocks.landmarks = [pinchHand(.3)]
  rerender(createElement(GestureControls, { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn() }))
  expect(screen.getByText('Adjusting volume · 50%')).toBeTruthy()
  mocks.landmarks = [pinchHand(.4)]
  rerender(createElement(GestureControls, { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn() }))
  expect(screen.getByText('Ready for gestures')).toBeTruthy()
  mocks.landmarks = [pinchHand(.2)]
  rerender(createElement(GestureControls, { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn() }))
  mocks.landmarks = []
  rerender(createElement(GestureControls, { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn() }))
  expect(screen.getByText('Ready for gestures')).toBeTruthy()
})
it('clears the pinch on camera disable instead of retaining the previous grab', () => {
  mocks.landmarks = [pinchHand(.2)]
  const { rerender } = render(createElement(GestureControls, { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn() }))
  expect(screen.getByText('Adjusting volume · 50%')).toBeTruthy()
  mocks.enabled = false
  rerender(createElement(GestureControls, { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn() }))
  expect(screen.queryByText('Adjusting volume · 50%')).toBeNull()
  mocks.enabled = true
  mocks.landmarks = [pinchHand(.3)]
  rerender(createElement(GestureControls, { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn() }))
  expect(screen.getByText('Ready for gestures')).toBeTruthy()
})

it('keeps both gesture instructions visible and highlights volume adjustment', () => {
  mocks.landmarks = [pinchHand(.2)]
  render(createElement(GestureControls, { volume: .65, manualVolumeRevision: 0, onVolumeChange: vi.fn() }))
  expect(screen.getByText('Pinch + move up / down')).toBeTruthy()
  expect(screen.getByText('Play / pause')).toBeTruthy()
  expect(screen.getByText('Select a track first')).toBeTruthy()
  const row = screen.getByText('Volume').closest('.gesture-guide-row')
  expect(row?.getAttribute('data-active')).toBe('true')
  expect(screen.getByText('Adjusting volume · 65%')).toBeTruthy()
})
it('reports hand loss and clears that history after the camera is disabled', () => {
  mocks.landmarks = [pinchHand(.5)]
  const props = { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn() }
  const { rerender } = render(createElement(GestureControls, props))
  mocks.landmarks = []
  rerender(createElement(GestureControls, props))
  expect(screen.getByRole('status').textContent).toBe('Hand lost — bring it back into view')
  mocks.enabled = false
  rerender(createElement(GestureControls, props))
  mocks.enabled = true
  rerender(createElement(GestureControls, props))
  expect(screen.getByRole('status').textContent).toBe('No hand detected')
})
it('keeps playback status separate from neutral instructions and gesture feedback', () => {
  let toggle: (() => void) | undefined
  vi.spyOn(handControls, 'useHandControls').mockImplementation(options => {
    toggle = options.onTogglePlayback
    return { mode: 'idle', palmProgress: 0, palmLatched: false }
  })
  const callback = vi.fn()
  const props = { volume: .5, manualVolumeRevision: 0, onVolumeChange: vi.fn(),
    canTogglePlayback: true, isPlaying: true, onTogglePlayback: callback }
  const { rerender } = render(createElement(GestureControls, props))
  expect(screen.getByLabelText('Playback status').textContent).toBe('Playing')
  expect(screen.getByText('Open palm · hold for 0.6s')).toBeTruthy()
  expect(screen.getByText('Ready for gestures')).toBeTruthy()
  act(() => toggle?.())
  expect(callback).toHaveBeenCalledOnce()
  expect(screen.getByLabelText('Playback status').textContent).toBe('Playing')
  rerender(createElement(GestureControls, { ...props, isPlaying: false }))
  expect(screen.getByLabelText('Playback status').textContent).toBe('Paused')
  expect(screen.getByText('Ready for gestures')).toBeTruthy()
  rerender(createElement(GestureControls, { ...props, isPlaying: false, volume: .7 }))
  expect(screen.getByLabelText('Playback status').textContent).toBe('Paused')
})
