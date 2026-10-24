-- 0027: the storefront gains prices that can move.
--
--   * `discount_percent` + `discount_ends_at`: a temporary price cut that the server applies at the
--     till, not a label the client subtracts. The list price stays intact so the UI can show both.
--   * `tag`: `new` / `soon` markers with their own look. `soon` also blocks the purchase server-side;
--     a "coming soon" product must not be buyable just because the button is hidden.
--   * Theme bundles: buying a theme grants its matching frame, because a skin without its frame looks
--     unfinished. Frames stay purchasable on their own, so nobody has to buy a theme for the ring.
--
-- Deliberate limit: boost packages do not take discounts. Their price is derived from duration, and a
-- second moving part in the same number is how "why did I pay more than the card said" happens.

-- ------------------------------------------------------------ 1. columns

alter table public.spend_catalog add column if not exists discount_percent integer not null default 0
  check (discount_percent between 0 and 90);
alter table public.spend_catalog add column if not exists discount_ends_at timestamptz;
alter table public.spend_catalog add column if not exists tag text not null default 'none'
  check (tag in ('none', 'new', 'soon'));

-- The helper every read and every purchase uses, so the card and the till cannot disagree.
create or replace function app.effective_price(p_item public.spend_catalog)
returns integer
language sql
stable
as $$
  select case
    when p_item.kind = 'boost' then p_item.price
    when p_item.discount_percent > 0
      and (p_item.discount_ends_at is null or p_item.discount_ends_at > now())
      then greatest(1, ceil(p_item.price * (100 - p_item.discount_percent) / 100.0)::integer)
    else p_item.price
  end;
$$;

create or replace function app.discount_active(p_item public.spend_catalog)
returns boolean
language sql
stable
as $$
  select p_item.kind <> 'boost'
     and p_item.discount_percent > 0
     and (p_item.discount_ends_at is null or p_item.discount_ends_at > now());
$$;

-- ------------------------------------------------------------ 2. bundles

alter table public.spend_orders add column if not exists grant_note text;

-- ------------------------------------------------------------ 3. wallet summary carries the price pair and the tag

create or replace function public.wallet_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_balance integer := 0;
  v_cached integer;
  v_rules jsonb;
  v_entries jsonb;
  v_catalog jsonb;
  v_boosts jsonb;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;

  select coalesce(sum(l.delta), 0)::integer into v_balance
    from public.currency_ledger l where l.user_id = v_user;

  select p.currency_balance_cache into v_cached from public.profiles p where p.id = v_user;

  select coalesce(jsonb_agg(jsonb_build_object(
             'code', r.code, 'kind', r.kind, 'amount', r.amount,
             'dailyCap', r.daily_cap, 'weeklyCap', r.weekly_cap,
             'earnedToday', coalesce(t.today, 0), 'earnedWeek', coalesce(t.week, 0)
           ) order by r.code), '[]'::jsonb)
    into v_rules
    from public.currency_rules r
    left join lateral (
      select coalesce(sum(l.delta) filter (where l.created_at >= date_trunc('day', now())), 0)::integer as today,
             coalesce(sum(l.delta) filter (where l.created_at >= date_trunc('week', now())), 0)::integer as week
        from public.currency_ledger l
        where l.user_id = v_user and l.rule_code = r.code and l.delta > 0
    ) t on true
    where r.enabled;

  select coalesce(jsonb_agg(jsonb_build_object(
             'delta', e.delta, 'kind', e.kind, 'ruleCode', e.rule_code,
             'refType', e.ref_type, 'at', e.created_at
           ) order by e.id desc), '[]'::jsonb)
    into v_entries
    from (
      select l.id, l.delta, l.kind, l.rule_code, l.ref_type, l.created_at
        from public.currency_ledger l
        where l.user_id = v_user
        order by l.id desc
        limit 15
    ) e;

  select coalesce(jsonb_agg(jsonb_build_object(
             'sku', c.sku,
             'kind', c.kind,
             'price', c.price,
             'finalPrice', app.effective_price(c),
             'discountPercent', case when app.discount_active(c) then c.discount_percent else 0 end,
             'discountEndsAt', case when app.discount_active(c) then c.discount_ends_at else null end,
             'tag', c.tag,
             'refCode', c.ref_code,
             'durationHours', c.duration_hours,
             'name', c.name_tr,
             'nameEn', c.name_en,
             'desc', c.desc_tr,
             'descEn', c.desc_en,
             'perks', c.perks,
             'sortOrder', c.sort_order,
             'owned', case c.kind
               when 'theme' then (c.price = 0 or exists (
                 select 1 from public.user_themes ut
                  where ut.user_id = v_user and ut.theme_key = c.ref_code
               ))
               else exists (
                 select 1 from public.spend_orders o
                  where o.user_id = v_user and o.sku = c.sku and o.status = 'filled'
               )
             end
           ) order by c.sort_order, c.price, c.sku), '[]'::jsonb)
    into v_catalog
    from public.spend_catalog c
    where c.enabled;

  select coalesce(jsonb_agg(jsonb_build_object(
             'strategyId', b.strategy_id, 'strategyName', s.name, 'sku', b.sku, 'endsAt', b.ends_at
           ) order by b.ends_at), '[]'::jsonb)
    into v_boosts
    from public.strategy_boosts b
    join public.strategies s on s.id = b.strategy_id
    where b.buyer_id = v_user and b.status = 'active' and b.ends_at > now();

  return jsonb_build_object(
    'balance', v_balance,
    'cached', v_cached,
    'reconciled', (v_cached is null or v_cached = v_balance),
    'theme', (select p.theme_key from public.profiles p where p.id = v_user),
    'themeAccent', (select t.css ->> 'accent' from public.profiles p join public.profile_themes t on t.key = p.theme_key where p.id = v_user),
    'rules', v_rules,
    'entries', v_entries,
    'catalog', v_catalog,
    'boosts', v_boosts
  );
