// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

it('executes real PostgreSQL functions and deduplication constraints', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema storage;
      create table storage.objects(id uuid primary key, version text, bucket_id text, name text, metadata jsonb);
      create table public.tracks(
        id uuid primary key, user_id uuid not null, title text not null,
        storage_path text unique not null, mime_type text not null, size_bytes bigint not null,
        status text not null, upload_expires_at timestamptz, ready_at timestamptz,
        idempotency_key uuid not null, created_at timestamptz default now(),
        unique(user_id, idempotency_key)
      );
    `)
    for (const file of ['202611030002_reservation_errors.sql', '202611030003_finalize_upload.sql', '202611050002_track_deduplication.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'))
    }
    const owner = '11111111-1111-4111-8111-111111111111'
    const other = '22222222-2222-4222-8222-222222222222'
    const hash = 'a'.repeat(64)
    let key = 0
    async function reserve(user: string, name: string, claim: string | null) {
      const idempotency = `00000000-0000-4000-8000-${String(++key).padStart(12, '0')}`
      const result = await db.query<{ id: string; storage_path: string }>(
        'select * from public.reserve_track_upload($1,$2,$3,3,$4)', [user, idempotency, name, claim])
      return { ...result.rows[0], user, idempotency, name }
    }
    async function object(track: { storage_path: string }) {
      const id = crypto.randomUUID()
      await db.query(`insert into storage.objects values($1,'v1','audio',$2,'{"size":3,"mimetype":"audio/mpeg"}')`, [id, track.storage_path])
      return id
    }
    async function finalize(track: { id: string; user: string }, objectId: string, verified: string) {
      return db.query('select * from public.finalize_track_upload($1,$2,$3,$4,$5)', [track.user, track.id, objectId, 'v1', verified])
    }
    const first = await reserve(owner, 'song.mp3', hash)
    const second = await reserve(owner, 'renamed.mp3', hash)
    const firstObject = await object(first)
    const secondObject = await object(second)
    await finalize(first, firstObject, hash)
    // A second pending reservation created before the winner cannot also become ready.
    await expect(finalize(second, secondObject, hash)).rejects.toMatchObject({ code: 'SGDUP' })
    const rejected = await db.query<{ status: string; upload_expires_at: string; content_sha256: string | null }>('select status,upload_expires_at,content_sha256 from tracks where id=$1', [second.id])
    expect(rejected.rows[0].status).toBe('pending')
    expect(rejected.rows[0].upload_expires_at).not.toBeNull()
    expect(rejected.rows[0].content_sha256).toBeNull()
    await expect(reserve(owner, 'another-name.mp3', hash)).rejects.toMatchObject({ code: 'SGDUP' })
    // Retry of the successful attempt wins over the early duplicate lookup.
    const retry = await db.query<{ id: string }>('select * from public.reserve_track_upload($1,$2,$3,3,$4)', [owner, first.idempotency, first.name, hash])
    expect(retry.rows[0].id).toBe(first.id)
    await finalize(first, firstObject, hash)
    // Changing the caller hash for one attempt conflicts rather than silently reusing it.
    await expect(db.query('select * from public.reserve_track_upload($1,$2,$3,3,$4)', [owner, first.idempotency, first.name, 'b'.repeat(64)])).rejects.toMatchObject({ code: 'SG409' })
    const otherUser = await reserve(other, 'song.mp3', hash)
    await finalize(otherUser, await object(otherUser), hash)
    const changed = await reserve(owner, 'song.mp3', 'b'.repeat(64))
    await finalize(changed, await object(changed), 'b'.repeat(64))
    // Claimed hash is untrusted; verified bytes determine deduplication.
    const liar = await reserve(owner, 'liar.mp3', 'c'.repeat(64))
    await expect(finalize(liar, await object(liar), hash)).rejects.toMatchObject({ code: 'SGDUP' })
    await expect(finalize(liar, await object(liar), 'invalid')).rejects.toMatchObject({ code: '22023' })
    // The unique index remains authoritative even if a caller bypasses the function.
    await expect(db.query("update tracks set status='ready',content_sha256=$1 where id=$2", [hash, second.id])).rejects.toMatchObject({ code: '23505' })
    // Legacy ready rows can be backfilled using the same object snapshot checks.
    const legacy = await reserve(owner, 'legacy.mp3', null)
    const legacyObject = await object(legacy)
    await db.query("update tracks set status='ready',ready_at=now(),upload_expires_at=null where id=$1", [legacy.id])
    await finalize(legacy, legacyObject, 'd'.repeat(64))
    const backfilled = await db.query<{ content_sha256: string }>('select content_sha256 from tracks where id=$1', [legacy.id])
    expect(backfilled.rows[0].content_sha256).toBe('d'.repeat(64))
    const deleted = await db.query("update tracks set status='deleting' where id=$1 returning id", [first.id])
    expect(deleted.rows).toHaveLength(1)
    // The index covers ready rows; removing a track from ready releases its hash.
    await finalize(second, secondObject, hash)
  } finally { await db.close() }
}, 30000)
