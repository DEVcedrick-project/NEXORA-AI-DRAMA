-- Expand push delivery states without exposing device tokens to client roles.
alter table public.nexora_push_deliveries
  drop constraint if exists nexora_push_deliveries_status_check;

alter table public.nexora_push_deliveries
  add constraint nexora_push_deliveries_status_check
  check (status in ('pending', 'sent', 'invalid', 'failed', 'unknown'));

alter table public.nexora_push_deliveries
  add column if not exists response_status integer,
  add column if not exists last_error_code text;

alter table public.nexora_push_deliveries
  add constraint nexora_push_deliveries_response_status_check
  check (response_status is null or response_status between 100 and 599);

alter table public.nexora_push_deliveries
  add constraint nexora_push_deliveries_error_code_check
  check (last_error_code is null or length(last_error_code) <= 64);

create index if not exists nexora_push_deliveries_status_updated_idx
  on public.nexora_push_deliveries (status, updated_at);

-- Delivery history remains service-role only; no client read policy is added.
alter table public.nexora_push_deliveries enable row level security;
revoke all on table public.nexora_push_deliveries from public, anon, authenticated;
grant all on table public.nexora_push_deliveries to service_role;
