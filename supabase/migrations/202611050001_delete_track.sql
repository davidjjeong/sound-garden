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
  if v_track.status not in ('ready', 'deleting') then
    raise exception using
      errcode = 'SG409',
      message = 'Only completed tracks can be deleted';
  end if;

  if v_track.status = 'ready' then
    update public.tracks
    set status = 'deleting'
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

  if v_track.status <> 'deleting' then
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
