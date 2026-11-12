import { createClient, FunctionsHttpError } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { makeFixture, runBatch } from './lib/uploadBenchmark.mjs'

// Credentials are read locally; never written to output or supplied on the CLI.
process.loadEnvFile('.env.local')
process.loadEnvFile('.env.benchmark.local')
const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const email = process.env.BENCHMARK_EMAIL
const password = process.env.BENCHMARK_PASSWORD
if (!url || !key || !email || !password) throw new Error('Missing local benchmark configuration; see metrics/concurrent-uploads/README.md')
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, options) => fetch(input, { ...options, signal: AbortSignal.timeout(45000) }) } })
const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password })
if (authError || !auth.user) throw new Error('Could not sign in to the dedicated test account (credentials omitted).')
const owner = auth.user.id
async function invoke(name, body) {
  const { data, error } = await client.functions.invoke(name, { body })
  if (!error) return { ok: true, status: 200, data }
  const status = error instanceof FunctionsHttpError ? error.context.status : null
  const payload = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
  return { ok: false, status, code: payload?.code === 'DUPLICATE_TRACK' ? 'DUPLICATE_TRACK' : 'ENDPOINT_ERROR' }
}
const api = {
  reserve: body => invoke('reserve-upload', body),
  finalize: trackId => invoke('finalize-upload', { trackId }),
  async upload(upload, bytes) {
    if (upload?.bucket !== 'audio' || !upload.path?.startsWith(`${owner}/`) || !upload.token) return { ok: false }
    const { error } = await client.storage.from('audio').uploadToSignedUrl(upload.path, upload.token,
      new Blob([bytes], { type: 'audio/wav' }), { contentType: 'audio/wav', upsert: false })
    return { ok: !error }
  },
}
async function verify(batch) {
  const hash = batch.fixture.sha256
  const { data: rows, error } = await client.from('tracks')
    .select('id,status,content_sha256,claimed_sha256,storage_path,upload_expires_at')
    .eq('user_id', owner).or(`claimed_sha256.eq.${hash},content_sha256.eq.${hash}`)
  if (error) return { verified: false, code: 'DATABASE_VERIFICATION_FAILED' }
  const objects = []
  const targets = new Map(rows.map(row => [row.id, row.storage_path]))
  for (const object of batch.verification?.objects ?? []) targets.set(object.trackId, `${owner}/${object.trackId}.wav`)
  for (const r of batch.reservations ?? []) targets.set(r.id, r.path)
  for (const [trackId, path] of targets) {
    if (!path?.startsWith(`${owner}/`)) { objects.push({ trackId, state: 'invalid-path' }); continue }
    const { data, error } = await client.storage.from('audio').download(path)
    if (error || !data) {
      objects.push({ trackId, state: String(error?.status ?? error?.statusCode) === '404' ? 'absent' : 'unverified' })
    } else {
      const bytes = Buffer.from(await data.arrayBuffer())
      objects.push({ trackId, state: 'present', bytes: bytes.length,
        sha256Matches: createHash('sha256').update(bytes).digest('hex') === hash })
    }
  }
  const ready = rows.filter(row => row.status === 'ready')
  const readyObject = ready.length === 1 ? objects.find(object => object.trackId === ready[0].id) : undefined
  return { verified: true, checkedAt: new Date().toISOString(),
    readyRows: ready.length, pendingRows: rows.filter(row => row.status === 'pending').length,
    otherRows: rows.filter(row => !['ready', 'pending'].includes(row.status)).length,
    readyHashMatches: ready.length === 1 && ready[0].content_sha256 === hash,
    readyObjectVerified: readyObject?.state === 'present' && readyObject.sha256Matches === true,
    rows: rows.map(row => ({ id: row.id, status: row.status, expiresAt: row.upload_expires_at })), objects,
    cleanup: rows.some(row => row.status === 'pending') ? 'deferred-until-expiry-and-grace' : 'no-pending-rows' }
}
const directory = 'metrics/concurrent-uploads'
await mkdir(directory, { recursive: true })
const recheck = process.argv.indexOf('--recheck')
if (recheck !== -1) {
  const report = JSON.parse(await readFile(process.argv[recheck + 1], 'utf8'))
  const checks = []
  for (const batch of report.batches) checks.push({ fixture: batch.fixture, verification: await verify(batch) })
  const file = `${directory}/recheck-${Date.now()}.json`
  await writeFile(file, JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2))
  console.log(`Saved cleanup recheck: ${file}`)
} else if (process.argv.includes('--run')) {
  const runId = randomUUID()
  const report = { schemaVersion: 1, runId, startedAt: new Date().toISOString(),
    fixtureType: 'generated 1-second mono 8000 Hz PCM WAV',
    authentication: 'dedicated authenticated user; no service-role key', batches: [] }
  const file = `${directory}/run-${runId}.json`
  for (const spec of [{ count: 2 }, { count: 5 }, { count: 10 }, { count: 10, barrier: true }]) {
    const seed = `${runId}-${report.batches.length}`
    const fixture = makeFixture(seed)
    const filename = `benchmark-${seed}.wav`
    const batch = await runBatch({ ...spec, fixture, filename, api })
    batch.verification = await verify(batch)
    // The owner path is needed only in memory. IDs let a recheck retrieve it via RLS.
    delete batch.reservations
    batch.passed = batch.unexpectedResponses === 0 && batch.readyResponses === 1 &&
      batch.duplicateResponses === spec.count - 1 && batch.verification.verified &&
      batch.verification.readyRows === 1 && batch.verification.readyHashMatches && batch.verification.readyObjectVerified
    report.batches.push(batch)
    await writeFile(file, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ concurrency: spec.count, mode: batch.mode, passed: batch.passed,
      ready: batch.readyResponses, duplicates: batch.duplicateResponses, unexpected: batch.unexpectedResponses,
      readyRows: batch.verification.readyRows, pendingRows: batch.verification.pendingRows,
      transfers: batch.transferAttempts }))
    if (!batch.passed) { console.log('Stopped after a failed batch; evidence retained.'); break }
  }
  report.finishedAt = new Date().toISOString()
  await writeFile(file, JSON.stringify(report, null, 2))
  console.log(`Saved benchmark evidence: ${file}`)
} else {
  console.log('Use --run for bounded live uploads or --recheck metrics/concurrent-uploads/run-….json for read-only cleanup verification.')
}
await client.auth.signOut({ scope: 'local' })
