-- Reapply the reservation function with stable API error codes.
create or replace function public.reserve_track_upload(
  p_user_id uuid,
  p_idempotency_key uuid,
  p_filename text,
  p_size_bytes bigint
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
    if v_track.size_bytes <> p_size_bytes
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

    return v_track;
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
    idempotency_key
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
    p_idempotency_key
  )
  returning * into v_track;

  return v_track;
end;
$$;

-- Only trusted backend code may call this function.
revoke all on function public.reserve_track_upload(
  uuid, uuid, text, bigint
) from public, anon, authenticated;

grant execute on function public.reserve_track_upload(
  uuid, uuid, text, bigint
) to service_role;
