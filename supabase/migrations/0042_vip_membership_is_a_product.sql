-- 0042: the membership is a product, and the till must treat it as one.
--
-- `spend_currency` refuses every benefit-tagged row, because a `vip`/`verified`/`corporate` tag marks
-- the thing a tier hands out rather than something a member buys. That rule is right for the rainbow
-- frame and the gold titles and wrong for the membership itself — and the live `vip_lifetime` row
-- carried tag='vip', which made the only way to *earn* VIP unsellable: the card hid its price and the
-- till answered BENEFIT_ONLY (the client rendered that as a sentence about promotion boosts).
--
-- Kind is the truth, tag is a chip. Three changes, in one file:
--   1. the till exempts `kind = 'vip'` from the benefit refusal, so a mislabelled row can never again
--      switch membership off;
--   2. the live row loses the contradictory chip — a "VIP only" label on the product that grants VIP;
--   3. the console editor normalises the same case instead of letting an operator re-arm the trap.
--
-- Depends on 0040 (the current spend_currency and admin_upsert_catalog_item bodies). Safe to run twice.

-- ------------------------------------------------------------ 1. the till sells the membership

create or replace function public.spend_currency(p_sku text, p_idempotency_key text)
returns table (order_id uuid, balance integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.spend_catalog%rowtype;
  v_user uuid := auth.uid();
  v_balance integer;
  v_order uuid;
  v_price integer;
  v_bundle public.spend_catalog%rowtype;
begin
  select * into v_item from public.spend_catalog where sku = p_sku and enabled;
  if not found then
    raise exception 'UNKNOWN_SKU: %', p_sku;
  end if;
  if v_item.tag = 'soon' then
    raise exception 'COMING_SOON: % is not for sale yet', p_sku;
  end if;
  -- A benefit-tagged row is not a SKU: it can only arrive through the tier it belongs to, so
  -- neither a VIP, a verified nor a corporate product can be bought off the shelf (0037, 0040).
  -- 0042: the membership is a product, not a benefit. Kind decides; the chip does not.
  if v_item.kind <> 'vip' and v_item.tag in ('vip', 'verified', 'corporate') then
    raise exception 'BENEFIT_ONLY: % is a % benefit', p_sku, v_item.tag;
  end if;

  if p_idempotency_key is not null then
    select o.id into v_order from public.spend_orders o
      where o.idempotency_key = p_idempotency_key and o.user_id = v_user;
    if found then
      select balance_after into v_balance from public.currency_ledger
        where user_id = v_user order by id desc limit 1;
      return query select v_order, coalesce(v_balance, 0);
    end if;
  end if;

  -- Membership is permanent; charging twice for it is never the user's intent. Any VIP product
  -- counts, so adding a second membership SKU later cannot sell the same tier twice.
  if v_item.kind = 'vip' and exists (
    select 1
      from public.spend_orders o
      join public.spend_catalog c on c.sku = o.sku
     where o.user_id = v_user and o.status = 'filled' and c.kind = 'vip'
  ) then
    raise exception 'ALREADY_OWNED: %', p_sku;
  end if;

  v_price := app.effective_price(v_item);

  select coalesce(sum(delta), 0) into v_balance from public.currency_ledger where user_id = v_user;
  if v_balance < v_price then
    raise exception 'INSUFFICIENT_FUNDS: need % have %', v_price, v_balance;
  end if;

  insert into public.spend_orders (user_id, sku, price_paid, idempotency_key)
    values (v_user, p_sku, v_price, p_idempotency_key)
    returning id into v_order;

  v_balance := app.ledger_append(v_user, -v_price, 'spend', v_item.sku, 'order', v_order::text,
                                 p_idempotency_key, v_user::text);

  if v_item.kind = 'theme' then
    insert into public.user_themes (user_id, theme_key)
      values (v_user, v_item.ref_code) on conflict do nothing;

    -- The bundle: a theme brings its frame, recorded as a zero-priced order so ownership comes from
    -- the same ledger as every other cosmetic.
    select * into v_bundle
      from public.spend_catalog c
     where c.kind = 'frame' and c.ref_code = v_item.ref_code and c.sku <> p_sku;
    if v_bundle.sku is not null then
      insert into public.spend_orders (user_id, sku, price_paid, idempotency_key, grant_note)
        values (v_user, v_bundle.sku, 0, null, 'theme_bundle:' || v_order::text)
        on conflict (idempotency_key) do nothing;
      perform set_config('app.cosmetic_write', 'on', true);
      update public.profiles p
         set frame_key = coalesce(p.frame_key, v_item.ref_code)
       where p.id = v_user;
      perform set_config('app.cosmetic_write', 'off', true);
    end if;
  elsif v_item.kind = 'badge' then
    insert into public.user_badges (user_id, code, awarded_by)
      values (v_user, v_item.ref_code, 'purchase') on conflict do nothing;
  elsif v_item.kind = 'boost' then
    insert into public.strategy_boosts (strategy_id, buyer_id, sku, ends_at)
      values (v_item.ref_code::uuid, v_user, v_item.sku,
              now() + make_interval(hours => greatest(1, coalesce(v_item.duration_hours, 72))));
  elsif v_item.kind = 'vip' then
    -- The receipt grants the frame through the same path a theme bundle uses. Resolve it by registry
    -- key, not by one hardcoded SKU, so an operator can rename the shelf row.
    insert into public.spend_orders (user_id, sku, price_paid, idempotency_key, grant_note)
    select v_user, c.sku, 0, null, 'vip:' || v_order::text
      from public.spend_catalog c
     where c.kind = 'frame' and c.ref_code = 'rainbow'
       and not exists (
         select 1 from public.spend_orders o
          where o.user_id = v_user and o.sku = c.sku and o.status = 'filled'
       )
     order by c.enabled desc, c.sort_order
     limit 1;
    perform set_config('app.cosmetic_write', 'on', true);
    update public.profiles p
       set frame_key = coalesce(p.frame_key, 'rainbow'), updated_at = now()
     where p.id = v_user;
    perform set_config('app.cosmetic_write', 'off', true);
  end if;

  return query select v_order, v_balance;
end;
$$;

-- ------------------------------------------------------------ 2. the console cannot re-tag a product as a benefit

create or replace function public.admin_upsert_catalog_item(
  p_sku text,
  p_kind text,
  p_price integer,
  p_ref_code text default null,
  p_duration_hours integer default null,
  p_enabled boolean default true,
  p_sort_order integer default 100,
  p_name_tr text default null,
  p_name_en text default null,
  p_desc_tr text default null,
  p_desc_en text default null,
  p_perks jsonb default '[]'::jsonb,
  p_discount_percent integer default 0,
  p_discount_ends_at timestamptz default null,
  p_tag text default 'none'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sku text := lower(btrim(coalesce(p_sku, '')));
  v_discount integer := coalesce(p_discount_percent, 0);
  -- A benefit tag tells the till "not for sale", so it must not stick to a row that is for sale.
  v_tag text := case
    when p_kind = 'vip' and coalesce(p_tag, 'none') in ('vip', 'verified', 'corporate') then 'none'
    else coalesce(p_tag, 'none')
  end;
begin
  if not app.is_moderator() then raise exception 'FORBIDDEN'; end if;
  if v_sku !~ '^[a-z0-9_]{3,40}$' then raise exception 'SKU_INVALID'; end if;
  if p_kind not in ('badge', 'theme', 'boost', 'cosmetic', 'title', 'frame', 'vip') then raise exception 'KIND_INVALID'; end if;
  if p_price is null or p_price < 0 then raise exception 'PRICE_INVALID'; end if;
  if p_kind = 'boost' and (p_duration_hours is null or p_duration_hours < 1) then raise exception 'DURATION_REQUIRED'; end if;
  if v_discount < 0 or v_discount > 90 then raise exception 'DISCOUNT_INVALID'; end if;
  if v_discount > 0 and p_kind = 'boost' then raise exception 'DISCOUNT_NOT_FOR_BOOSTS'; end if;
  if coalesce(p_tag, 'none') not in ('none', 'new', 'soon', 'vip', 'verified', 'corporate') then raise exception 'TAG_INVALID'; end if;

  insert into public.spend_catalog as c (
    sku, kind, price, ref_code, duration_hours, enabled, sort_order, name_tr, name_en, desc_tr, desc_en, perks,
    discount_percent, discount_ends_at, tag
  )
  values (
    v_sku, p_kind, p_price, nullif(btrim(coalesce(p_ref_code, '')), ''), p_duration_hours,
    coalesce(p_enabled, true), coalesce(p_sort_order, 100),
    nullif(btrim(coalesce(p_name_tr, '')), ''), nullif(btrim(coalesce(p_name_en, '')), ''),
    nullif(btrim(coalesce(p_desc_tr, '')), ''), nullif(btrim(coalesce(p_desc_en, '')), ''),
    coalesce(p_perks, '[]'::jsonb),
    v_discount, p_discount_ends_at, v_tag
  )
  on conflict (sku) do update set
    kind = excluded.kind, price = excluded.price, ref_code = excluded.ref_code,
    duration_hours = excluded.duration_hours, enabled = excluded.enabled, sort_order = excluded.sort_order,
    name_tr = excluded.name_tr, name_en = excluded.name_en,
    desc_tr = excluded.desc_tr, desc_en = excluded.desc_en, perks = excluded.perks,
    discount_percent = excluded.discount_percent, discount_ends_at = excluded.discount_ends_at,
    tag = excluded.tag;

  return jsonb_build_object('sku', v_sku, 'price', p_price, 'kind', p_kind, 'discountPercent', v_discount);
end;
$$;

-- ------------------------------------------------------------ 3. repair the live row

update public.spend_catalog
   set tag = 'none'
 where kind = 'vip' and tag in ('vip', 'verified', 'corporate');

select pg_notify('pgrst', 'reload schema');

do $$
begin
  raise notice '0042: VIP membership sells again; a benefit tag can no longer sit on it.';
end;
$$;
