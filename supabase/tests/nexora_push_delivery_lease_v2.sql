-- Run against a disposable Supabase project after applying
-- 20261128010000_nexora_push_delivery_lease_v2.sql.
-- Assertions intentionally avoid touching production data.

do $tests$
declare
  v record;
  fn record;
  def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'nexora_push_events'
      and column_name = 'lease_expires_at'
  ) then
    raise exception 'missing nexora_push_events.lease_expires_at';
  end if;

  foreach v in array array[
    row('nexora_push_deliveries','next_attempt_at')::record,
    row('nexora_push_deliveries','last_error_code')::record
  ] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = v.f1 and column_name = v.f2
    ) then
      raise exception 'missing %.%', v.f1, v.f2;
    end if;
  end loop;

  foreach fn in array array[
    row('nexora_claim_push_event_v2','text, text, integer')::record,
    row('nexora_renew_push_event_v2','text, text, integer')::record,
    row('nexora_complete_push_event_v2','text, text')::record,
    row('nexora_release_push_event_v2','text, text')::record
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = fn.f1
        and pg_catalog.pg_get_function_identity_arguments(p.oid) = fn.f2
    ) then
      raise exception 'missing RPC public.%(%)', fn.f1, fn.f2;
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
    'service_role', 'public.nexora_claim_push_event_v2(text,text,integer)', 'EXECUTE'
  ) then raise exception 'service_role cannot execute claim v2'; end if;
  if pg_catalog.has_function_privilege(
    'anon', 'public.nexora_claim_push_event_v2(text,text,integer)', 'EXECUTE'
  ) then raise exception 'anon can execute claim v2'; end if;
  if pg_catalog.has_function_privilege(
    'authenticated', 'public.nexora_claim_push_event_v2(text,text,integer)', 'EXECUTE'
  ) then raise exception 'authenticated can execute claim v2'; end if;

  select p.prosecdef, p.proconfig,
         pg_catalog.pg_get_functiondef(p.oid) as definition
  into fn
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nexora_complete_push_event_v2';

  if fn.prosecdef then raise exception 'complete v2 must remain SECURITY INVOKER'; end if;
  if not (fn.proconfig @> array['search_path=""']) then
    raise exception 'complete v2 must pin an empty search_path';
  end if;
  if position('NOT EXISTS' in upper(fn.definition)) = 0
     or position('PENDING' in upper(fn.definition)) = 0
     or position('SENDING' in upper(fn.definition)) = 0 then
    raise exception 'complete v2 must block while pending/sending deliveries remain';
  end if;

  select pg_catalog.pg_get_functiondef(p.oid) into def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nexora_claim_push_event_v2';
  if position('LEASE_EXPIRES_AT' in upper(def)) = 0
     or position('CLAIM_TOKEN IS NOT NULL' in upper(def)) = 0 then
    raise exception 'claim v2 must require an expired, non-null existing claim';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'nexora_push_deliveries_pending_due_v2_idx'
  ) then raise exception 'missing pending due index'; end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'nexora_push_deliveries_sending_age_v2_idx'
  ) then raise exception 'missing sending age index'; end if;
end;
$tests$;
