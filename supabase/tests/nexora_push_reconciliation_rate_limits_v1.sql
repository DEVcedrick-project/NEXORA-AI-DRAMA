-- Run after 20261128040000_nexora_push_reconciliation_rate_limits_v1.sql.
do $tests$
declare
  v_admin uuid := '123e4567-e89b-42d3-a456-426614174000';
  i integer;
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

  for i in 1..20 loop
    if not public.nexora_check_push_reconciliation_rate_limit(v_admin, 'list') then
      raise exception 'list request % was unexpectedly denied', i;
    end if;
  end loop;
  if public.nexora_check_push_reconciliation_rate_limit(v_admin, 'list') then
    raise exception '21st list request was not rate limited';
  end if;

  for i in 1..5 loop
    if not public.nexora_check_push_reconciliation_rate_limit(v_admin, 'reconcile') then
      raise exception 'reconciliation request % was unexpectedly denied', i;
    end if;
  end loop;
  if public.nexora_check_push_reconciliation_rate_limit(v_admin, 'reconcile') then
    raise exception '6th reconciliation request was not rate limited';
  end if;

  if public.nexora_check_push_reconciliation_rate_limit(null, 'list') then
    raise exception 'null admin id must not be accepted';
  end if;
  delete from public.nexora_push_reconciliation_rate_limits
    where bucket_key in ('admin:' || v_admin::text, 'global');
end;
$tests$;
