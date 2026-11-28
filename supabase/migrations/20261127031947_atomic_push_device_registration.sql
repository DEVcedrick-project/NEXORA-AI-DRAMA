-- Make FCM device ownership checks and the five-device cap atomic.
-- The caller is the authenticated push-registration Edge Function (service role only).
create or replace function public.nexora_register_push_device(
  p_token text,
  p_user_id text,
  p_app_version text,
  p_install_id text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_user_id text;
  v_existing_install_id text;
  v_device_count integer;
  v_user_lock bigint;
  v_token_lock bigint;
begin
  if p_token is null or length(p_token) < 80 or length(p_token) > 4096 or p_token ~ '\s'
     or p_user_id is null or length(p_user_id) < 1 or length(p_user_id) > 128
     or p_app_version is null or p_app_version !~ '^v?[0-9]+\.[0-9]+\.[0-9]+$'
     or p_install_id is null or p_install_id !~* '^[0-9a-f-]{36}$' then
    raise exception 'Invalid push device registration input' using errcode = '22023';
  end if;

  -- Serialize both same-account registrations and competing claims on a token.
  -- Sorting the keys gives every caller the same lock order and avoids deadlocks.
  v_user_lock := hashtextextended('nexora-push-user:' || p_user_id, 0);
  v_token_lock := hashtextextended('nexora-push-token:' || p_token, 0);
  if v_user_lock < v_token_lock then
    perform pg_advisory_xact_lock(v_user_lock);
    perform pg_advisory_xact_lock(v_token_lock);
  else
    perform pg_advisory_xact_lock(v_token_lock);
    perform pg_advisory_xact_lock(v_user_lock);
  end if;

  select user_id, install_id
    into v_existing_user_id, v_existing_install_id
    from public.nexora_push_devices
   where token = p_token
   for update;

  if found and v_existing_user_id is not null
     and v_existing_user_id <> p_user_id
     and v_existing_install_id is distinct from p_install_id then
    return 'token_conflict';
  end if;

  select count(*)::integer
    into v_device_count
    from public.nexora_push_devices
   where user_id = p_user_id;

  if (not found or v_existing_user_id is distinct from p_user_id)
     and v_device_count >= 5 then
    return 'device_limit';
  end if;

  insert into public.nexora_push_devices (
    token, user_id, platform, app_id, app_version, install_id,
    updated_at, last_seen_at
  ) values (
    p_token, p_user_id, 'android', 'com.devcedrick.nexoraaidrama',
    p_app_version, p_install_id, now(), now()
  )
  on conflict (token) do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    app_id = excluded.app_id,
    app_version = excluded.app_version,
    install_id = excluded.install_id,
    updated_at = excluded.updated_at,
    last_seen_at = excluded.last_seen_at;

  return 'registered';
end;
$$;

revoke all on function public.nexora_register_push_device(text, text, text, text) from public, anon, authenticated;
grant execute on function public.nexora_register_push_device(text, text, text, text) to service_role;
