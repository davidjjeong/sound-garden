import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AudioPlayer } from '../../src/components/studio/AudioPlayer'
import type { AudioPlayback } from '../../src/hooks/useAudioPlayback'

afterEach(cleanup)
function playback(patch: Partial<AudioPlayback> = {}): AudioPlayback {
  return {
    track: { id: 'id', title: 'Soft Orbit', storage_path: 'path', size_bytes: 10, created_at: 'date' },
    isLoading: false, isPlaying: false, isUnavailable: false, position: 65, duration: 180, volume: .5, manualVolumeRevision: 0, setGestureVolume: vi.fn(),
    error: '', notice: '', select: vi.fn(), play: vi.fn(), pause: vi.fn(), seek: vi.fn(),
    setVolume: vi.fn(), toggleMute: vi.fn(), readWaveForm: vi.fn(() => null), retry: vi.fn(), beginDeletion: vi.fn(), completeDeletion: vi.fn(), ...patch,
  }
}
it('renders time, title, and accessible functional controls', () => {
  const value = playback()
  render(createElement(AudioPlayer, { playback: value }))
  expect(screen.getByRole('heading', { name: 'Soft Orbit' })).toBeTruthy()
  expect(screen.getByText('1:05')).toBeTruthy()
  expect(screen.getByText('3:00')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  expect(value.play).toHaveBeenCalledOnce()
  fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), { target: { value: '90' } })
  expect(value.seek).not.toHaveBeenCalled()
  fireEvent.pointerUp(screen.getByRole('slider', { name: 'Playback position' }))
  expect(value.seek).toHaveBeenCalledWith(90)
  fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '.3' } })
  expect(value.setVolume).toHaveBeenCalledWith(.3)
})
it('Pause invokes pause; unimplemented controls remain disabled', () => {
  const value = playback({ isPlaying: true })
  render(createElement(AudioPlayer, { playback: value }))
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  expect(value.pause).toHaveBeenCalledOnce()
  for (const name of ['Shuffle', 'Previous track', 'Next track', 'Repeat']) {
    expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true)
  }
})
it('disables seeking and playback with no selected track', () => {
  render(createElement(AudioPlayer, { playback: playback({ track: null, duration: 0 }) }))
  expect(screen.getByRole('button', { name: 'Play — select a track first' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('slider', { name: 'Playback position' }).hasAttribute('disabled')).toBe(true)
})
it('exposes retry for errors and blocks controls during uncertain deletion', () => {
  const value = playback({ error: 'Network error' })
  const { rerender } = render(createElement(AudioPlayer, { playback: value }))
  expect(screen.getByRole('alert').textContent).toBe('Network error')
  fireEvent.click(screen.getByRole('button', { name: 'Retry playback' }))
  expect(value.retry).toHaveBeenCalledOnce()
  rerender(createElement(AudioPlayer, { playback: { ...value, isUnavailable: true } }))
  expect(screen.getByRole('button', { name: 'Play' }).hasAttribute('disabled')).toBe(true)
})

it('keeps seeking enabled while buffering and commits keyboard seeks', () => {
  const value = playback({ isLoading: true })
  render(createElement(AudioPlayer, { playback: value }))
  const slider = screen.getByRole('slider', { name: 'Playback position' })
  expect(slider.hasAttribute('disabled')).toBe(false)
  fireEvent.change(slider, { target: { value: '80' } })
  expect(value.seek).not.toHaveBeenCalled()
  fireEvent.keyUp(slider, { key: 'ArrowRight' })
  expect(value.seek).toHaveBeenCalledWith(80)
})
it('exposes the speaker as an accessible mute/unmute toggle', () => {
  const value = playback()
  const { rerender } = render(createElement(AudioPlayer, { playback: value }))
  fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
  expect(value.toggleMute).toHaveBeenCalledOnce()
  rerender(createElement(AudioPlayer, { playback: { ...value, volume: 0 } }))
  expect(screen.getByRole('button', { name: 'Unmute' }).getAttribute('aria-pressed')).toBe('true')
})
