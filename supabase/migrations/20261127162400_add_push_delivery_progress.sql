create table if not exists public.nexora_push_deliveries (
  event_key text not null,
  token text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'invalid')),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_key, token)
);

alter table public.nexora_push_deliveries enable row level security;
revoke all on table public.nexora_push_deliveries from public, anon, authenticated;
grant all on table public.nexora_push_deliveries to service_role;
