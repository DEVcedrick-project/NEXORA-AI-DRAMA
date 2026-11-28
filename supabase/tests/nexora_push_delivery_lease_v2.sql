-- Run against a disposable Supabase project after applying
-- 20261128010000_nexora_push_delivery_lease_v2.sql.
-- Assertions intentionally avoid touching production data.

do $tests$
declare
  fn record;
  def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'nexora_push_events'
      and column_name = 'lease_expires_at'
  ) then raise exception 'missing nexora_push_events.lease_expires_at'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'nexora_push_deliveries'
      and column_name = 'next_attempt_at'
  ) then raise exception 'missing nexora_push_deliveries.next_attempt_at'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'nexora_push_deliveries'
      and column_name = 'last_error_code'
  ) then raise exception 'missing nexora_push_deliveries.last_error_code'; end if;

  if not exists (
    select 1 from public.nexora_push_deliveries
    where event_key = 'legacy-stale-event'
      and token = 'legacy-stale-token'
      and status = 'unknown'
      and last_error_code = 'LEGACY_SENDING_OUTCOME_UNKNOWN'
  ) then raise exception 'stale legacy sending row was not quarantined as unknown'; end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.nexora_push_deliveries'::regclass
      and conname = 'nexora_push_deliveries_status_check'
      and pg_catalog.pg_get_constraintdef(oid) like '%sending%'
      and pg_catalog.pg_get_constraintdef(oid) like '%failed%'
      and pg_catalog.pg_get_constraintdef(oid) like '%unknown%'
  ) then raise exception 'delivery status check must permit sending and failed'; end if;

  if not coalesce((select relrowsecurity from pg_catalog.pg_class
    where oid = 'public.nexora_push_events'::regclass), false)
     or not coalesce((select relrowsecurity from pg_catalog.pg_class
    where oid = 'public.nexora_push_deliveries'::regclass), false) then
    raise exception 'push event and delivery tables must have RLS enabled';
  end if;
  if not has_table_privilege('service_role','public.nexora_push_events','SELECT,INSERT,UPDATE,DELETE')
     or not has_table_privilege('service_role','public.nexora_push_deliveries','SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'service_role is missing backing-table privileges';
  end if;
  if has_table_privilege('anon','public.nexora_push_events','SELECT')
     or has_table_privilege('authenticated','public.nexora_push_events','SELECT')
     or has_table_privilege('anon','public.nexora_push_deliveries','SELECT')
     or has_table_privilege('authenticated','public.nexora_push_deliveries','SELECT') then
    raise exception 'client roles have direct read access to push state';
  end if;

  if to_regprocedure('public.nexora_claim_push_event_v2(text,text,integer)') is null
     or to_regprocedure('public.nexora_renew_push_event_v2(text,text,integer)') is null
     or to_regprocedure('public.nexora_complete_push_event_v2(text,text)') is null
     or to_regprocedure('public.nexora_release_push_event_v2(text,text)') is null then
    raise exception 'one or more v2 lease RPCs are missing';
  end if;

  if not has_function_privilege(
    'service_role', 'public.nexora_claim_push_event_v2(text,text,integer)', 'EXECUTE'
  ) then raise exception 'service_role cannot execute claim v2'; end if;
  if has_function_privilege(
    'anon', 'public.nexora_claim_push_event_v2(text,text,integer)', 'EXECUTE'
  ) then raise exception 'anon can execute claim v2'; end if;
  if has_function_privilege(
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
  if not has_function_privilege('service_role','public.nexora_renew_push_event_v2(text,text,integer)','EXECUTE')
     or not has_function_privilege('service_role','public.nexora_complete_push_event_v2(text,text)','EXECUTE')
     or not has_function_privilege('service_role','public.nexora_release_push_event_v2(text,text)','EXECUTE') then
    raise exception 'service_role missing v2 RPC grants';
  end if;
  if has_function_privilege('anon','public.nexora_renew_push_event_v2(text,text,integer)','EXECUTE')
     or has_function_privilege('authenticated','public.nexora_renew_push_event_v2(text,text,integer)','EXECUTE')
     or has_function_privilege('anon','public.nexora_complete_push_event_v2(text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.nexora_complete_push_event_v2(text,text)','EXECUTE')
     or has_function_privilege('anon','public.nexora_release_push_event_v2(text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.nexora_release_push_event_v2(text,text)','EXECUTE') then
    raise exception 'untrusted role can execute v2 RPC';
  end if;

  <<behavior>>
  declare
    event_a text := 'test:push-lease:' || md5(random()::text || clock_timestamp()::text);
    event_b text := 'test:push-complete:' || md5(random()::text || clock_timestamp()::text);
    token_a text := 'test-claim-token-a-00000001';
    token_b text := 'test-claim-token-b-00000002';
  begin
    if not public.nexora_claim_push_event_v2(event_a, token_a, 60) then raise exception 'first claim failed'; end if;
    if public.nexora_claim_push_event_v2(event_a, token_b, 60) then raise exception 'duplicate live claim succeeded'; end if;
    if public.nexora_renew_push_event_v2(event_a, 'wrong-claim-token-000000', 60) then raise exception 'wrong token renewed lease'; end if;
    if not public.nexora_renew_push_event_v2(event_a, token_a, 60) then raise exception 'owner renewal failed'; end if;
    update public.nexora_push_events set lease_expires_at = now() - interval '1 second'
      where event_key = event_a and claim_token = token_a;
    if not public.nexora_claim_push_event_v2(event_a, token_b, 60) then raise exception 'expired lease takeover failed'; end if;
    if public.nexora_renew_push_event_v2(event_a, token_a, 60) then raise exception 'stale owner renewed after takeover'; end if;
    if public.nexora_release_push_event_v2(event_a, token_a) then raise exception 'stale owner released successor lease'; end if;
    if public.nexora_complete_push_event_v2(event_a, token_a) then raise exception 'stale owner completed successor lease'; end if;
    if not public.nexora_release_push_event_v2(event_a, token_b) then raise exception 'current owner release failed'; end if;

    if not public.nexora_claim_push_event_v2(event_b, token_a, 60) then raise exception 'completion claim failed'; end if;
    insert into public.nexora_push_deliveries(event_key, token, status)
      values (event_b, 'test-token-for-pending-delivery', 'pending');
    if public.nexora_complete_push_event_v2(event_b, token_a) then raise exception 'completion allowed pending delivery'; end if;
    update public.nexora_push_deliveries set status = 'sending' where event_key = event_b;
    if public.nexora_complete_push_event_v2(event_b, token_a) then raise exception 'completion allowed sending delivery'; end if;
    update public.nexora_push_deliveries set status = 'unknown' where event_key = event_b;
    if not public.nexora_complete_push_event_v2(event_b, token_a) then raise exception 'completion blocked terminal unknown delivery'; end if;
    delete from public.nexora_push_deliveries where event_key in (event_a, event_b);
    delete from public.nexora_push_events where event_key in (event_a, event_b);
  end behavior;
end;
$tests$;
