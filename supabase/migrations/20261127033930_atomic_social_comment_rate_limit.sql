create or replace function public.nexora_create_social_comment(
  p_user_id text,
  p_display_name text,
  p_series_id text,
  p_body text
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  recent_count integer;
begin
  if p_user_id is null or length(p_user_id) = 0 or length(p_user_id) > 128 then
    raise exception 'invalid_user_id' using errcode = '22023';
  end if;
  if p_series_id is null or length(p_series_id) = 0 then
    raise exception 'invalid_series_id' using errcode = '22023';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 or length(p_body) > 500 then
    raise exception 'invalid_comment' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('nexora-social-comment:' || p_user_id, 0));
  select count(*)::integer into recent_count from public.nexora_social_comments
  where user_id = p_user_id and created_at >= pg_catalog.now() - interval '60 seconds';
  if recent_count >= 5 then return false; end if;
  insert into public.nexora_social_comments(user_id, display_name, series_id, body)
  values (p_user_id,left(regexp_replace(coalesce(p_display_name, 'NEXORA Viewer'), '[<>[:cntrl:]]', '', 'g'), 40),p_series_id,btrim(p_body));
  return true;
end;
$$;
revoke all on function public.nexora_create_social_comment(text,text,text,text) from public, anon, authenticated;
grant execute on function public.nexora_create_social_comment(text,text,text,text) to service_role;
