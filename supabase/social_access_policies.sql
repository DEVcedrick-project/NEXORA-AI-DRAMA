-- NEXORA AI DRAMA social tables: explicit client-deny policies.
-- Social operations are performed only by the Firebase-ID-token-verifying
-- nexora-social Edge Function with the server service role. Do not grant direct
-- anon/authenticated access to these tables.

alter table public.nexora_social_likes enable row level security;
alter table public.nexora_social_saves enable row level security;
alter table public.nexora_social_comments enable row level security;

drop policy if exists "deny_client_access_nexora_social_likes" on public.nexora_social_likes;
create policy "deny_client_access_nexora_social_likes"
  on public.nexora_social_likes for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "deny_client_access_nexora_social_saves" on public.nexora_social_saves;
create policy "deny_client_access_nexora_social_saves"
  on public.nexora_social_saves for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "deny_client_access_nexora_social_comments" on public.nexora_social_comments;
create policy "deny_client_access_nexora_social_comments"
  on public.nexora_social_comments for all to anon, authenticated
  using (false) with check (false);
