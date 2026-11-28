do $tests$
declare
  v_delivery_id uuid;
  v_result text;
  v_event_key text := 'test:push-admin-id:' || md5(random()::text || clock_timestamp()::text);
begin
  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.nexora_push_deliveries'::regclass
      and attname = 'delivery_id' and not attisdropped
  ) then
    raise exception 'delivery_id column missing';
  end if;
  if not has_function_privilege('service_role',
    'public.nexora_reconcile_push_delivery_by_id_v1(uuid,text,text,text)','EXECUTE')
     or has_function_privilege('anon',
    'public.nexora_reconcile_push_delivery_by_id_v1(uuid,text,text,text)','EXECUTE')
     or has_function_privilege('authenticated',
    'public.nexora_reconcile_push_delivery_by_id_v1(uuid,text,text,text)','EXECUTE') then
    raise exception 'delivery-id reconciliation grants are unsafe';
  end if;

  insert into public.nexora_push_deliveries(event_key, token, status, last_error_code)
  values (v_event_key, 'private-fcm-token-must-not-be-returned', 'unknown', 'NETWORK_RESPONSE_UNKNOWN')
  returning delivery_id into v_delivery_id;

  v_result := public.nexora_reconcile_push_delivery_by_id_v1(
    v_delivery_id, 'provider-acceptance-reference',
    'Verified provider acceptance from retained response', 'verified-admin-user-id'
  );
  if v_result <> 'reconciled' then
    raise exception 'expected delivery-id reconciliation, got %', v_result;
  end if;
  if not exists (
    select 1 from public.nexora_push_deliveries
    where delivery_id = v_delivery_id and status = 'sent'
  ) then
    raise exception 'delivery-id reconciliation did not mark delivery sent';
  end if;
  if not exists (
    select 1 from public.nexora_push_delivery_reconciliations
    where event_key = v_event_key and token = 'private-fcm-token-must-not-be-returned'
      and operator_reference = 'verified-admin-user-id'
      and evidence_reference = 'provider-acceptance-reference'
  ) then
    raise exception 'delivery-id audit trail missing';
  end if;

  begin
    perform public.nexora_reconcile_push_delivery_by_id_v1(
      v_delivery_id, 'different-proof', 'second confirmation', 'verified-admin-user-id'
    );
    raise exception 'already sent delivery accepted a different reconciliation';
  exception when sqlstate '55000' then
    null;
  end;

  delete from public.nexora_push_delivery_reconciliations where event_key = v_event_key;
  delete from public.nexora_push_deliveries where event_key = v_event_key;
end;
$tests$;
