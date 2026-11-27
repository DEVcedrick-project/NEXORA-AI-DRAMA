create or replace function public.nexora_register_push_device(
  p_token text,
  p_user_id text,
  p_app_version text,
  p_install_id text
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_existing_user_id text;
  v_device_count integer;
  v_user_lock bigint;
  v_token_lock bigint;
begin
  if p_token is null
     or pg_catalog.length(p_token) < 80
     or pg_catalog.length(p_token) > 4096
     or p_token !~ '^[A-Za-z0-9:_-]+$'
     or p_user_id is null
     or pg_catalog.length(p_user_id) < 1
     or pg_catalog.length(p_user_id) > 128
     or p_app_version is null
     or p_app_version !~ '^v?[0-9]{1,6}[.][0-9]{1,6}[.][0-9]{1,6}$'
     or p_install_id is null
     or p_install_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Invalid push device registration input' using errcode = '22023';
  end if;

  v_user_lock := pg_catalog.hashtextextended('nexora-push-user:' || p_user_id, 0);
  v_token_lock := pg_catalog.hashtextextended('nexora-push-token:' || p_token, 0);

  if v_user_lock < v_token_lock then
    perform pg_catalog.pg_advisory_xact_lock(v_user_lock);
    perform pg_catalog.pg_advisory_xact_lock(v_token_lock);
  else
    perform pg_catalog.pg_advisory_xact_lock(v_token_lock);
    perform pg_catalog.pg_advisory_xact_lock(v_user_lock);
  end if;

  select user_id into v_existing_user_id
    from public.nexora_push_devices where token = p_token for update;

  -- Installation IDs are not proof of account ownership; never transfer tokens implicitly.
  if found and v_existing_user_id is distinct from p_user_id then
    return 'token_conflict';
  end if;

  -- Retire dormant devices before enforcing the per-account cap.
  delete from public.nexora_push_devices
   where user_id = p_user_id
     and last_seen_at < pg_catalog.now() - interval '180 days'
     and token <> p_token;

  select pg_catalog.count(*)::integer into v_device_count
    from public.nexora_push_devices where user_id = p_user_id;

  if v_existing_user_id is distinct from p_user_id and v_device_count >= 5 then
    return 'device_limit';
  end if;

  insert into public.nexora_push_devices (
    token, user_id, platform, app_id, app_version, install_id, updated_at, last_seen_at
  ) values (
    p_token, p_user_id, 'android', 'com.devcedrick.nexoraaidrama',
    p_app_version, p_install_id, pg_catalog.now(), pg_catalog.now()
  )
  on conflict (token) do update set
    app_version = excluded.app_version,
    install_id = excluded.install_id,
    updated_at = excluded.updated_at,
    last_seen_at = excluded.last_seen_at
  where public.nexora_push_devices.user_id = excluded.user_id;

  return 'registered';
end;
$function$;
