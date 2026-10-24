-- 0034: VIP perks that touch the whole economy and shell.
--
-- 1. VIP automatically unlocks the banner. The existing banner helper derived ownership from the
--    cosmetic_banner order only, so VIP would still see a locked uploader.
-- 2. VIP prices are 25% lower for every catalog item except the membership itself. The discount is
--    applied after a product discount, in the same `effective_price` helper the shop displays and the
--    till charges, so the card and the receipt cannot disagree.
-- 3. The wallet summary exposes `vip` and the current user's custom background path; the renderer
--    paints that path behind the whole app (not just the profile hero). The path is returned only
--    while VIP is active, so revoking the tier hides it without deleting the file.
--
-- Depends on 0032 (VIP kind/tag, app.vip_active, custom_background_path). Safe to run twice.

-- ------------------------------------------------------------ 1. VIP-aware pricing

create or replace function app.effective_price(p_item public.spend_catalog)
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
  with base as (
    select case
      when p_item.kind = 'boost' then p_item.price
      when p_item.discount_percent > 0
        and (p_item.discount_ends_at is null or p_item.discount_ends_at > now())
        then greatest(1, ceil(p_item.price * (100 - p_item.discount_percent) / 100.0)::integer)
      else p_item.price
    end as price
  )
  select case
    when price <= 0 then price
    when p_item.kind <> 'vip' and app.vip_active(auth.uid())
      then greatest(1, ceil(price * 75 / 100.0)::integer)
    else price
  end
  from base;
$$;

-- ------------------------------------------------------------ 2. VIP unlocks the banner

create or replace function app.banner_unlocked(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.spend_orders o
     where o.user_id = p_user and o.sku = 'cosmetic_banner' and o.status = 'filled'
  ) or app.vip_active(p_user);
$$;

-- ------------------------------------------------------------ 3. wallet carries VIP context

create or replace function public.wallet_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_vip boolean;
  v_balance integer := 0;
  v_cached integer;
  v_rules jsonb;
  v_entries jsonb;
  v_catalog jsonb;
  v_boosts jsonb;
begin
  if v_user is null then raise exception 'ANONYMOUS: sign in first'; end if;
  v_vip := app.vip_active(v_user);

  select coalesce(sum(l.delta), 0)::integer into v_balance from public.currency_ledger l where l.user_id = v_user;
  select p.currency_balance_cache into v_cached from public.profiles p where p.id = v_user;

  select coalesce(jsonb_agg(jsonb_build_object(
             'code', r.code, 'kind', r.kind, 'amount', r.amount,
             'unit', r.unit,
             'name', r.name_tr, 'nameEn', r.name_en, 'desc', r.desc_tr, 'descEn', r.desc_en,
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
             'delta', e.delta, 'kind', e.kind, 'ruleCode', e.rule_code, 'refType', e.ref_type, 'at', e.created_at
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
             'sku', c.sku, 'kind', c.kind, 'price', c.price,
             'finalPrice', app.effective_price(c),
             'discountPercent', case when app.discount_active(c) then c.discount_percent else 0 end,
             'discountEndsAt', case when app.discount_active(c) then c.discount_ends_at else null end,
             'tag', c.tag, 'refCode', c.ref_code, 'durationHours', c.duration_hours,
             'name', c.name_tr, 'nameEn', c.name_en, 'desc', c.desc_tr, 'descEn', c.desc_en,
             'perks', c.perks, 'sortOrder', c.sort_order,
             'owned', case c.kind
               when 'theme' then (c.price = 0 or exists (
                 select 1 from public.user_themes ut where ut.user_id = v_user and ut.theme_key = c.ref_code))
               when 'cosmetic' then (exists (
                 select 1 from public.spend_orders o where o.user_id = v_user and o.sku = c.sku and o.status = 'filled'
               ) or (c.ref_code = 'profile_banner' and v_vip))
               else exists (
                 select 1 from public.spend_orders o where o.user_id = v_user and o.sku = c.sku and o.status = 'filled')
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
    'balance', v_balance, 'cached', v_cached,
    'reconciled', (v_cached is null or v_cached = v_balance),
    'theme', (select p.theme_key from public.profiles p where p.id = v_user),
    'themeAccent', (select t.css ->> 'accent' from public.profiles p join public.profile_themes t on t.key = p.theme_key where p.id = v_user),
    'vip', v_vip,
    'vipBackgroundPath', case when v_vip then (
      select p.custom_background_path from public.profiles p where p.id = v_user
    ) else null end,
    'rules', v_rules, 'entries', v_entries, 'catalog', v_catalog, 'boosts', v_boosts,
    'maintenance', app.maintenance_on()
  );
end;
$$;

-- ------------------------------------------------------------ 4. VIP shop copy

update public.spend_catalog
   set desc_tr = 'Tüm ürünlerde %25 indirim; gökkuşağı çerçevesi, afiş ve tam uygulama arka planı.',
       desc_en = '25% off every product; rainbow frame, banner and a full-app background.',
       perks = '["Tüm ürünlerde %25 indirim","Gökkuşağı çerçevesi + afiş","Tam uygulama arka planı (GIF dahil)"]'::jsonb
 where sku = 'vip_lifetime';
