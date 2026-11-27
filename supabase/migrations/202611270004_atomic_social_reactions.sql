-- Serialize like/save toggles so rapid or cross-device requests cannot
-- interleave the read and write phases of a toggle.
create or replace function public.nexora_toggle_social_reaction(
  p_user_id text,
  p_series_id text,
  p_reaction text
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_exists boolean;
begin
  if p_user_id is null or length(p_user_id) = 0 or length(p_user_id) > 128
     or p_series_id is null or length(p_series_id) = 0 or length(p_series_id) > 128
     or p_reaction is null or p_reaction not in ('like', 'save') then
    raise exception 'invalid_social_reaction' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'nexora-social-reaction:' || p_reaction || ':' || p_user_id || ':' || p_series_id,
      0
    )
  );

  if p_reaction = 'like' then
    select exists(
      select 1 from public.nexora_social_likes
       where user_id = p_user_id and series_id = p_series_id
    ) into v_exists;
    if v_exists then
      delete from public.nexora_social_likes
       where user_id = p_user_id and series_id = p_series_id;
      return false;
    end if;
    insert into public.nexora_social_likes(user_id, series_id)
    values (p_user_id, p_series_id);
    return true;
  end if;

  select exists(
    select 1 from public.nexora_social_saves
     where user_id = p_user_id and series_id = p_series_id
  ) into v_exists;
  if v_exists then
    delete from public.nexora_social_saves
     where user_id = p_user_id and series_id = p_series_id;
    return false;
  end if;
  insert into public.nexora_social_saves(user_id, series_id)
  values (p_user_id, p_series_id);
  return true;
end;
$$;

revoke all on function public.nexora_toggle_social_reaction(text, text, text)
  from public, anon, authenticated;
grant execute on function public.nexora_toggle_social_reaction(text, text, text)
  to service_role;
