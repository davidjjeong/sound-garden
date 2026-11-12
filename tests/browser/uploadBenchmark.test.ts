import { expect, it, vi } from 'vitest'
import { makeFixture, runBatch } from '../../scripts/lib/uploadBenchmark.mjs'
it('generates valid bounded WAV headers with consistent per-fixture hashes', () => {
  const a = makeFixture('one'), b = makeFixture('two')
  expect(a.bytes.length).toBe(16044)
  expect(a.bytes.toString('ascii', 0, 4)).toBe('RIFF')
  expect(a.bytes.toString('ascii', 8, 12)).toBe('WAVE')
  expect(a.hash).toBe(makeFixture('one').hash)
  expect(a.hash).not.toBe(b.hash)
})
it('runs independent keys through the full workflow and records duplicate outcomes without tokens', async () => {
  const keys = new Set()
  let next = 0
  const api = {
    reserve: vi.fn(async (body: { idempotencyKey: string }) => {
      keys.add(body.idempotencyKey)
      const id = String(++next)
      return { ok: true, data: { action: 'upload', track: { id, storagePath: `private/${id}.wav` }, upload: { token: 'SECRET' } } }
    }),
    upload: vi.fn(async () => ({ ok: true })),
    finalize: vi.fn(async (id: string) => id === '1' ? { ok: true, data: { action: 'ready', track: { id } } } : { ok: false, status: 409, code: 'DUPLICATE_TRACK' }),
  }
  const result = await runBatch({ count: 10, fixture: makeFixture('test'), filename: 'test.wav', api, barrier: true })
  expect(keys.size).toBe(10)
  expect(result.readyResponses).toBe(1)
  expect(result.duplicateResponses).toBe(9)
  expect(result.unexpectedResponses).toBe(0)
  expect(result.transferAttempts).toBe(10)
  expect(JSON.stringify(result)).not.toContain('SECRET')
  const lastReserve = Math.max(...api.reserve.mock.invocationCallOrder)
  expect(Math.min(...api.upload.mock.invocationCallOrder)).toBeGreaterThan(lastReserve)
})
it('does not transfer attempts rejected during reservation and does not deadlock at the barrier', async () => {
  const api = { reserve: vi.fn(async () => ({ ok: false, status: 409, code: 'DUPLICATE_TRACK' })),
    upload: vi.fn(), finalize: vi.fn() }
  const result = await runBatch({ count: 5, fixture: makeFixture('test'), filename: 'test.wav', api, barrier: true })
  expect(result.duplicateResponses).toBe(5)
  expect(result.transferAttempts).toBe(0)
  expect(api.upload).not.toHaveBeenCalled()
})
it('records unexpected reservation/network failures without leaking errors and releases the barrier', async () => {
  let i = 0
  const api = {
    reserve: vi.fn(async () => {
      if (++i === 1) throw new Error('SECRET TOKEN')
      return { ok: true, data: {} }
    }), upload: vi.fn(), finalize: vi.fn(),
  }
  const result = await runBatch({ count: 2, fixture: makeFixture('test'), filename: 'test.wav', api, barrier: true })
  expect(result.unexpectedResponses).toBe(2)
  expect(JSON.stringify(result)).not.toContain('SECRET')
})
