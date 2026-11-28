-- Safe one-way reconciliation tests; run after the candidate v3 migration.
do $tests$
declare
  v_event_key text := 'test:push-reconcile:' || md5(random()::text || clock_timestamp()::text);
  v_pending_key text := 'test:push-reconcile-pending:' || md5(random()::text || clock_timestamp()::text);
  outcome text;
begin
  if to_regclass('public.nexora_push_delivery_reconciliations') is null then
    raise exception 'missing reconciliation audit table';
  end if;
  if not coalesce((select relrowsecurity from pg_catalog.pg_class
    where oid = 'public.nexora_push_delivery_reconciliations'::regclass), false) then
    raise exception 'reconciliation audit table must have RLS enabled';
  end if;
  if not has_table_privilege('service_role','public.nexora_push_delivery_reconciliations','SELECT,INSERT')
     or has_table_privilege('anon','public.nexora_push_delivery_reconciliations','SELECT')
     or has_table_privilege('authenticated','public.nexora_push_delivery_reconciliations','SELECT') then
    raise exception 'reconciliation audit table grants are unsafe';
  end if;
  if not has_function_privilege('service_role',
    'public.nexora_reconcile_push_delivery_v1(text,text,text,text,text)','EXECUTE')
     or has_function_privilege('anon',
    'public.nexora_reconcile_push_delivery_v1(text,text,text,text,text)','EXECUTE')
     or has_function_privilege('authenticated',
    'public.nexora_reconcile_push_delivery_v1(text,text,text,text,text)','EXECUTE') then
    raise exception 'reconciliation RPC grants are unsafe';
  end if;

  insert into public.nexora_push_deliveries(event_key, token, status, last_error_code)
  values (v_event_key, 'test-device-token-reconcile', 'unknown', 'NETWORK_RESPONSE_UNKNOWN'),
         (v_pending_key, 'test-device-token-pending', 'pending', null);

  outcome := public.nexora_reconcile_push_delivery_v1(
    v_event_key, 'test-device-token-reconcile', 'fcm-acceptance-proof-123',
    'FCM acceptance confirmed from retained provider response',
    'incident-NEXORA-123'
  );
  if outcome <> 'reconciled' then raise exception 'expected reconciled result, got %', outcome; end if;

  if not exists (select 1 from public.nexora_push_deliveries
    where event_key = v_event_key and token = 'test-device-token-reconcile'
      and status = 'sent' and sent_at is not null) then
    raise exception 'unknown delivery was not marked sent';
  end if;
  if not exists (select 1 from public.nexora_push_delivery_reconciliations
    where event_key = v_event_key and token = 'test-device-token-reconcile'
      and action = 'confirm_sent' and evidence_reference = 'fcm-acceptance-proof-123'
      and reason = 'FCM acceptance confirmed from retained provider response'
      and operator_reference = 'incident-NEXORA-123') then
    raise exception 'reconciliation audit record missing';
  end if;

  outcome := public.nexora_reconcile_push_delivery_v1(
    v_event_key, 'test-device-token-reconcile', 'fcm-acceptance-proof-123',
    'Repeated request', 'incident-NEXORA-123'
  );
  if outcome <> 'already_reconciled' then raise exception 'repeated reconciliation was not idempotent'; end if;

  if (select count(*) from public.nexora_push_delivery_reconciliations
      where event_key = v_event_key and token = 'test-device-token-reconcile') <> 1 then
    raise exception 'duplicate audit record created';
  end if;

  begin
    perform public.nexora_reconcile_push_delivery_v1(
      v_pending_key, 'test-device-token-pending', 'no-proof',
      'Must reject pending delivery', 'incident-NEXORA-124'
    );
    raise exception 'pending delivery was incorrectly reconciled';
  exception when sqlstate '55000' then
    null;
  end;

  if (select status from public.nexora_push_deliveries
      where event_key = v_pending_key and token = 'test-device-token-pending') <> 'pending' then
    raise exception 'rejected reconciliation changed pending delivery';
  end if;

  delete from public.nexora_push_delivery_reconciliations where event_key in (v_event_key, v_pending_key);
  delete from public.nexora_push_deliveries where event_key in (v_event_key, v_pending_key);
end;
$tests$;
