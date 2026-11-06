-- OPTIONAL ACTIVATION: run only after the cleanup function is deployed/tested.
-- Enable pg_cron and pg_net in Supabase first. In Supabase Vault create:
-- sound_garden_project_url  = https://YOUR_PROJECT_REF.supabase.co
-- sound_garden_cleanup_secret = same value as Edge secret CLEANUP_JOB_SECRET
-- Store real values in Vault, not in this file or Git.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'Enable pg_cron and pg_net before activating cleanup';
  end if;
end;
$$;

create or replace function public.invoke_upload_cleanup()
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets
    where name = 'sound_garden_project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name = 'sound_garden_cleanup_secret';
  if v_url is null or v_url !~ '^https://[a-z0-9-]+\.supabase\.co/?$'
     or v_secret is null or length(v_secret) < 32 then
    raise exception 'Cleanup Vault configuration is missing or invalid';
  end if;
  select net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/cleanup-uploads',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cleanup-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 130000
  ) into v_request_id;
  return v_request_id;
end;
$$;
revoke all on function public.invoke_upload_cleanup() from public, anon, authenticated, service_role;

-- Scheduling the same name updates its definition instead of adding duplicates.
select cron.schedule(
  'sound-garden-upload-cleanup',
  '*/15 * * * *',
  'select public.invoke_upload_cleanup();'
);

-- Disable later with:
-- select cron.unschedule('sound-garden-upload-cleanup');
-- A queued request ID is NOT proof of successful cleanup. Inspect pg_net responses.
