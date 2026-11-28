-- Run after 20261128040000_nexora_push_reconciliation_rate_limits_v1.sql.
do $tests$
declare
  v_admin uuid := '123e4567-e89b-42d3-a456-426614174000';
  v_other_admin uuid;
  i integer;
  j integer;
begin
  if not coalesce((select relrowsecurity from pg_catalog.pg_class
    where oid = 'public.nexora_push_reconciliation_rate_limits'::regclass), false) then
    raise exception 'rate limit table must have RLS enabled';
  end if;
  if has_table_privilege('anon','public.nexora_push_reconciliation_rate_limits','SELECT')
     or has_table_privilege('authenticated','public.nexora_push_reconciliation_rate_limits','SELECT') then
    raise exception 'client roles must not read rate limit counters';
  end if;
  if not has_function_privilege('service_role',
    'public.nexora_check_push_reconciliation_rate_limit(uuid,text)','EXECUTE')
     or has_function_privilege('anon',
    'public.nexora_check_push_reconciliation_rate_limit(uuid,text)','EXECUTE')
     or has_function_privilege('authenticated',
    'public.nexora_check_push_reconciliation_rate_limit(uuid,text)','EXECUTE') then
    raise exception 'rate limit RPC grants are unsafe';
  end if;

  -- Per-admin list quota: 20 accepted, then denied.
  for i in 1..20 loop
    if not public.nexora_check_push_reconciliation_rate_limit(v_admin, 'list') then
      raise exception 'list request % was unexpectedly denied', i;
    end if;
  end loop;
  if public.nexora_check_push_reconciliation_rate_limit(v_admin, 'list') then
    raise exception '21st list request was not rate limited';
  end if;

  -- Per-admin reconciliation quota: 5 accepted, then denied.
  for i in 1..5 loop
    if not public.nexora_check_push_reconciliation_rate_limit(v_admin, 'reconcile') then
      raise exception 'reconciliation request % was unexpectedly denied', i;
    end if;
  end loop;
  if public.nexora_check_push_reconciliation_rate_limit(v_admin, 'reconcile') then
    raise exception '6th reconciliation request was not rate limited';
  end if;

  -- Cross-account evasion must still hit the shared global list quota (120/min).
  delete from public.nexora_push_reconciliation_rate_limits
    where action = 'list';
  for j in 1..6 loop
    v_other_admin := pg_catalog.md5('global-list-admin-' || j)::uuid;
    for i in 1..20 loop
      if not public.nexora_check_push_reconciliation_rate_limit(v_other_admin, 'list') then
        raise exception 'global list request % for admin % was unexpectedly denied', i, j;
      end if;
    end loop;
  end loop;
  if public.nexora_check_push_reconciliation_rate_limit(
    pg_catalog.md5('global-list-overflow')::uuid, 'list'
  ) then
    raise exception 'global list quota was bypassed with another admin account';
  end if;

  -- Cross-account evasion must still hit the shared global reconciliation quota (30/min).
  delete from public.nexora_push_reconciliation_rate_limits
    where action = 'reconcile';
  for j in 1..6 loop
    v_other_admin := pg_catalog.md5('global-reconcile-admin-' || j)::uuid;
    for i in 1..5 loop
      if not public.nexora_check_push_reconciliation_rate_limit(v_other_admin, 'reconcile') then
        raise exception 'global reconciliation request % for admin % was unexpectedly denied', i, j;
      end if;
    end loop;
  end loop;
  if public.nexora_check_push_reconciliation_rate_limit(
    pg_catalog.md5('global-reconcile-overflow')::uuid, 'reconcile'
  ) then
    raise exception 'global reconciliation quota was bypassed with another admin account';
  end if;

  begin
    perform public.nexora_check_push_reconciliation_rate_limit(null, 'list');
    raise exception 'null admin id must not be accepted';
  exception when sqlstate '22023' then
    null;
  end;
  begin
    perform public.nexora_check_push_reconciliation_rate_limit(v_admin, 'unexpected');
    raise exception 'unknown action must not be accepted';
  exception when sqlstate '22023' then
    null;
  end;

  delete from public.nexora_push_reconciliation_rate_limits
    where bucket_key like 'admin:%' or bucket_key = 'global';
end;
$tests$;
