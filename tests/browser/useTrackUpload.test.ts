import { DuplicateTrackError } from '../../src/lib/uploadErrors'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTrackUpload } from '../../src/hooks/useTrackUpload'
import { finalizeUpload, reserveUpload, uploadReservedFile } from '../../src/lib/tracks'
import type { ReservationResponse, ReadyTrack, ReservedTrack } from '../../src/types/uploads'

vi.mock('../../src/lib/tracks', () => ({
  reserveUpload: vi.fn(), uploadReservedFile: vi.fn(), finalizeUpload: vi.fn(),
}))
const pending: ReservedTrack = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Song', status: 'pending',
  storagePath: 'user/track.mp3', mimeType: 'audio/mpeg', sizeBytes: 3,
  expiresAt: '2099-01-01T00:00:00Z',
}
const ready: ReadyTrack = { ...pending, status: 'ready', expiresAt: null }
const upload: ReservationResponse = {
  action: 'upload', track: pending,
  upload: { bucket: 'audio', path: pending.storagePath, token: 'test-token' },
}
const file = () => new File(['abc'], 'song.mp3')
const reserve = vi.mocked(reserveUpload)
const transfer = vi.mocked(uploadReservedFile)
const finalize = vi.mocked(finalizeUpload)

beforeEach(() => {
  vi.resetAllMocks()
  reserve.mockResolvedValue(upload)
  transfer.mockResolvedValue(undefined)
  finalize.mockResolvedValue(ready)
})
afterEach(cleanup)

describe('upload orchestration', () => {
  it('reserves, transfers, then verifies; exposes completion only after verification', async () => {
    let finish!: (track: ReadyTrack) => void
    finalize.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { result } = renderHook(() => useTrackUpload())
    let operation!: Promise<ReadyTrack | null>
    await act(async () => {
      operation = result.current.startUpload(file())
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.status).toBe('verifying')
    expect(result.current.completedTrack).toBeNull()
    expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(transfer.mock.invocationCallOrder[0])
    expect(transfer.mock.invocationCallOrder[0]).toBeLessThan(finalize.mock.invocationCallOrder[0])
    await act(async () => { finish(ready); await operation })
    expect(result.current.completedTrack).toEqual(ready)
    expect(result.current.status).toBe('complete')
    expect(result.current.canRetry).toBe(false)
  })

  it('reuses the original file and key after an uncertain transfer; skips reupload when storage already has it', async () => {
    transfer.mockRejectedValueOnce(new Error('Connection lost'))
    const selected = file()
    const { result } = renderHook(() => useTrackUpload())
    await act(async () => { await result.current.startUpload(selected) })
    const originalKey = reserve.mock.calls[0][1]
    expect(result.current.canRetry).toBe(true)
    expect(finalize).not.toHaveBeenCalled()
    reserve.mockResolvedValueOnce({ action: 'finalize', track: pending })
    await act(async () => { await result.current.retryUpload() })
    expect(reserve).toHaveBeenLastCalledWith(selected, originalKey)
    expect(transfer).toHaveBeenCalledTimes(1)
    expect(finalize).toHaveBeenCalledOnce()
    expect(result.current.status).toBe('complete')
  })

  it('recovers a lost finalization response through an already-ready reservation', async () => {
    finalize.mockRejectedValueOnce(new Error('Response lost'))
    const { result } = renderHook(() => useTrackUpload())
    await act(async () => { await result.current.startUpload(file()) })
    const key = reserve.mock.calls[0][1]
    expect(result.current.status).toBe('error')
    reserve.mockResolvedValueOnce({ action: 'ready', track: ready })
    await act(async () => { await result.current.retryUpload() })
    expect(reserve.mock.calls[1][1]).toBe(key)
    expect(transfer).toHaveBeenCalledTimes(1)
    expect(finalize).toHaveBeenCalledTimes(1)
    expect(result.current.completedTrack).toEqual(ready)
  })

  it('does not transfer or finalize after reservation failure', async () => {
    reserve.mockRejectedValueOnce(new Error('Quota reached'))
    const { result } = renderHook(() => useTrackUpload())
    await act(async () => { await result.current.startUpload(file()) })
    expect(result.current.error).toBe('Quota reached')
    expect(transfer).not.toHaveBeenCalled()
    expect(finalize).not.toHaveBeenCalled()
  })

  it('blocks rapid double submissions before React rerenders', async () => {
    let release!: (value: ReservationResponse) => void
    reserve.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    const { result } = renderHook(() => useTrackUpload())
    await act(async () => {
      const first = result.current.startUpload(file())
      expect(await result.current.startUpload(file())).toBeNull()
      expect(reserve).toHaveBeenCalledOnce()
      release(upload)
      await first
    })
    expect(transfer).toHaveBeenCalledOnce()
  })

  it.each([
    new File([], 'empty.mp3'), new File(['abc'], 'image.png'),
    new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'large.wav'),
  ])('rejects invalid input before creating a reservation: $name', async (invalid) => {
    const { result } = renderHook(() => useTrackUpload())
    await act(async () => { await result.current.startUpload(invalid) })
    expect(reserve).not.toHaveBeenCalled()
    expect(result.current.canRetry).toBe(false)
  })

  it('stops subsequent stages if the component unmounts during reservation', async () => {
    let release!: (value: ReservationResponse) => void
    reserve.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    const { result, unmount } = renderHook(() => useTrackUpload())
    let operation!: Promise<ReadyTrack | null>
    act(() => { operation = result.current.startUpload(file()) })
    unmount()
    release(upload)
    expect(await operation).toBeNull()
    expect(transfer).not.toHaveBeenCalled()
    expect(finalize).not.toHaveBeenCalled()
  })

  it('reset clears the retained retry attempt', async () => {
    reserve.mockRejectedValueOnce(new Error('Offline'))
    const { result } = renderHook(() => useTrackUpload())
    await act(async () => { await result.current.startUpload(file()) })
    act(() => result.current.reset())
    await act(async () => { expect(await result.current.retryUpload()).toBeNull() })
    expect(reserve).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('idle')
  })

  it('currently treats selecting the same file again as a distinct attempt', async () => {
    const selected = file()
    const { result } = renderHook(() => useTrackUpload())
    await act(async () => { await result.current.startUpload(selected) })
    await act(async () => { await result.current.startUpload(selected) })
    expect(reserve.mock.calls[0][1]).not.toBe(reserve.mock.calls[1][1])
    expect(transfer).toHaveBeenCalledTimes(2)
  })
})

