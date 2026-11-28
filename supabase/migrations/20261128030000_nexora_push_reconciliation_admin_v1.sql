-- Add a non-secret identifier for operator review; never return FCM tokens to the console.
alter table public.nexora_push_deliveries
  add column if not exists delivery_id uuid not null default gen_random_uuid();

create unique index if not exists nexora_push_deliveries_delivery_id_uidx
  on public.nexora_push_deliveries (delivery_id);

create or replace function public.nexora_reconcile_push_delivery_by_id_v1(
  p_delivery_id uuid,
  p_evidence_reference text,
  p_reason text,
  p_operator_reference text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_event_key text;
  target_token text;
  current_status text;
  inserted_count integer;
begin
  if p_delivery_id is null
     or p_evidence_reference is null or pg_catalog.length(pg_catalog.btrim(p_evidence_reference)) = 0
        or pg_catalog.length(p_evidence_reference) > 512
     or p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) = 0
        or pg_catalog.length(p_reason) > 1000
     or p_operator_reference is null or pg_catalog.length(pg_catalog.btrim(p_operator_reference)) = 0
        or pg_catalog.length(p_operator_reference) > 128 then
    raise exception 'invalid_push_reconciliation_input' using errcode = '22023';
  end if;

  select d.event_key, d.token, d.status
    into target_event_key, target_token, current_status
  from public.nexora_push_deliveries d
  where d.delivery_id = p_delivery_id
  for update;

  if not found then
    raise exception 'push_delivery_not_found' using errcode = 'P0002';
  end if;

  if current_status = 'sent' and exists (
    select 1 from public.nexora_push_delivery_reconciliations r
    where r.event_key = target_event_key and r.token = target_token
      and r.action = 'confirm_sent' and r.evidence_reference = p_evidence_reference
  ) then
    return 'already_reconciled';
  end if;

  if current_status <> 'unknown' then
    raise exception 'push_delivery_not_unknown' using errcode = '55000';
  end if;

  insert into public.nexora_push_delivery_reconciliations (
    event_key, token, action, evidence_reference, reason, operator_reference, actor_role
  ) values (
    target_event_key, target_token, 'confirm_sent', p_evidence_reference,
    p_reason, p_operator_reference, current_user
  )
  on conflict on constraint nexora_push_delivery_reconciliations_idempotency do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    return 'already_reconciled';
  end if;

  update public.nexora_push_deliveries
  set status = 'sent',
      sent_at = coalesce(sent_at, pg_catalog.now()),
      updated_at = pg_catalog.now()
  where delivery_id = p_delivery_id and status = 'unknown';

  if not found then
    raise exception 'push_delivery_reconciliation_race' using errcode = '40001';
  end if;

  return 'reconciled';
end;
$function$;

revoke all on function public.nexora_reconcile_push_delivery_by_id_v1(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.nexora_reconcile_push_delivery_by_id_v1(uuid, text, text, text)
  to service_role;
