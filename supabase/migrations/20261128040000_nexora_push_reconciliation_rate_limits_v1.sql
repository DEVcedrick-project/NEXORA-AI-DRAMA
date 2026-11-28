-- Distributed fixed-window limits for the authenticated push-reconciliation operator API.
create table if not exists public.nexora_push_reconciliation_rate_limits (
  bucket_key text not null,
  action text not null check (action in ('list', 'reconcile')),
  window_started_at timestamptz not null default pg_catalog.now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (bucket_key, action),
  check (pg_catalog.length(bucket_key) between 3 and 64)
);
alter table public.nexora_push_reconciliation_rate_limits enable row level security;
revoke all on table public.nexora_push_reconciliation_rate_limits from public, anon, authenticated;
grant all on table public.nexora_push_reconciliation_rate_limits to service_role;
create index if not exists nexora_push_reconciliation_rate_limits_updated_idx
  on public.nexora_push_reconciliation_rate_limits(updated_at);

create or replace function public.nexora_check_push_reconciliation_rate_limit(
  p_admin_id uuid, p_action text
) returns boolean
language plpgsql security invoker set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_admin_limit integer;
  v_global_limit integer;
  v_admin_count integer;
  v_global_count integer;
begin
  if p_admin_id is null or p_action is null or p_action not in ('list', 'reconcile') then
    raise exception 'invalid_push_reconciliation_rate_limit_input' using errcode = '22023';
  end if;

  v_admin_limit := case p_action when 'list' then 20 else 5 end;
  v_global_limit := case p_action when 'list' then 120 else 30 end;

  insert into public.nexora_push_reconciliation_rate_limits
    (bucket_key, action, window_started_at, request_count, updated_at)
  values ('admin:' || p_admin_id::text, p_action, v_now, 1, v_now)
  on conflict (bucket_key, action) do update
    set window_started_at = case
          when public.nexora_push_reconciliation_rate_limits.window_started_at <= v_now - interval '1 minute'
          then v_now else public.nexora_push_reconciliation_rate_limits.window_started_at end,
        request_count = case
          when public.nexora_push_reconciliation_rate_limits.window_started_at <= v_now - interval '1 minute'
          then 1 else public.nexora_push_reconciliation_rate_limits.request_count + 1 end,
        updated_at = v_now
  returning request_count into v_admin_count;

  insert into public.nexora_push_reconciliation_rate_limits
    (bucket_key, action, window_started_at, request_count, updated_at)
  values ('global', p_action, v_now, 1, v_now)
  on conflict (bucket_key, action) do update
    set window_started_at = case
          when public.nexora_push_reconciliation_rate_limits.window_started_at <= v_now - interval '1 minute'
          then v_now else public.nexora_push_reconciliation_rate_limits.window_started_at end,
        request_count = case
          when public.nexora_push_reconciliation_rate_limits.window_started_at <= v_now - interval '1 minute'
          then 1 else public.nexora_push_reconciliation_rate_limits.request_count + 1 end,
        updated_at = v_now
  returning request_count into v_global_count;

  if pg_catalog.random() < 0.01 then
    delete from public.nexora_push_reconciliation_rate_limits
    where updated_at < v_now - interval '1 day';
  end if;
  return v_admin_count <= v_admin_limit and v_global_count <= v_global_limit;
end;
$function$;

revoke all on function public.nexora_check_push_reconciliation_rate_limit(uuid, text)
  from public, anon, authenticated;
grant execute on function public.nexora_check_push_reconciliation_rate_limit(uuid, text)
  to service_role;
