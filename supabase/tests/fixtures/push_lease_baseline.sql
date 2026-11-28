create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create table public.nexora_push_events (
  event_key text primary key,
  episode_id text not null,
  claim_token text,
  created_at timestamptz not null default now()
);

create table public.nexora_push_deliveries (
  event_key text not null,
  token text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'invalid', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_key, token)
);
alter table public.nexora_push_deliveries enable row level security;
revoke all on table public.nexora_push_deliveries from public, anon, authenticated;
grant all on table public.nexora_push_deliveries to service_role;
grant all on table public.nexora_push_events to service_role;

-- Model a legacy in-flight row that has exceeded the old worker's 15-minute claim window.
insert into public.nexora_push_deliveries(event_key, token, status, updated_at)
values ('legacy-stale-event', 'legacy-stale-token', 'sending', now() - interval '1 hour');

-- Model a genuinely active send that must receive the full 15-minute grace period.
insert into public.nexora_push_deliveries(event_key, token, status, updated_at)
values ('legacy-active-event', 'legacy-active-token', 'sending', now() - interval '5 minutes');
