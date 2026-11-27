-- Stable keyset pagination for social comments. The existing two-column
-- index is superseded because the id tie-breaker prevents duplicate/omitted
-- rows when several comments share the same created_at timestamp.
create index if not exists nexora_social_comments_series_created_id_idx
  on public.nexora_social_comments (series_id, created_at desc, id desc);

drop index if exists public.nexora_social_comments_series_created_idx;