describe('upload lifecycle boundaries', () => {
  it('retry before any attempt does nothing', async () => {
    const { result } = renderHook(() => useTrackUpload())
    await act(async () => { expect(await result.current.retryUpload()).toBeNull() })
    expect(reserve).not.toHaveBeenCalled()
  })
  it('reset and retry cannot interrupt an in-flight reservation', async () => {
    let release!: (value: ReservationResponse) => void
    reserve.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    const { result } = renderHook(() => useTrackUpload())
    let operation!: Promise<ReadyTrack | null>
    act(() => { operation = result.current.startUpload(file()) })
    act(() => result.current.reset())
    expect(result.current.status).toBe('reserving')
    await act(async () => { expect(await result.current.retryUpload()).toBeNull() })
    expect(reserve).toHaveBeenCalledOnce()
    await act(async () => { release(upload); await operation })
    expect(result.current.status).toBe('complete')
  })
  it('unmount during transfer prevents finalization', async () => {
    let release!: () => void
    transfer.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    const { result, unmount } = renderHook(() => useTrackUpload())
    let operation!: Promise<ReadyTrack | null>
    await act(async () => { operation = result.current.startUpload(file()); await Promise.resolve() })
    expect(transfer).toHaveBeenCalledOnce()
    unmount()
    release()
    expect(await operation).toBeNull()
    expect(finalize).not.toHaveBeenCalled()
  })
  it('rejects names longer than 255 characters', async () => {
    const { result } = renderHook(() => useTrackUpload())
    await act(async () => { await result.current.startUpload(new File(['abc'], `${'a'.repeat(252)}.mp3`)) })
    expect(reserve).not.toHaveBeenCalled()
    expect(result.current.canRetry).toBe(false)
  })
  it('accepts uppercase extensions and the exact 20 MiB limit', async () => {
    const { result } = renderHook(() => useTrackUpload())
    const selected = new File([new Uint8Array(20 * 1024 * 1024)], 'SONG.WAV')
    await act(async () => { await result.current.startUpload(selected) })
    expect(reserve).toHaveBeenCalledWith(selected, expect.any(String))
  })
})


it.each(['reserve', 'finalize'])('duplicate rejection at %s disables retry and releases the attempt', async (stage) => {
  if (stage === 'reserve') reserve.mockRejectedValueOnce(new DuplicateTrackError())
  else finalize.mockRejectedValueOnce(new DuplicateTrackError())
  const { result } = renderHook(() => useTrackUpload())
  await act(async () => { await result.current.startUpload(file()) })
  expect(result.current.error).toBe('This file is already in your library.')
  expect(result.current.canRetry).toBe(false)
  const calls = reserve.mock.calls.length
  await act(async () => { expect(await result.current.retryUpload()).toBeNull() })
  expect(reserve).toHaveBeenCalledTimes(calls)
})
