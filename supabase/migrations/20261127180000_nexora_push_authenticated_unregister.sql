create or replace function public.nexora_unregister_push_device(
  p_token text,
  p_user_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_token is null or length(p_token) < 80 or length(p_token) > 4096
     or p_token ~ '[[:space:]]'
     or p_user_id is null or length(p_user_id) < 1 or length(p_user_id) > 128 then
    raise exception 'invalid push device identity' using errcode = '22023';
  end if;

  delete from public.nexora_push_devices
   where token = p_token
     and user_id = p_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.nexora_unregister_push_device(text, text) from public, anon, authenticated;
grant execute on function public.nexora_unregister_push_device(text, text) to service_role;