end;
$$;

-- ------------------------------------------------------------ 4. the till

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

  if p_idempotency_key is not null then
    select o.id into v_order from public.spend_orders o
      where o.idempotency_key = p_idempotency_key and o.user_id = v_user;
    if found then
      select balance_after into v_balance from public.currency_ledger
        where user_id = v_user order by id desc limit 1;
      return query select v_order, coalesce(v_balance, 0);
    end if;
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

    -- The bundle: a theme brings its frame. The grant is a zero-priced order so ownership is derived
    -- from the same ledger as every other cosmetic, and the frame is equipped when the slot is empty.
    select * into v_bundle
      from public.spend_catalog c
     where c.kind = 'frame' and c.ref_code = v_item.ref_code and c.sku <> p_sku;
    if v_bundle.sku is not null then
      insert into public.spend_orders (user_id, sku, price_paid, idempotency_key, grant_note)
        values (v_user, v_bundle.sku, 0, null, 'theme_bundle:' || v_order::text)
        on conflict (idempotency_key) do nothing;
      update public.profiles p
         set frame_key = coalesce(p.frame_key, v_item.ref_code)
       where p.id = v_user;
    end if;
  elsif v_item.kind = 'badge' then
    insert into public.user_badges (user_id, code, awarded_by)
      values (v_user, v_item.ref_code, 'purchase') on conflict do nothing;
  elsif v_item.kind = 'boost' then
    insert into public.strategy_boosts (strategy_id, buyer_id, sku, ends_at)
      values (v_item.ref_code::uuid, v_user, v_item.sku,
              now() + make_interval(hours => greatest(1, coalesce(v_item.duration_hours, 72))));
  end if;

  return query select v_order, v_balance;
end;
$$;

-- ------------------------------------------------------------ 5. admin editing gains the new fields

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
begin
  if not app.is_moderator() then raise exception 'FORBIDDEN'; end if;
  if v_sku !~ '^[a-z0-9_]{3,40}$' then raise exception 'SKU_INVALID'; end if;
  if p_kind not in ('badge', 'theme', 'boost', 'cosmetic', 'title', 'frame') then raise exception 'KIND_INVALID'; end if;
  if p_price is null or p_price < 0 then raise exception 'PRICE_INVALID'; end if;
  if p_kind = 'boost' and (p_duration_hours is null or p_duration_hours < 1) then raise exception 'DURATION_REQUIRED'; end if;
  if v_discount < 0 or v_discount > 90 then raise exception 'DISCOUNT_INVALID'; end if;
  if v_discount > 0 and p_kind = 'boost' then raise exception 'DISCOUNT_NOT_FOR_BOOSTS'; end if;
  if coalesce(p_tag, 'none') not in ('none', 'new', 'soon') then raise exception 'TAG_INVALID'; end if;

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
    v_discount, p_discount_ends_at, coalesce(p_tag, 'none')
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

create or replace function public.admin_catalog()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', c.sku, 'kind', c.kind, 'price', c.price, 'refCode', c.ref_code,
           'durationHours', c.duration_hours, 'enabled', c.enabled, 'sortOrder', c.sort_order,
           'nameTr', c.name_tr, 'nameEn', c.name_en, 'descTr', c.desc_tr, 'descEn', c.desc_en,
           'perks', c.perks, 'tag', c.tag,
           'discountPercent', c.discount_percent, 'discountEndsAt', c.discount_ends_at,
           'finalPrice', app.effective_price(c),
           'sales', (select count(*) from public.spend_orders o where o.sku = c.sku and o.status = 'filled' and o.price_paid > 0),
           'revenue', (select coalesce(sum(o.price_paid), 0) from public.spend_orders o where o.sku = c.sku and o.status = 'filled')
         ) order by c.sort_order, c.sku), '[]'::jsonb)
    from public.spend_catalog c;
$$;

-- ------------------------------------------------------------ 6. privileges

do $$
declare
  v_sig text;
  v_list text[] := array[
    'public.wallet_summary()',
    'public.spend_currency(text, text)',
    'public.admin_catalog()',
    'public.admin_upsert_catalog_item(text, text, integer, text, integer, boolean, integer, text, text, text, text, jsonb, integer, timestamptz, text)',
    'app.effective_price(public.spend_catalog)',
    'app.discount_active(public.spend_catalog)'
  ];
begin
  foreach v_sig in array v_list loop
    if to_regprocedure(v_sig) is null then
      raise notice 'skipped, no such function: %', v_sig;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end;
$$;

do $$
begin
  raise notice '0027: discounted prices are resolved server-side, themes bundle their frame, products carry a new/soon tag.';
end;
$$;
