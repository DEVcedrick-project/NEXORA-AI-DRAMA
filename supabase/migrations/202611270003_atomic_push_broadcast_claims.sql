alter table public.nexora_push_events add column if not exists claim_token text;

create or replace function public.nexora_claim_push_event(p_event_key text, p_claim_token text)
returns boolean language plpgsql set search_path = '' as $$
declare claimed text;
begin
  if p_event_key is null or length(p_event_key)=0 or length(p_event_key)>128
     or p_claim_token is null or length(p_claim_token)<16 or length(p_claim_token)>128 then
    raise exception 'invalid_event_claim' using errcode='22023';
  end if;
  insert into public.nexora_push_events(event_key,episode_id,claim_token)
  values(p_event_key,'app_update',p_claim_token)
  on conflict(event_key) do update
    set claim_token=excluded.claim_token,created_at=pg_catalog.now()
    where public.nexora_push_events.claim_token is not null
      and public.nexora_push_events.created_at < pg_catalog.now()-interval '15 minutes'
  returning event_key into claimed;
  return claimed is not null;
end;
$$;

create or replace function public.nexora_complete_push_event(p_event_key text,p_claim_token text)
returns boolean language plpgsql set search_path = '' as $$
declare changed integer;
begin
  update public.nexora_push_events set claim_token=null
  where event_key=p_event_key and claim_token=p_claim_token;
  get diagnostics changed=row_count;
  return changed=1;
end;
$$;

create or replace function public.nexora_release_push_event(p_event_key text,p_claim_token text)
returns boolean language plpgsql set search_path = '' as $$
declare changed integer;
begin
  delete from public.nexora_push_events where event_key=p_event_key and claim_token=p_claim_token;
  get diagnostics changed=row_count;
  return changed=1;
end;
$$;

revoke all on function public.nexora_claim_push_event(text,text) from public,anon,authenticated;
revoke all on function public.nexora_complete_push_event(text,text) from public,anon,authenticated;
revoke all on function public.nexora_release_push_event(text,text) from public,anon,authenticated;
grant execute on function public.nexora_claim_push_event(text,text) to service_role;
grant execute on function public.nexora_complete_push_event(text,text) to service_role;
grant execute on function public.nexora_release_push_event(text,text) to service_role;
