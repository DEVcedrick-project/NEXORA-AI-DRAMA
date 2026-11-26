-- NEXORA AI DRAMA: secure PayMongo checkout and webhook fulfillment
create table if not exists public.nexora_payment_orders (
  id uuid primary key default gen_random_uuid(),
  reference_number text not null unique default gen_random_uuid()::text,
  user_id text not null,
  sku text not null check (sku in ('vip7','vip30','starter','pack1','pack2','pack3')),
  title text not null,
  amount_php integer not null check (amount_php > 0),
  coins_granted integer not null default 0 check (coins_granted >= 0),
  coins_kind text not null default 'purchased' check (coins_kind in ('purchased','bonus','none')),
  vip_days integer not null default 0 check (vip_days >= 0),
  payment_method text not null check (payment_method in ('gcash','paymaya','qrph')),
  status text not null default 'pending' check (status in ('pending','paid','test_paid','failed','review')),
  paymongo_session_id text unique,
  paymongo_payment_id text unique,
  paymongo_event_id text unique,
  checkout_url text,
  livemode boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists nexora_payment_orders_user_created_idx
  on public.nexora_payment_orders (user_id, created_at desc);

alter table public.nexora_payment_orders enable row level security;
revoke all on table public.nexora_payment_orders from anon, authenticated;
grant all on table public.nexora_payment_orders to service_role;

create or replace function public.fulfill_nexora_payment(
  p_reference_number text,
  p_session_id text,
  p_event_id text,
  p_payment_id text,
  p_amount integer,
  p_livemode boolean,
  p_payment_method text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.nexora_payment_orders%rowtype;
  v_now_ms bigint;
begin
  select * into v_order
  from public.nexora_payment_orders
  where reference_number = p_reference_number
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  if v_order.status = 'paid' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'status', 'paid');
  end if;

  if v_order.paymongo_session_id is not null
     and v_order.paymongo_session_id <> p_session_id then
    update public.nexora_payment_orders
      set status = 'review', updated_at = now()
      where id = v_order.id;
    return jsonb_build_object('ok', false, 'reason', 'session_mismatch');
  end if;

  if p_livemode is distinct from true then
    update public.nexora_payment_orders
      set status = 'test_paid',
          paymongo_session_id = coalesce(paymongo_session_id, p_session_id),
          paymongo_event_id = coalesce(paymongo_event_id, p_event_id),
          paymongo_payment_id = coalesce(paymongo_payment_id, p_payment_id),
          livemode = false,
          updated_at = now()
      where id = v_order.id;
    return jsonb_build_object('ok', true, 'test_mode', true, 'status', 'test_paid');
  end if;

  if p_amount is distinct from (v_order.amount_php * 100) then
    update public.nexora_payment_orders
      set status = 'review', livemode = true, updated_at = now()
      where id = v_order.id;
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  if p_payment_method is not null and p_payment_method <> v_order.payment_method then
    update public.nexora_payment_orders
      set status = 'review', livemode = true, updated_at = now()
      where id = v_order.id;
    return jsonb_build_object('ok', false, 'reason', 'payment_method_mismatch');
  end if;

  if v_order.status not in ('pending') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_order_state');
  end if;

  update public.nexora_payment_orders
    set status = 'paid',
        paymongo_session_id = coalesce(paymongo_session_id, p_session_id),
        paymongo_event_id = coalesce(paymongo_event_id, p_event_id),
        paymongo_payment_id = p_payment_id,
        livemode = true,
        paid_at = now(),
        updated_at = now()
    where id = v_order.id;

  v_now_ms := floor(extract(epoch from now()) * 1000)::bigint;

  insert into public.user_wallets (
    user_id, purchased_coins, bonus_coins, is_vip, vip_expires_at, vip_plan_label, updated_at
  ) values (
    v_order.user_id,
    case when v_order.coins_kind = 'purchased' then v_order.coins_granted else 0 end,
    60 + case when v_order.coins_kind = 'bonus' then v_order.coins_granted else 0 end,
    v_order.vip_days > 0,
    case when v_order.vip_days > 0
      then floor(extract(epoch from (now() + make_interval(days => v_order.vip_days))) * 1000)::bigint
      else 0 end,
    case when v_order.vip_days > 0 then v_order.title else '' end,
    now()
  )
  on conflict (user_id) do update set
    purchased_coins = public.user_wallets.purchased_coins
      + case when v_order.coins_kind = 'purchased' then v_order.coins_granted else 0 end,
    bonus_coins = public.user_wallets.bonus_coins
      + case when v_order.coins_kind = 'bonus' then v_order.coins_granted else 0 end,
    is_vip = case when v_order.vip_days > 0 then true else public.user_wallets.is_vip end,
    vip_expires_at = case when v_order.vip_days > 0 then
      floor(extract(epoch from (
        greatest(
          case when public.user_wallets.vip_expires_at > v_now_ms
            then to_timestamp(public.user_wallets.vip_expires_at / 1000.0)
            else now()
          end,
          now()
        ) + make_interval(days => v_order.vip_days)
      )) * 1000)::bigint
      else public.user_wallets.vip_expires_at end,
    vip_plan_label = case when v_order.vip_days > 0 then v_order.title else public.user_wallets.vip_plan_label end,
    updated_at = now();

  return jsonb_build_object('ok', true, 'duplicate', false, 'status', 'paid');
end;
$$;

revoke all on function public.fulfill_nexora_payment(text,text,text,text,integer,boolean,text) from public, anon, authenticated;
grant execute on function public.fulfill_nexora_payment(text,text,text,text,integer,boolean,text) to service_role;
