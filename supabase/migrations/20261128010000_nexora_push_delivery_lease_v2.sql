-- NEXORA AI DRAMA only: additive v2 push-event lease and retry metadata.
-- Candidate migration for review; do not apply to production until the coordinated
-- worker successor and disposable-project tests are approved.

alter table public.nexora_push_events
  add column if not exists lease_expires_at timestamptz;

alter table public.nexora_push_deliveries
  add column if not exists next_attempt_at timestamptz not null default pg_catalog.now(),
  add column if not exists last_error_code text;

-- The lease RPCs are SECURITY INVOKER, so explicitly keep their backing
-- tables service-role-only. This also closes direct client access to events.
alter table public.nexora_push_events enable row level security;
alter table public.nexora_push_deliveries enable row level security;
revoke all on table public.nexora_push_events from public, anon, authenticated;
revoke all on table public.nexora_push_deliveries from public, anon, authenticated;
grant all on table public.nexora_push_events to service_role;
grant all on table public.nexora_push_deliveries to service_role;

-- The deployed progress schema already uses sending/failed. Add unknown as an
-- explicit terminal state so uncertain FCM outcomes can be reconciled safely.
alter table public.nexora_push_deliveries
  drop constraint if exists nexora_push_deliveries_status_check;
alter table public.nexora_push_deliveries
  add constraint nexora_push_deliveries_status_check
  check (status in ('pending', 'sending', 'sent', 'invalid', 'failed', 'unknown'));

-- Legacy workers used 'sending' for an outcome that may already have reached FCM.
-- Do not retry those rows automatically. Quarantine only stale rows; a currently
-- active send gets a full 15-minute grace period before operational reconciliation.
update public.nexora_push_deliveries
set status = 'unknown',
    last_error_code = coalesce(last_error_code, 'LEGACY_SENDING_OUTCOME_UNKNOWN'),
    updated_at = pg_catalog.now()
where status = 'sending'
  and updated_at < pg_catalog.now() - interval '15 minutes';

-- Preserve the existing 15-minute claim semantics for in-flight v1 claims.
update public.nexora_push_events
set lease_expires_at = created_at + interval '15 minutes'
where claim_token is not null
  and lease_expires_at is null;

create index if not exists nexora_push_deliveries_pending_due_v2_idx
  on public.nexora_push_deliveries (event_key, next_attempt_at, token)
  where status = 'pending';

create index if not exists nexora_push_deliveries_sending_age_v2_idx
  on public.nexora_push_deliveries (event_key, updated_at, token)
  where status = 'sending';

-- Keep the currently deployed v1 worker safe during the additive migration-first rollout.
-- Its existing RPC name now writes the lease column, so v1 claims cannot be stolen by v2.
create or replace function public.nexora_claim_push_event(
  p_event_key text,
  p_claim_token text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  claimed text;
begin
  if p_event_key is null or pg_catalog.length(p_event_key) = 0
     or pg_catalog.length(p_event_key) > 128
     or p_claim_token is null or pg_catalog.length(p_claim_token) < 16
     or pg_catalog.length(p_claim_token) > 128 then
    raise exception 'invalid_event_claim' using errcode = '22023';
  end if;

  insert into public.nexora_push_events (
    event_key, episode_id, claim_token, lease_expires_at
  )
  values (
    p_event_key, 'app_update', p_claim_token,
    pg_catalog.now() + interval '15 minutes'
  )
  on conflict (event_key) do update
    set claim_token = excluded.claim_token,
        lease_expires_at = excluded.lease_expires_at,
        created_at = pg_catalog.now()
    where public.nexora_push_events.claim_token is not null
      and public.nexora_push_events.lease_expires_at <= pg_catalog.now()
  returning event_key into claimed;

  return claimed is not null;
end;
$function$;

create or replace function public.nexora_claim_push_event_v2(
  p_event_key text,
  p_claim_token text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  claimed text;
begin
  if p_event_key is null or pg_catalog.length(p_event_key) = 0
     or pg_catalog.length(p_event_key) > 128
     or p_claim_token is null or pg_catalog.length(p_claim_token) < 16
     or pg_catalog.length(p_claim_token) > 128
     or p_lease_seconds is null or p_lease_seconds < 30
     or p_lease_seconds > 900 then
    raise exception 'invalid_event_claim' using errcode = '22023';
  end if;

  insert into public.nexora_push_events (
    event_key, episode_id, claim_token, lease_expires_at
  )
  values (
    p_event_key, 'app_update', p_claim_token,
    pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds)
  )
  on conflict (event_key) do update
    set claim_token = excluded.claim_token,
        lease_expires_at = excluded.lease_expires_at,
        created_at = pg_catalog.now()
    where public.nexora_push_events.claim_token is not null
      and public.nexora_push_events.lease_expires_at <= pg_catalog.now()
  returning event_key into claimed;

  return claimed is not null;
end;
$function$;

create or replace function public.nexora_renew_push_event_v2(
  p_event_key text,
  p_claim_token text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  changed integer;
begin
  if p_event_key is null or pg_catalog.length(p_event_key) = 0
     or pg_catalog.length(p_event_key) > 128
     or p_claim_token is null or pg_catalog.length(p_claim_token) < 16
     or pg_catalog.length(p_claim_token) > 128
     or p_lease_seconds is null or p_lease_seconds < 30
     or p_lease_seconds > 900 then
    raise exception 'invalid_event_lease' using errcode = '22023';
  end if;

  update public.nexora_push_events
  set lease_expires_at = pg_catalog.now()
      + pg_catalog.make_interval(secs => p_lease_seconds)
  where event_key = p_event_key
    and claim_token = p_claim_token
    and lease_expires_at > pg_catalog.now();

  get diagnostics changed = row_count;
  return changed = 1;
end;
$function$;

create or replace function public.nexora_complete_push_event_v2(
  p_event_key text,
  p_claim_token text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  changed integer;
begin
  if p_event_key is null or p_claim_token is null then
    return false;
  end if;

  update public.nexora_push_events e
  set claim_token = null,
      lease_expires_at = null
  where e.event_key = p_event_key
    and e.claim_token = p_claim_token
    and e.lease_expires_at > pg_catalog.now()
    and not exists (
      select 1
      from public.nexora_push_deliveries d
      where d.event_key = e.event_key
        and d.status in ('pending', 'sending')
    );

  get diagnostics changed = row_count;
  return changed = 1;
end;
$function$;

create or replace function public.nexora_release_push_event_v2(
  p_event_key text,
  p_claim_token text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  changed integer;
begin
  if p_event_key is null or p_claim_token is null then
    return false;
  end if;

  delete from public.nexora_push_events
  where event_key = p_event_key
    and claim_token = p_claim_token;

  get diagnostics changed = row_count;
  return changed = 1;
end;
$function$;

revoke all on function public.nexora_claim_push_event_v2(text, text, integer)
  from public, anon, authenticated;
revoke all on function public.nexora_renew_push_event_v2(text, text, integer)
  from public, anon, authenticated;
revoke all on function public.nexora_complete_push_event_v2(text, text)
  from public, anon, authenticated;
revoke all on function public.nexora_release_push_event_v2(text, text)
  from public, anon, authenticated;

grant execute on function public.nexora_claim_push_event_v2(text, text, integer)
  to service_role;
grant execute on function public.nexora_renew_push_event_v2(text, text, integer)
  to service_role;
grant execute on function public.nexora_complete_push_event_v2(text, text)
  to service_role;
grant execute on function public.nexora_release_push_event_v2(text, text)
  to service_role;
