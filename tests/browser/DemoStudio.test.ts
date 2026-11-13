import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { DemoStudio } from '../../src/components/studio/DemoStudio'
const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  backend: vi.fn(() => { throw new Error('Demo must not access saved tracks') }),
}))
vi.mock('../../src/lib/tracks', () => ({ getTracks: mocks.backend, reserveUpload: mocks.backend,
  uploadReservedFile: mocks.backend, finalizeUpload: mocks.backend, deleteTrack: mocks.backend, getTrackPlaybackUrl: mocks.backend }))
vi.mock('../../src/components/studio/StudioWorkspace', () => ({ StudioWorkspace: ({ library }: { library: ReactNode }) => library }))
vi.mock('../../src/hooks/useAudioPlayback', () => ({ useAudioPlayback: () => ({
  track: null, isPlaying: false, isLoading: false, select: () => mocks.calls.push('select'),
  beginDeletion: () => mocks.calls.push('stop'), completeDeletion: () => mocks.calls.push('release'),
}) }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); mocks.calls.length = 0 })
it('offers sample playback without upload, delete, search, or saved-library requests', () => {
  const { container } = render(createElement(MemoryRouter, null, createElement(DemoStudio)))
  expect(screen.getByText('1 track')).toBeTruthy()
  expect(container.querySelector('input[type="file"]')).toBeNull()
  expect(screen.queryByRole('searchbox')).toBeNull()
  expect(screen.queryByRole('button', { name: /Upload|Delete/ })).toBeNull()
  expect(screen.getByRole('link', { name: /Sign in to upload your own music/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Select Cipher — Kevin MacLeod' }))
  expect(mocks.calls).toEqual(['select'])
  expect(mocks.backend).not.toHaveBeenCalled()
})

it('links signed-in visitors back to their studio', () => {
  render(createElement(MemoryRouter, null, createElement(DemoStudio, { isSignedIn: true })))
  expect(screen.getByRole('link', { name: /Back to my studio/ }).getAttribute('href')).toBe('/studio')
  expect(screen.queryByRole('link', { name: /Sign in/ })).toBeNull()
})
it('waits for the session before showing account navigation', () => {
  render(createElement(MemoryRouter, null, createElement(DemoStudio, { sessionLoading: true })))
  expect(screen.queryByRole('link', { name: /Sign in|Back to my studio/ })).toBeNull()
  expect(screen.getByRole('button', { name: 'Select Cipher — Kevin MacLeod' })).toBeTruthy()
})
