-- Existing tracks remain unhashed until the explicit backend backfill runs.
alter table public.tracks
  add column content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  add column claimed_sha256 text check (claimed_sha256 ~ '^[0-9a-f]{64}$');

-- Only hashes computed by trusted backend code enter this column.
create unique index tracks_owner_ready_content_unique
  on public.tracks(user_id, content_sha256)
  where status = 'ready' and content_sha256 is not null;

-- Replace signatures: leave no legacy finalization route that omits verification.
drop function public.reserve_track_upload(uuid, uuid, text, bigint);
drop function public.finalize_track_upload(uuid, uuid, uuid, text);

create or replace function public.reserve_track_upload(
  p_user_id uuid,
  p_idempotency_key uuid,
  p_filename text,
  p_size_bytes bigint,
  p_content_hash text default null
)
returns public.tracks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track public.tracks;
  v_extension text;
  v_title text;
  v_reserved_bytes bigint;
  v_track_id uuid := gen_random_uuid();
begin
  if p_user_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'User and idempotency key are required';
  end if;

  if p_filename is null
     or length(p_filename) > 255
     or p_filename !~* '\.(mp3|wav)$' then
    raise exception using errcode = '22023', message = 'Choose an MP3 or WAV file';
  end if;

  if p_size_bytes is null
     or p_size_bytes <= 0
     or p_size_bytes > 20971520 then
    raise exception using errcode = '22023', message = 'File must be between 1 byte and 20 MiB';
  end if;

  if p_content_hash is not null and p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid content hash';
  end if;

  v_extension := lower(substring(p_filename from '\.([^.]+)$'));
  v_title := coalesce(
    nullif(trim(regexp_replace(p_filename, '\.[^.]+$', '')), ''),
    'Untitled'
  );

  -- Serialize reservations for this user until the transaction ends.
  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text, 0)
  );

  select * into v_track
  from public.tracks
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key;

  if found then
    if (p_content_hash is not null and v_track.claimed_sha256 is not null
        and p_content_hash <> v_track.claimed_sha256)
       or v_track.size_bytes <> p_size_bytes
       or v_track.title <> v_title
       or v_track.mime_type <> (
          case when v_extension = 'mp3'
            then 'audio/mpeg' else 'audio/wav' end
       ) then
      raise exception using errcode = 'SG409', message = 'This upload key belongs to a different request';
    end if;

    if v_track.status = 'deleting' then
      raise exception using errcode = 'SG409', message = 'This upload is being deleted';
    end if;

    if v_track.status = 'pending'
       and (
         v_track.upload_expires_at is null
         or v_track.upload_expires_at <= now()
       ) then
      raise exception using errcode = 'SG410', message = 'This upload reservation has expired';
    end if;

    if v_track.status = 'ready' then return v_track; end if;
    if p_content_hash is not null and exists (
      select 1 from public.tracks where user_id = p_user_id
        and status = 'ready' and content_sha256 = p_content_hash
        and id <> v_track.id
    ) then
      raise exception using errcode = 'SGDUP', message = 'This file is already in your library.';
    end if;
    return v_track;
  end if;

  if p_content_hash is not null and exists (
    select 1 from public.tracks where user_id = p_user_id
      and status = 'ready' and content_sha256 = p_content_hash
  ) then
    raise exception using errcode = 'SGDUP', message = 'This file is already in your library.';
  end if;

  -- Count all records, including abandoned uploads until cleaned up.
  select coalesce(sum(size_bytes), 0)
  into v_reserved_bytes
  from public.tracks
  where user_id = p_user_id;

  -- Initial application quota: 100 MiB per user.
  if v_reserved_bytes + p_size_bytes > 104857600 then
    raise exception using errcode = 'SG413', message = 'Your music library storage limit has been reached';
  end if;

  insert into public.tracks (
    id,
    user_id,
    title,
    storage_path,
    mime_type,
    size_bytes,
    status,
    upload_expires_at,
    idempotency_key,
    claimed_sha256
  )
  values (
    v_track_id,
    p_user_id,
    v_title,
    p_user_id::text || '/' || v_track_id::text || '.' || v_extension,
    case when v_extension = 'mp3'
      then 'audio/mpeg' else 'audio/wav' end,
    p_size_bytes,
    'pending',
    now() + interval '4 hours',
    p_idempotency_key,
    p_content_hash
  )
  returning * into v_track;

  return v_track;
end;
$$;

-- Only trusted backend code may call this function.
revoke all on function public.reserve_track_upload(
  uuid, uuid, text, bigint, text
) from public, anon, authenticated;

grant execute on function public.reserve_track_upload(
  uuid, uuid, text, bigint, text
) to service_role;

create or replace function public.finalize_track_upload(
  p_user_id uuid,
  p_track_id uuid,
  p_object_id uuid,
  p_object_version text,
  p_content_hash text
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
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Verified SHA-256 is required';
  end if;
  select * into v_track from public.tracks
  where id = p_track_id and user_id = p_user_id
  for update;
  if not found then
    raise exception using errcode = 'SG404', message = 'Track not found';
  end if;
  -- A retry after a successful commit needs no second state transition.
  if v_track.status = 'ready' and v_track.content_sha256 is not null then return v_track; end if;
  if v_track.status not in ('pending', 'ready') then
    raise exception using errcode = 'SG409', message = 'Track cannot be finalized';
  end if;
  if v_track.status = 'pending' and (v_track.upload_expires_at is null or v_track.upload_expires_at <= clock_timestamp()) then
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

  begin
  update public.tracks set content_sha256 = p_content_hash, status = 'ready', ready_at = coalesce(ready_at, clock_timestamp()),
    upload_expires_at = null
  where id = v_track.id returning * into v_track;
  exception when unique_violation then
    raise exception using errcode = 'SGDUP', message = 'This file is already in your library.';
  end;
  return v_track;
end;
$$;
revoke all on function public.finalize_track_upload(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.finalize_track_upload(uuid, uuid, uuid, text, text)
  to service_role;
