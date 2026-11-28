create index if not exists nexora_social_request_limits_updated_at_idx
  on public.nexora_social_request_limits(updated_at);

create or replace function public.nexora_check_social_request_rate_limit(p_user_id text,p_network_hash text,p_action text)
returns boolean language plpgsql security definer set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_user_limit integer;
  v_network_limit integer;
  v_user_count integer;
  v_network_count integer;
begin
  if p_user_id is null or pg_catalog.length(p_user_id) < 1 or pg_catalog.length(p_user_id) > 128
     or p_network_hash is null or p_network_hash !~ '^[0-9a-f]{64}$'
     or p_action is null or p_action not in ('read', 'like', 'save', 'comment') then
    raise exception 'invalid_social_rate_limit_input' using errcode = '22023';
  end if;
  v_user_limit := case p_action when 'read' then 60 when 'comment' then 5 else 30 end;
  v_network_limit := case p_action when 'read' then 300 when 'comment' then 25 else 120 end;
  insert into public.nexora_social_request_limits(bucket_key,action,window_started_at,request_count,updated_at)
  values ('user:' || p_user_id,p_action,v_now,1,v_now)
  on conflict (bucket_key,action) do update
    set window_started_at = case when public.nexora_social_request_limits.window_started_at <= v_now - interval '1 minute' then v_now else public.nexora_social_request_limits.window_started_at end,
        request_count = case when public.nexora_social_request_limits.window_started_at <= v_now - interval '1 minute' then 1 else public.nexora_social_request_limits.request_count + 1 end,
        updated_at = v_now
  returning request_count into v_user_count;
  insert into public.nexora_social_request_limits(bucket_key,action,window_started_at,request_count,updated_at)
  values ('network:' || p_network_hash,p_action,v_now,1,v_now)
  on conflict (bucket_key,action) do update
    set window_started_at = case when public.nexora_social_request_limits.window_started_at <= v_now - interval '1 minute' then v_now else public.nexora_social_request_limits.window_started_at end,
        request_count = case when public.nexora_social_request_limits.window_started_at <= v_now - interval '1 minute' then 1 else public.nexora_social_request_limits.request_count + 1 end,
        updated_at = v_now
  returning request_count into v_network_count;
  if pg_catalog.random() < 0.01 then
    delete from public.nexora_social_request_limits where updated_at < v_now - interval '1 day';
  end if;
  return v_user_count <= v_user_limit and v_network_count <= v_network_limit;
end;
$function$;
revoke all on function public.nexora_check_social_request_rate_limit(text,text,text) from public,anon,authenticated;
grant execute on function public.nexora_check_social_request_rate_limit(text,text,text) to service_role;