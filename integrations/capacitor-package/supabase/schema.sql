-- ============================================================================
-- NEXORA AI DRAMA — SUPABASE POSTGRES SCHEMA (user_wallets & unlocked_episodes)
-- Run this SQL in your Supabase SQL Editor before connecting your app.
-- ============================================================================

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

-- Enable Row Level Security (RLS)
alter table public.user_wallets enable row level security;
alter table public.unlocked_episodes enable row level security;

-- Development / Anon Client Policies (tighten for production JWT auth as needed)
drop policy if exists "Allow anon upsert user_wallets" on public.user_wallets;
create policy "Allow anon upsert user_wallets"
  on public.user_wallets
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Allow anon upsert unlocked_episodes" on public.unlocked_episodes;
create policy "Allow anon upsert unlocked_episodes"
  on public.unlocked_episodes
  for all
  to anon, authenticated
  using (true)
  with check (true);