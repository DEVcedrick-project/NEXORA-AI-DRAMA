-- NEXORA AI DRAMA — legacy wallet tables: production-safe default-deny baseline.
-- IMPORTANT:
-- These tables use Firebase UID strings, not Supabase Auth UUIDs. The mobile
-- client only has a Supabase publishable/anon key, so it cannot prove Firebase
-- identity to Supabase RLS. Do NOT add user_id = auth.uid() policies here:
-- that would not authenticate Firebase users.
--
-- Wallet balances, VIP entitlements and paid/ad episode unlocks must be written
-- by a trusted server after verifying Firebase ID tokens and payment/ad events.
-- Until that backend exists, client access to these legacy tables is denied.

create table if not exists public.user_wallets (
  user_id text primary key,
  display_name text default 'NEXORA Viewer',
  purchased_coins integer not null default 0,
  bonus_coins integer not null default 60,
  is_vip boolean not null default false,
  vip_expires_at bigint not null default 0,
  vip_plan_label text default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.unlocked_episodes (
  user_id text not null,
  episode_key text not null,
  series_id text not null,
  episode_num integer not null default 1,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, episode_key)
);

alter table public.user_wallets enable row level security;
alter table public.user_wallets force row level security;
alter table public.unlocked_episodes enable row level security;
alter table public.unlocked_episodes force row level security;

-- Remove the unsafe development policies if they were previously installed.
drop policy if exists "Allow anon upsert user_wallets" on public.user_wallets;
drop policy if exists "Allow anon upsert unlocked_episodes" on public.unlocked_episodes;

-- No anon/authenticated policies are intentionally created. RLS therefore
-- denies all direct client row access. Service-role/server operations must be
-- performed only in a trusted backend; never ship the service key in the app.
revoke all on table public.user_wallets from anon, authenticated;
revoke all on table public.unlocked_episodes from anon, authenticated;

comment on table public.user_wallets is
  'Sensitive wallet state. Direct client access disabled; use trusted server-side operations only.';
comment on table public.unlocked_episodes is
  'Episode entitlements. Direct client access disabled; use trusted server-side operations only.';
