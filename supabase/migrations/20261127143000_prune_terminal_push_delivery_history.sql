-- Retain delivery history for 90 days, while never pruning pending deliveries.
-- The cleanup is deliberately callable only by service_role and runs in bounded batches.
create index if not exists nexora_push_deliveries_terminal_updated_idx
  on public.nexora_push_deliveries (updated_at)
  where status in ('sent', 'invalid');

create or replace function public.nexora_prune_push_delivery_history(
  p_batch_size integer default 1000
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  deleted_count integer;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 5000 then
    raise exception 'invalid_batch_size' using errcode = '22023';
  end if;

  with expired as (
    select ctid
    from public.nexora_push_deliveries
    where status in ('sent', 'invalid')
      and updated_at < pg_catalog.now() - interval '90 days'
    order by updated_at asc
    limit p_batch_size
    for update skip locked
  )
  delete from public.nexora_push_deliveries as deliveries
  using expired
  where deliveries.ctid = expired.ctid;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$function$;

revoke all on function public.nexora_prune_push_delivery_history(integer) from public, anon, authenticated;
grant execute on function public.nexora_prune_push_delivery_history(integer) to service_role;
