-- 0016: economy that a client cannot print money from, plus the wallet and boost calls it needs.
--
-- 1. SECURITY: award_currency was granted to `authenticated`. Its own guard only says "you may
--    award to yourself", and the amount is clamped to the rule (`least(p_amount, v_rule.amount)`)
--    and to the daily cap - so any signed-in user could mint up to the cap every day for free with
--    fresh idempotency keys, without publishing or playing anything. The function stays for the
--    definer paths that legitimately call it (flush_usage awards inside its own transaction, and
--    those run as the function owner, so this revoke does not touch them) and for admins.
--
-- 2. BUG: the seeded `boost_72h` row has ref_code = null, and spend_currency's boost branch inserts
--    `strategy_boosts.strategy_id = v_item.ref_code::uuid` - i.e. NULL into a NOT NULL column.
--    Buying a boost through spend_currency could never succeed, and a catalog row cannot know which
--    strategy the buyer wants to promote anyway. Hence buy_boost(p_strategy_id, p_sku, ...): the
--    target is chosen at purchase time, the duration comes from spend_catalog.duration_hours
--    (admin-editable, seeded to 72 for boost_72h), and strategy_boosts.order_id makes a replay of
--    the same idempotency key resolvable instead of double-charging.
--
-- 3. wallet_summary() returns the whole page in one jsonb payload: authoritative balance from the
--    ledger, the cached column it must agree with, per-rule earnings against the caps, the last
--    ledger entries, the catalog with an owned flag, and the caller's active boosts. jsonb (not
--    `returns table`) on purpose: OUT parameter names are plpgsql variables, and a name like
--    `ends_at` would collide with the column of the same name - the exact bug that broke
--    flush_usage for its whole life (0015).

-- ------------------------------------------------------------ 1. minting is not a client API

revoke execute on function public.award_currency(uuid, text, integer, text, text, text) from authenticated, anon;

-- ------------------------------------------------------------ 2. boost shape

alter table public.spend_catalog add column if not exists duration_hours integer;
alter table public.strategy_boosts add column if not exists order_id uuid;

update public.spend_catalog set duration_hours = 72 where sku = 'boost_72h' and duration_hours is null;

-- ------------------------------------------------------------ 3. buy a boost for one strategy

create or replace function public.buy_boost(
  p_strategy_id uuid,
  p_sku text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_item public.spend_catalog%rowtype;
  v_strategy public.strategies%rowtype;
  v_existing uuid;
  v_existing_ends timestamptz;
  v_order uuid;
  v_boost uuid;
  v_ends timestamptz;
  v_balance integer;
  v_hours integer;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;

  -- A replayed key returns the original purchase instead of charging a second time.
  if p_idempotency_key is not null then
    select o.id into v_order
      from public.spend_orders o
      where o.idempotency_key = p_idempotency_key and o.user_id = v_user;
    if v_order is not null then
      select b.id, b.ends_at into v_boost, v_existing_ends
        from public.strategy_boosts b
        where b.order_id = v_order;
      select coalesce(sum(l.delta), 0)::integer into v_balance
        from public.currency_ledger l where l.user_id = v_user;
      return jsonb_build_object(
        'replayed', true,
        'boostId', v_boost,
        'endsAt', v_existing_ends,
        'balance', v_balance
      );
    end if;
  end if;

  select * into v_item
    from public.spend_catalog c
    where c.sku = p_sku and c.enabled;
  if v_item.sku is null then
    raise exception 'UNKNOWN_SKU: %', p_sku;
  end if;
  if v_item.kind <> 'boost' then
    raise exception 'NOT_A_BOOST: % is a % item', p_sku, v_item.kind;
  end if;

  select * into v_strategy from public.strategies s where s.id = p_strategy_id;
  if v_strategy.id is null then
    raise exception 'NOT_FOUND: no such strategy';
  end if;
  if v_strategy.status not in ('approved', 'featured') then
    raise exception 'NOT_PUBLISHED: only published strategies can be boosted';
  end if;

  if exists (
    select 1 from public.strategy_boosts b
      where b.strategy_id = p_strategy_id
        and b.buyer_id = v_user
        and b.status = 'active'
        and b.ends_at > now()
  ) then
    raise exception 'ALREADY_BOOSTED: you already have an active boost on this strategy';
  end if;

  v_hours := greatest(1, coalesce(v_item.duration_hours, 72));
  v_ends := now() + make_interval(hours => v_hours);

  insert into public.spend_orders (user_id, sku, price_paid, idempotency_key)
    values (v_user, p_sku, v_item.price, nullif(p_idempotency_key, ''))
    returning id into v_order;

  -- ledger_append raises INSUFFICIENT_FUNDS before any row is committed, so a rejected purchase
  -- leaves no order behind: the whole function is one transaction.
  v_balance := app.ledger_append(v_user, -v_item.price, 'spend', p_sku, 'order', v_order::text,
                                 nullif(p_idempotency_key, '') || ':ledger', v_user::text);

  insert into public.strategy_boosts (strategy_id, buyer_id, sku, starts_at, ends_at, status, order_id)
    values (p_strategy_id, v_user, p_sku, now(), v_ends, 'active', v_order)
    returning id into v_boost;

  return jsonb_build_object(
    'replayed', false,
    'boostId', v_boost,
    'strategyId', p_strategy_id,
    'endsAt', v_ends,
    'pricePaid', v_item.price,
    'balance', v_balance
  );
end;
$$;

grant execute on function public.buy_boost(uuid, text, text) to authenticated;

-- ------------------------------------------------------------ 4. one payload for the wallet page

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
             'code', r.code,
             'kind', r.kind,
             'amount', r.amount,
             'dailyCap', r.daily_cap,
             'weeklyCap', r.weekly_cap,
             'earnedToday', coalesce(t.today, 0),
             'earnedWeek', coalesce(t.week, 0)
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
             'delta', e.delta,
             'kind', e.kind,
             'ruleCode', e.rule_code,
             'refType', e.ref_type,
             'at', e.created_at
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
             'refCode', c.ref_code,
             'durationHours', c.duration_hours,
             'owned', (c.kind = 'theme' and (c.price = 0 or (c.ref_code is not null and exists (
                select 1 from public.user_themes ut
                  where ut.user_id = v_user and ut.theme_key = c.ref_code
             ))))
           ) order by c.kind, c.price), '[]'::jsonb)
    into v_catalog
    from public.spend_catalog c
    where c.enabled;

  select coalesce(jsonb_agg(jsonb_build_object(
             'strategyId', b.strategy_id,
             'strategyName', b.strategy_name,
             'sku', b.sku,
             'endsAt', b.ends_at
           ) order by b.ends_at desc), '[]'::jsonb)
    into v_boosts
    from (
      select sb.strategy_id, sb.sku, sb.ends_at, s.name as strategy_name
        from public.strategy_boosts sb
        join public.strategies s on s.id = sb.strategy_id
        where sb.buyer_id = v_user and sb.status = 'active' and sb.ends_at > now()
        order by sb.ends_at desc
        limit 20
    ) b;

  return jsonb_build_object(
    'balance', v_balance,
    'cached', v_cached,
    'reconciled', coalesce(v_cached, 0) = v_balance,
    'rules', v_rules,
    'entries', v_entries,
    'catalog', v_catalog,
    'boosts', v_boosts
  );
end;
$$;

grant execute on function public.wallet_summary() to authenticated;
