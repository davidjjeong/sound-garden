-- Cleanup claims are distinct from user-requested deletion.
alter table public.tracks
  add column deletion_reason text check (deletion_reason in ('user', 'expired_upload')),
  add column cleanup_after timestamptz,
  add column cleanup_lease_until timestamptz,
  add column cleanup_claim_token uuid,
  add column cleanup_attempts integer not null default 0 check (cleanup_attempts >= 0);

-- Existing deleting rows came from the user deletion endpoint.
update public.tracks set deletion_reason = 'user' where status = 'deleting';
create index tracks_cleanup_retry on public.tracks(cleanup_after)
  where status = 'deleting' and deletion_reason = 'expired_upload';

-- Step 1: lock an owned track and mark it for deletion.
create or replace function public.begin_track_deletion(
  p_user_id uuid,
  p_track_id uuid
)
returns public.tracks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track public.tracks;
begin
  select *
  into v_track
  from public.tracks
  where id = p_track_id
    and user_id = p_user_id
  for update;

  -- Missing, already-deleted, and other users' tracks reveal no row.
  if not found then
    return null;
  end if;

  -- Pending uploads may still have valid signed upload tokens.
  if v_track.status not in ('ready', 'deleting')
     or v_track.deletion_reason = 'expired_upload' then
    raise exception using
      errcode = 'SG409',
      message = 'Only completed tracks can be deleted';
  end if;

  if v_track.status = 'ready' then
    update public.tracks
    set status = 'deleting', deletion_reason = 'user'
    where id = v_track.id
    returning * into v_track;
  end if;

  return v_track;
end;
$$;

-- Step 2: call only after the Storage API confirms the file was removed
-- or is already absent. This function itself does not inspect Storage.
create or replace function public.finish_track_deletion(
  p_user_id uuid,
  p_track_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track public.tracks;
begin
  select *
  into v_track
  from public.tracks
  where id = p_track_id
    and user_id = p_user_id
  for update;

  -- Retrying an already-completed deletion is safe.
  if not found then
    return;
  end if;

  if v_track.status <> 'deleting' or v_track.deletion_reason is distinct from 'user' then
    raise exception using
      errcode = 'SG409',
      message = 'Track is not marked for deletion';
  end if;

  delete from public.tracks
  where id = v_track.id;
end;
$$;

-- Browser roles cannot call these privileged functions directly.
revoke all on function public.begin_track_deletion(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.finish_track_deletion(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.begin_track_deletion(uuid, uuid)
  to service_role;
grant execute on function public.finish_track_deletion(uuid, uuid)
  to service_role;

-- Safety depends on reserve-upload not issuing a two-hour upload token when
-- less than 2 h 15 min remain. Also wait 15 minutes after reservation expiry.
create or replace function public.claim_expired_uploads(p_batch_size integer default 10)
returns setof public.tracks
language plpgsql security definer set search_path = ''
as $$
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 25 then
    raise exception using errcode = '22023', message = 'Batch size must be 1 to 25';
  end if;
  return query
  with candidates as (
    select t.id from public.tracks t
    where (
      t.status = 'pending'
      and t.upload_expires_at <= clock_timestamp() - interval '15 minutes'
    ) or (
      t.status = 'deleting' and t.deletion_reason = 'expired_upload'
      and t.cleanup_after <= clock_timestamp()
      and (t.cleanup_lease_until is null or t.cleanup_lease_until <= clock_timestamp())
    )
    order by coalesce(t.cleanup_after, t.upload_expires_at), t.id
    limit p_batch_size
    for update skip locked
  )
  update public.tracks t set
    status = 'deleting', deletion_reason = 'expired_upload',
    cleanup_after = clock_timestamp(),
    cleanup_lease_until = clock_timestamp() + interval '5 minutes',
    cleanup_claim_token = gen_random_uuid(),
    cleanup_attempts = t.cleanup_attempts + 1
  from candidates c where t.id = c.id
  returning t.*;
end;
$$;

-- Refresh/check ownership immediately before making a Storage request.
create or replace function public.renew_upload_cleanup(p_track_id uuid, p_claim_token uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update public.tracks set cleanup_lease_until = clock_timestamp() + interval '5 minutes'
  where id = p_track_id and cleanup_claim_token = p_claim_token
    and status = 'deleting' and deletion_reason = 'expired_upload'
    and cleanup_lease_until > clock_timestamp();
  return found;
end;
$$;

create or replace function public.finish_upload_cleanup(p_track_id uuid, p_claim_token uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.tracks where id = p_track_id
    and status = 'deleting' and deletion_reason = 'expired_upload'
    and cleanup_claim_token = p_claim_token and cleanup_lease_until > clock_timestamp();
  return found;
end;
$$;

create or replace function public.retry_upload_cleanup(p_track_id uuid, p_claim_token uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update public.tracks set
    cleanup_after = clock_timestamp() + make_interval(secs =>
      least(3600, 60 * power(2, least(cleanup_attempts - 1, 6)))::integer),
    cleanup_lease_until = null, cleanup_claim_token = null
  where id = p_track_id and status = 'deleting' and deletion_reason = 'expired_upload'
    and cleanup_claim_token = p_claim_token and cleanup_lease_until > clock_timestamp();
  return found;
end;
$$;

revoke all on function public.claim_expired_uploads(integer) from public, anon, authenticated;
revoke all on function public.renew_upload_cleanup(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_upload_cleanup(uuid, uuid) from public, anon, authenticated;
revoke all on function public.retry_upload_cleanup(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_expired_uploads(integer) to service_role;
grant execute on function public.renew_upload_cleanup(uuid, uuid) to service_role;
grant execute on function public.finish_upload_cleanup(uuid, uuid) to service_role;
grant execute on function public.retry_upload_cleanup(uuid, uuid) to service_role;
