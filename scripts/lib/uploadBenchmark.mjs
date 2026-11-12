import { createHash, randomUUID } from 'node:crypto'

/** One second of valid mono PCM, with a run-specific seed so batches never collide. */
export function makeFixture(seed) {
  const rate = 8000
  const bytes = Buffer.alloc(44 + rate * 2)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(rate * 2, 40)
  const fingerprint = createHash('sha256').update(seed).digest()
  for (let i = 0; i < rate; i++) {
    const sample = Math.sin(i / rate * Math.PI * 2 * (180 + fingerprint[0])) * 3000
    bytes.writeInt16LE(Math.round(sample) + fingerprint[i % fingerprint.length] - 128, 44 + i * 2)
  }
  return { bytes, hash: createHash('sha256').update(bytes).digest('hex') }
}

export async function runBatch({ count, fixture, filename, api, barrier = false }) {
  const start = performance.now()
  const reservations = []
  let release
  const gate = barrier ? new Promise(resolve => { release = resolve }) : Promise.resolve()
  let reserved = 0
  const attempts = await Promise.all(Array.from({ length: count }, async (_, index) => {
    const idempotencyKey = randomUUID()
    const attempt = { attempt: index + 1, idempotencyKey, stage: 'reserve', outcome: 'unexpected', transferStarted: false }
    let reservationFinished = false
    const finishReservation = () => {
      if (reservationFinished) return
      reservationFinished = true
      reserved++
      if (barrier && reserved === count) release()
    }
    try {
      const result = await api.reserve({ idempotencyKey, filename, sizeBytes: fixture.bytes.length, contentHash: fixture.hash })
      // Always release a phase barrier, including rejected reservations.
      finishReservation()
      if (!result.ok) return { ...attempt, outcome: result.code === 'DUPLICATE_TRACK' ? 'duplicate' : 'unexpected', status: result.status, code: result.code }
      const response = result.data
      if (!response?.track?.id || !['ready', 'upload', 'finalize'].includes(response.action)) throw new Error('Invalid reservation')
      attempt.trackId = response.track.id
      reservations.push({ id: response.track.id, path: response.track.storagePath })
      await gate
      if (response.action === 'ready') return { ...attempt, outcome: 'ready', durationMs: performance.now() - start }
      if (response.action === 'upload') {
        attempt.stage = 'transfer'
        attempt.transferStarted = true
        const uploaded = await api.upload(response.upload, fixture.bytes)
        if (!uploaded.ok) return { ...attempt, outcome: 'unexpected', status: uploaded.status, code: 'TRANSFER_FAILED' }
      }
      attempt.stage = 'finalize'
      const finalized = await api.finalize(response.track.id)
      return { ...attempt, outcome: finalized.ok && finalized.data?.action === 'ready' && finalized.data?.track?.id === response.track.id
        ? 'ready' : finalized.code === 'DUPLICATE_TRACK' ? 'duplicate' : 'unexpected',
        status: finalized.status, code: finalized.code, durationMs: performance.now() - start }
    } catch {
      // Do not persist SDK errors, response bodies, bearer URLs, or tokens.
      finishReservation()
      return { ...attempt, outcome: 'unexpected', code: 'REQUEST_OR_CONTRACT_FAILURE', durationMs: performance.now() - start }
    }
  }))
  return { concurrency: count, mode: barrier ? 'reservation-barrier' : 'full-workflow',
    fixture: { filename, bytes: fixture.bytes.length, sha256: fixture.hash }, attempts,
    transferAttempts: attempts.filter(a => a.transferStarted).length,
    readyResponses: attempts.filter(a => a.outcome === 'ready').length,
    duplicateResponses: attempts.filter(a => a.outcome === 'duplicate').length,
    unexpectedResponses: attempts.filter(a => a.outcome === 'unexpected').length,
    durationMs: performance.now() - start, reservations }
}
