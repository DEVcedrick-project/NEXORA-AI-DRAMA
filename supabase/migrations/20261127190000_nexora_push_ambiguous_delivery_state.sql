-- Preserve ambiguous in-flight FCM sends instead of retrying them blindly.
alter table public.nexora_push_deliveries
  drop constraint if exists nexora_push_deliveries_status_check;

alter table public.nexora_push_deliveries
  add constraint nexora_push_deliveries_status_check
  check (status in ('pending', 'sending', 'sent', 'invalid', 'failed'));

comment on column public.nexora_push_deliveries.status is
  'pending=not attempted or explicitly rejected; sending=outcome unknown and not auto-retried; sent=FCM accepted; invalid=FCM confirmed unregistered; failed=terminal failure';
