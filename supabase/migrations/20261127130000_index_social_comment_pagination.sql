-- Keep keyset pagination efficient and deterministic for comment feeds.
-- Existing index is retained until production query plans justify removing it.
create index if not exists nexora_social_comments_series_created_id_idx
  on public.nexora_social_comments (series_id, created_at desc, id desc);
