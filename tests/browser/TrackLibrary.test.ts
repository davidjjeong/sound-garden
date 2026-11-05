import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TrackLibrary } from '../../src/components/studio/TrackLibrary'
import { deleteTrack, getTracks } from '../../src/lib/tracks'

vi.mock('../../src/lib/tracks', () => ({ getTracks: vi.fn(), deleteTrack: vi.fn() }))
vi.mock('../../src/hooks/useTrackUpload', () => ({ useTrackUpload: () => ({
  status: 'idle', error: null, completedTrack: null, canRetry: false, isUploading: false,
  startUpload: vi.fn(), retryUpload: vi.fn(), reset: vi.fn(),
}) }))
const id = '11111111-1111-4111-8111-111111111111'
const song = { id, title: 'Soft Orbit', size_bytes: 2048, created_at: '2026-11-05' }
const get = vi.mocked(getTracks)
const remove = vi.mocked(deleteTrack)
beforeEach(() => {
  vi.resetAllMocks()
  get.mockResolvedValue([song])
  remove.mockResolvedValue(id)
  // jsdom does not implement native modal behavior; simulate visibility only.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(cleanup)
async function openDialog() {
  render(createElement(TrackLibrary))
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Soft Orbit' }))
  return screen.getByRole('dialog')
}

describe('library deletion controls', () => {
  it('opens confirmation with the track name and Cancel focused; does not delete yet', async () => {
    const dialog = await openDialog()
    expect(within(dialog).getByText(/Soft Orbit/)).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
  })
  it('cancel closes without an API call or removing the row', async () => {
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete Soft Orbit' })).toBeTruthy()
    expect(remove).not.toHaveBeenCalled()
  })
  it('Escape cancels confirmation', async () => {
    const dialog = await openDialog()
    fireEvent(dialog, new Event('cancel', { cancelable: true, bubbles: false }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(remove).not.toHaveBeenCalled()
  })
  it('success removes only the deleted row and updates the count', async () => {
    get.mockResolvedValue([song, { ...song, id: '22222222-2222-4222-8222-222222222222', title: 'Other song' }])
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete track' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(remove).toHaveBeenCalledWith(id)
    expect(screen.queryByRole('button', { name: 'Delete Soft Orbit' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete Other song' })).toBeTruthy()
    expect(screen.getByText('1 track')).toBeTruthy()
    expect(screen.getByText('Track deleted.')).toBeTruthy()
  })
  it('deleting the last track displays the empty library', async () => {
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete track' }))
    expect(await screen.findByText('Add your first track')).toBeTruthy()
    expect(screen.getByText('0 tracks')).toBeTruthy()
  })
  it('blocks duplicate confirmations, cancel, and Escape while deleting', async () => {
    let finish!: (id: string) => void
    remove.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const dialog = await openDialog()
    const confirm = within(dialog).getByRole('button', { name: 'Delete track' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => { finish(id) })
  })
  it('retains the failed deletion ID after closing and reopening confirmation', async () => {
    remove.mockRejectedValueOnce(new Error('Storage unavailable'))
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete track' }))
    expect(await within(dialog).findByRole('alert')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry deletion' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Retry deletion' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(remove.mock.calls).toEqual([[id], [id]])
  })
})
