-- Bounded maintenance for stale social read-rate-limit rows.
-- Deploy through a reviewed Supabase migration; do not run from a mobile client.
-- The scheduler is intentionally external: this project currently has no pg_cron.

create index if not exists nexora_social_read_limits_updated_at_idx
  on public.nexora_social_read_limits (updated_at);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create or replace function private.nexora_cleanup_social_read_limits(
  p_older_than timestamptz,
  p_batch_size integer default 250
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_deleted integer := 0;
begin
  if p_older_than is null
     or p_older_than > pg_catalog.now() - interval '24 hours' then
    raise exception 'cleanup cutoff must be at least 24 hours old'
      using errcode = '22023';
  end if;

  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 500 then
    raise exception 'batch size must be between 1 and 500'
      using errcode = '22023';
  end if;

  with stale_rows as (
    select ctid
      from public.nexora_social_read_limits
     where updated_at < p_older_than
     order by updated_at asc, user_id asc
     limit p_batch_size
     for update skip locked
  )
  delete from public.nexora_social_read_limits as limits
   using stale_rows
   where limits.ctid = stale_rows.ctid;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

revoke all on function private.nexora_cleanup_social_read_limits(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function private.nexora_cleanup_social_read_limits(timestamptz, integer)
  to service_role;

comment on function private.nexora_cleanup_social_read_limits(timestamptz, integer) is
  'Deletes at most 500 social read-rate-limit rows older than the supplied cutoff; invoke from a trusted scheduled service.';
