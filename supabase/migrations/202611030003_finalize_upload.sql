-- Browser writes now go through the reservation/finalization backend.
-- Existing SELECT policies remain in effect.
revoke insert, update, delete on public.tracks from public, anon, authenticated;

-- Restrictive policies also constrain any existing permissive upload policies.
-- Signed upload tokens and service_role requests use the trusted Storage API.
create policy audio_backend_insert_only on storage.objects
  as restrictive for insert to anon, authenticated
  with check (bucket_id <> 'audio');
create policy audio_backend_update_only on storage.objects
  as restrictive for update to anon, authenticated
  using (bucket_id <> 'audio') with check (bucket_id <> 'audio');
create policy audio_backend_delete_only on storage.objects
  as restrictive for delete to anon, authenticated
  using (bucket_id <> 'audio');

create or replace function public.finalize_track_upload(
  p_user_id uuid,
  p_track_id uuid,
  p_object_id uuid,
  p_object_version text
)
returns public.tracks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track public.tracks;
  v_object storage.objects;
begin
  select * into v_track from public.tracks
  where id = p_track_id and user_id = p_user_id
  for update;
  if not found then
    raise exception using errcode = 'SG404', message = 'Track not found';
  end if;
  -- A retry after a successful commit needs no second state transition.
  if v_track.status = 'ready' then return v_track; end if;
  if v_track.status <> 'pending' then
    raise exception using errcode = 'SG409', message = 'Track cannot be finalized';
  end if;
  if v_track.upload_expires_at is null or v_track.upload_expires_at <= clock_timestamp() then
    raise exception using errcode = 'SG410', message = 'Upload reservation expired';
  end if;

  -- Hold the metadata row stable through the commit. Never modify Storage rows.
  select * into v_object from storage.objects
  where bucket_id = 'audio' and name = v_track.storage_path
  for share;
  if not found or p_object_id is null or p_object_version is null
     or v_object.id is distinct from p_object_id
     or v_object.version is distinct from p_object_version then
    raise exception using errcode = 'SG409', message = 'Uploaded object changed; retry verification';
  end if;
  if (v_object.metadata->>'size')::bigint is distinct from v_track.size_bytes
     or (v_object.metadata->>'mimetype') is distinct from v_track.mime_type then
    raise exception using errcode = 'SG422', message = 'Uploaded object does not match reservation';
  end if;

  update public.tracks set status = 'ready', ready_at = clock_timestamp(),
    upload_expires_at = null
  where id = v_track.id returning * into v_track;
  return v_track;
end;
$$;
revoke all on function public.finalize_track_upload(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.finalize_track_upload(uuid, uuid, uuid, text)
  to service_role;
