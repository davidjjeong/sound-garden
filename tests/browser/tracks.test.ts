import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { deleteTrack, finalizeUpload, reserveUpload, uploadReservedFile } from '../../src/lib/tracks'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn(), transfer: vi.fn() }))
vi.mock('../../src/lib/supabase', () => ({
  supabase: { functions: { invoke: mocks.invoke }, storage: { from: mocks.from } },
}))
const id = '11111111-1111-4111-8111-111111111111'
const owner = '22222222-2222-4222-8222-222222222222'
const path = `${owner}/${id}.mp3`
const track = { id, title: 'Song', status: 'pending', storagePath: path,
  mimeType: 'audio/mpeg', sizeBytes: 3, expiresAt: '2099-01-01T00:00:00Z' }
const authorization = { bucket: 'audio', path, token: 'test-token' }
const file = () => new File(['abc'], 'song.mp3', { type: 'application/octet-stream' })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.from.mockReturnValue({ uploadToSignedUrl: mocks.transfer })
  mocks.transfer.mockResolvedValue({ error: null })
})

describe('browser upload API contract', () => {
  it('sends the same caller-provided idempotency key and file metadata', async () => {
    mocks.invoke.mockResolvedValue({ data: { action: 'upload', track, upload: authorization }, error: null })
    await reserveUpload(file(), 'retained-key')
    expect(mocks.invoke).toHaveBeenCalledWith('reserve-upload', {
      body: { idempotencyKey: 'retained-key', filename: 'song.mp3', sizeBytes: 3, contentHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
    })
  })
  it.each([
    { action: 'upload', track, upload: { ...authorization, path: 'wrong/path.mp3' } },
    { action: 'upload', track, upload: { ...authorization, token: '' } },
    { action: 'ready', track },
    { action: 'finalize', track: { ...track, sizeBytes: 999 } },
  ])('rejects inconsistent reservation responses %#', async (data) => {
    mocks.invoke.mockResolvedValue({ data, error: null })
    await expect(reserveUpload(file(), 'key')).rejects.toThrow()
  })
  it('normalizes MIME and uploads without overwriting; never finalizes by itself', async () => {
    await uploadReservedFile(file(), authorization)
    expect(mocks.from).toHaveBeenCalledWith('audio')
    const [destination, token, blob, options] = mocks.transfer.mock.calls[0]
    expect([destination, token]).toEqual([path, 'test-token'])
    expect(blob.size).toBe(3)
    expect(blob.type).toBe('audio/mpeg')
    expect(options).toEqual({ contentType: 'audio/mpeg', upsert: false })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it('reports uncertain transfer failure without overwriting or deleting', async () => {
    mocks.transfer.mockResolvedValue({ error: new Error('Network failure') })
    await expect(uploadReservedFile(file(), authorization)).rejects.toThrow('Retry this upload')
    expect(mocks.transfer).toHaveBeenCalledTimes(1)
  })
  it('rejects invalid signed paths before using storage', async () => {
    await expect(uploadReservedFile(file(), { ...authorization, path: '../wrong.mp3' })).rejects.toThrow()
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each([
    { action: 'ready', track },
    { action: 'ready', track: { ...track, id: owner, status: 'ready' } },
    { action: 'finalize', track: { ...track, status: 'ready' } },
  ])('rejects invalid finalization responses %#', async (data) => {
    mocks.invoke.mockResolvedValue({ data, error: null })
    await expect(finalizeUpload(id)).rejects.toThrow('expected ready track')
  })
  it('accepts only the expected ready track', async () => {
    const ready = { ...track, status: 'ready', expiresAt: null }
    mocks.invoke.mockResolvedValue({ data: { action: 'ready', track: ready }, error: null })
    await expect(finalizeUpload(id)).resolves.toEqual(ready)
    expect(mocks.invoke).toHaveBeenCalledWith('finalize-upload', { body: { trackId: id } })
  })
  it('surfaces useful endpoint errors', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(
      new Response(JSON.stringify({ error: 'Upload reservation expired' }), { status: 410 }),
    ) })
    await expect(finalizeUpload(id)).rejects.toThrow('Upload reservation expired')
  })
})

describe('additional API failure boundaries', () => {
  it.each([
    { ...authorization, bucket: 'other' },
    { ...authorization, token: '   ' },
    { ...authorization, path: `${owner}/${id}.wav` },
  ])('rejects unauthorized bucket/token/extension %#', async (auth) => {
    await expect(uploadReservedFile(file(), auth)).rejects.toThrow()
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each([new File([], 'empty.mp3'), new File(['a'], 'image.png'),
    new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'large.mp3')])('rejects invalid transfer input $name', async (invalid) => {
    await expect(uploadReservedFile(invalid, authorization)).rejects.toThrow()
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('normalizes WAV MIME types too', async () => {
    await uploadReservedFile(new File(['abc'], 'song.WAV'), { ...authorization, path: `${owner}/${id}.wav` })
    expect(mocks.transfer.mock.calls[0][2].type).toBe('audio/wav')
  })
  it('rejects malformed track IDs before invoking finalization', async () => {
    await expect(finalizeUpload('invalid')).rejects.toThrow('valid track ID')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it.each([
    null, { action: 'unknown', track },
    { action: 'finalize', track: { ...track, expiresAt: null } },
    { action: 'finalize', track: { ...track, expiresAt: 'invalid' } },
    { action: 'finalize', track: { ...track, sizeBytes: 1.5 } },
  ])('rejects malformed reservation data %#', async (data) => {
    mocks.invoke.mockResolvedValue({ data, error: null })
    await expect(reserveUpload(file(), 'key')).rejects.toThrow()
  })
  it.each(['reserve', 'finalize'])('handles non-JSON HTTP errors: %s', async (stage) => {
    mocks.invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response('Unavailable', { status: 503 })) })
    await expect(stage === 'reserve' ? reserveUpload(file(), 'key') : finalizeUpload(id)).rejects.toThrow(/Could not/)
  })
  it.each(['reserve', 'finalize'])('handles transport errors: %s', async (stage) => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('Offline') })
    await expect(stage === 'reserve' ? reserveUpload(file(), 'key') : finalizeUpload(id)).rejects.toThrow()
  })
})


describe('deleteTrack API contract', () => {
  it('validates IDs before calling the endpoint', async () => {
    await expect(deleteTrack('invalid')).rejects.toThrow('valid track ID')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it('sends only the ID and accepts a matching deletion response', async () => {
    mocks.invoke.mockResolvedValue({ data: { action: 'deleted', trackId: id }, error: null })
    await expect(deleteTrack(id)).resolves.toBe(id)
    expect(mocks.invoke).toHaveBeenCalledWith('delete-track', { body: { trackId: id } })
  })
  it.each([null, { action: 'ready', trackId: id }, { action: 'deleted', trackId: owner }])('rejects an uncertain/mismatched result %#', async (data) => {
    mocks.invoke.mockResolvedValue({ data, error: null })
    await expect(deleteTrack(id)).rejects.toThrow('Retry deletion')
  })
  it('preserves server errors', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({ error: 'Only completed tracks can be deleted' }), { status: 409 })) })
    await expect(deleteTrack(id)).rejects.toThrow('Only completed tracks')
  })
})

describe('duplicate upload responses', () => {
  it.each(['reserve', 'finalize'])('maps %s duplicate rejection to a terminal typed error', async (stage) => {
    mocks.invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({ code: 'DUPLICATE_TRACK', error: 'duplicate' }), { status: 409 })) })
    await expect(stage === 'reserve' ? reserveUpload(file(), 'key') : finalizeUpload(id)).rejects.toMatchObject({ code: 'DUPLICATE_TRACK', message: 'This file is already in your library.' })
  })
})
