-- Keep inactive per-user social read-limit buckets from growing forever.
-- The Edge Function calls this RPC for every social snapshot request.
create index if not exists nexora_social_read_limits_updated_at_idx
  on public.nexora_social_read_limits (updated_at);

create or replace function public.nexora_check_social_read_rate_limit(p_user_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_allowed boolean := false;
  v_now timestamptz := pg_catalog.now();
begin
  if p_user_id is null or pg_catalog.length(p_user_id) < 1 or pg_catalog.length(p_user_id) > 128 then
    raise exception 'invalid_user_id' using errcode = '22023';
  end if;

  insert into public.nexora_social_read_limits(user_id, window_started_at, request_count, updated_at)
  values (p_user_id, v_now, 1, v_now)
  on conflict (user_id) do update
    set window_started_at = case
          when public.nexora_social_read_limits.window_started_at <= v_now - interval '1 minute'
            then v_now
          else public.nexora_social_read_limits.window_started_at
        end,
        request_count = case
          when public.nexora_social_read_limits.window_started_at <= v_now - interval '1 minute'
            then 1
          else public.nexora_social_read_limits.request_count + 1
        end,
        updated_at = v_now
  returning request_count <= 60 into v_allowed;

  -- Inactive identities no longer need a one-minute counter after one day.
  -- Run opportunistically to avoid introducing a cron dependency.
  if pg_catalog.random() < 0.01 then
    delete from public.nexora_social_read_limits
    where updated_at < v_now - interval '1 day';
  end if;

  return v_allowed;
end;
$function$;
