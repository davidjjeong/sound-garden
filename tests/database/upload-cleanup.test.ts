// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

type Claim = { id: string; cleanup_claim_token: string; cleanup_attempts: number; deletion_reason: string; status: string }
it('executes cleanup eligibility, fencing, backoff, deletion separation, and finalization checks', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema storage;
      create table storage.objects(id uuid primary key, version text, bucket_id text, name text, metadata jsonb);
      create table tracks(id uuid primary key, user_id uuid not null, title text, storage_path text,
        mime_type text, size_bytes bigint, status text, upload_expires_at timestamptz,
        ready_at timestamptz, idempotency_key uuid, created_at timestamptz default now());
    `)
    for (const file of ['202611030002_reservation_errors.sql', '202611030003_finalize_upload.sql',
      '202611050001_delete_track.sql', '202611050002_track_deduplication.sql', '202611050003_upload_cleanup.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'))
    }
    const owner = '11111111-1111-4111-8111-111111111111'
    async function seed(status: string, minutesAgo: number | null, reason: string | null = null) {
      const id = crypto.randomUUID()
      await db.query(`insert into tracks(id,user_id,title,storage_path,mime_type,size_bytes,status,upload_expires_at,idempotency_key,deletion_reason)
        values($1,$2,'song',$3,'audio/mpeg',3,$4,case when $5::int is null then null else now()-make_interval(mins=>$5::int) end,$6,$7)`,
      [id, owner, `${owner}/${id}.mp3`, status, minutesAgo, crypto.randomUUID(), reason])
      return id
    }
    const expired = await seed('pending', 20)
    await seed('pending', 10) // still within cleanup grace
    await seed('pending', -60) // unexpired
    await seed('pending', null) // unknown expiry: do not assume safe
    const ready = await seed('ready', 90)
    await seed('deleting', 90, 'user')
    const claim = (await db.query<Claim>('select * from claim_expired_uploads(10)')).rows
    expect(claim.map(row => row.id)).toEqual([expired])
    expect(claim[0]).toMatchObject({ status: 'deleting', deletion_reason: 'expired_upload', cleanup_attempts: 1 })
    expect((await db.query('select * from claim_expired_uploads(10)')).rows).toHaveLength(0)
    const token = claim[0].cleanup_claim_token
    await expect(db.query('select * from finalize_track_upload($1,$2,$3,$4,$5)', [owner, expired, crypto.randomUUID(), 'v1', 'a'.repeat(64)])).rejects.toMatchObject({ code: 'SG409' })
    await expect(db.query('select * from begin_track_deletion($1,$2)', [owner, expired])).rejects.toMatchObject({ code: 'SG409' })
    await expect(db.query('select finish_track_deletion($1,$2)', [owner, expired])).rejects.toMatchObject({ code: 'SG409' })
    async function booleanRpc(name: string, id: string, claimToken: string) {
      const result = await db.query<{ value: boolean }>(`select ${name}($1,$2) as value`, [id, claimToken])
      return result.rows[0].value
    }
    const wrong = crypto.randomUUID()
    expect(await booleanRpc('finish_upload_cleanup', expired, wrong)).toBe(false)
    expect(await booleanRpc('retry_upload_cleanup', expired, wrong)).toBe(false)
    expect(await booleanRpc('renew_upload_cleanup', expired, token)).toBe(true)
    // Simulate a crashed worker's lease expiring, then a new worker claiming it.
    await db.query("update tracks set cleanup_lease_until=now()-interval '1 second' where id=$1", [expired])
    expect(await booleanRpc('renew_upload_cleanup', expired, token)).toBe(false)
    expect(await booleanRpc('finish_upload_cleanup', expired, token)).toBe(false)
    const reclaim = (await db.query<Claim>('select * from claim_expired_uploads(1)')).rows[0]
    expect(reclaim.cleanup_claim_token).not.toBe(token)
    expect(reclaim.cleanup_attempts).toBe(2)
    expect(await booleanRpc('finish_upload_cleanup', expired, token)).toBe(false)
    expect(await booleanRpc('retry_upload_cleanup', expired, token)).toBe(false)
    expect(await booleanRpc('retry_upload_cleanup', expired, reclaim.cleanup_claim_token)).toBe(true)
    const delayed = await db.query<{ seconds: number; cleanup_claim_token: string | null }>(
      'select extract(epoch from cleanup_after-clock_timestamp())::float as seconds,cleanup_claim_token from tracks where id=$1', [expired])
    expect(delayed.rows[0].seconds).toBeGreaterThan(115)
    expect(delayed.rows[0].seconds).toBeLessThanOrEqual(120)
    expect(delayed.rows[0].cleanup_claim_token).toBeNull()
    expect((await db.query('select * from claim_expired_uploads(10)')).rows).toHaveLength(0)
    await db.query("update tracks set cleanup_after=now()-interval '1 second',cleanup_attempts=100 where id=$1", [expired])
    const high = (await db.query<Claim>('select * from claim_expired_uploads(10)')).rows[0]
    expect(await booleanRpc('retry_upload_cleanup', expired, high.cleanup_claim_token)).toBe(true)
    const cap = await db.query<{ seconds: number }>('select extract(epoch from cleanup_after-clock_timestamp())::float as seconds from tracks where id=$1', [expired])
    expect(cap.rows[0].seconds).toBeGreaterThan(3595)
    expect(cap.rows[0].seconds).toBeLessThanOrEqual(3600)
    await db.query("update tracks set cleanup_after=now()-interval '1 second' where id=$1", [expired])
    const final = (await db.query<Claim>('select * from claim_expired_uploads(10)')).rows[0]
    expect(await booleanRpc('finish_upload_cleanup', expired, final.cleanup_claim_token)).toBe(true)
    expect(await booleanRpc('finish_upload_cleanup', expired, final.cleanup_claim_token)).toBe(false)
    expect((await db.query('select * from tracks where id=$1', [expired])).rows).toHaveLength(0)
    expect((await db.query('select * from tracks where id=$1', [ready])).rows).toHaveLength(1)
    // Existing user deletion workflow still works and records its reason.
    const userDeleted = await db.query<Claim>('select * from begin_track_deletion($1,$2)', [owner, ready])
    expect(userDeleted.rows[0].deletion_reason).toBe('user')
    await db.query('select finish_track_deletion($1,$2)', [owner, ready])
    for (const size of [0, 26, null]) await expect(db.query('select * from claim_expired_uploads($1)', [size])).rejects.toMatchObject({ code: '22023' })
    await seed('pending', 30)
    await seed('pending', 40)
    expect((await db.query('select * from claim_expired_uploads(1)')).rows).toHaveLength(1)
    expect((await db.query('select * from claim_expired_uploads(1)')).rows).toHaveLength(1)
    const privilege = await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated','public.claim_expired_uploads(integer)','execute') as allowed")
    expect(privilege.rows[0].allowed).toBe(false)
  } finally { await db.close() }
}, 30000)
