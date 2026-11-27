-- Keep FCM registrations linked to their Firebase account for ownership and limits.
alter table public.nexora_push_devices
  add column if not exists user_id text;

create index if not exists nexora_push_devices_user_id_idx
  on public.nexora_push_devices (user_id)
  where user_id is not null;
