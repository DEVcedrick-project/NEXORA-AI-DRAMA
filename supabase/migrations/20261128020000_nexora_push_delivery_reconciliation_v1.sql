-- Audited, one-way reconciliation for uncertain push outcomes.
-- This does not resend notifications. A separate, explicitly approved workflow
-- would be required before any future requeue capability is added.

create table if not exists public.nexora_push_delivery_reconciliations (
  id bigint generated always as identity primary key,
  event_key text not null,
  token text not null,
  action text not null check (action = 'confirm_sent'),
  evidence_reference text not null,
  reason text not null,
  operator_reference text not null,
  actor_role name not null default current_user,
  created_at timestamptz not null default pg_catalog.now(),
  constraint nexora_push_delivery_reconciliations_idempotency
    unique (event_key, token, action, evidence_reference)
);

alter table public.nexora_push_delivery_reconciliations enable row level security;
revoke all on table public.nexora_push_delivery_reconciliations from public, anon, authenticated;
grant all on table public.nexora_push_delivery_reconciliations to service_role;

create or replace function public.nexora_reconcile_push_delivery_v1(
  p_event_key text,
  p_token text,
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
  current_status text;
  inserted_count integer;
begin
  if p_event_key is null or pg_catalog.length(p_event_key) = 0 or pg_catalog.length(p_event_key) > 128
     or p_token is null or pg_catalog.length(p_token) = 0 or pg_catalog.length(p_token) > 4096
     or p_evidence_reference is null or pg_catalog.length(pg_catalog.btrim(p_evidence_reference)) = 0
        or pg_catalog.length(p_evidence_reference) > 512
     or p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) = 0
        or pg_catalog.length(p_reason) > 1000
     or p_operator_reference is null or pg_catalog.length(pg_catalog.btrim(p_operator_reference)) = 0
        or pg_catalog.length(p_operator_reference) > 128 then
    raise exception 'invalid_push_reconciliation_input' using errcode = '22023';
  end if;

  select d.status into current_status
  from public.nexora_push_deliveries d
  where d.event_key = p_event_key and d.token = p_token
  for update;

  if not found then
    raise exception 'push_delivery_not_found' using errcode = 'P0002';
  end if;

  if current_status = 'sent' and exists (
    select 1 from public.nexora_push_delivery_reconciliations r
    where r.event_key = p_event_key and r.token = p_token
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
    p_event_key, p_token, 'confirm_sent', p_evidence_reference,
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
  where event_key = p_event_key and token = p_token and status = 'unknown';

  if not found then
    raise exception 'push_delivery_reconciliation_race' using errcode = '40001';
  end if;

  return 'reconciled';
end;
$function$;

revoke all on function public.nexora_reconcile_push_delivery_v1(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.nexora_reconcile_push_delivery_v1(text, text, text, text, text)
  to service_role;
