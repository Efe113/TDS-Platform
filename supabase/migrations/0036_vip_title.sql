-- 0036: a VIP title, granted by membership rather than sold as a SKU.
--
-- `spend_currency` already rejects every tag='vip' row, so the title can never be bought directly.
-- The wallet reports it as owned while `app.vip_active` is true, and equip_cosmetic accepts it through
-- the same entitlement fallback as the rainbow frame. Existing VIP members therefore get it without
-- a backfill order. Depends on 0034/0035. Safe to run twice.

-- ------------------------------------------------------------ 1. the title row

insert into public.spend_catalog (
  sku, kind, price, ref_code, duration_hours, enabled, sort_order,
  name_tr, name_en, desc_tr, desc_en, perks, tag
)
values (
  'title_vip_rainbow', 'title', 0, 'vip_rainbow', null, true, 400,
  'VIP', 'VIP',
  'Gökkuşağı animasyonlu VIP ünvanı; adının yanında akar.',
  'Animated rainbow VIP title that flows next to your name.',
  '["VIP üyelerine özel","Animasyonlu gökkuşağı","Adının yanında görünür"]'::jsonb,
  'vip'
)
on conflict (sku) do update set
  kind = 'title',
  price = 0,
  ref_code = 'vip_rainbow',
  duration_hours = null,
  enabled = true,
  sort_order = 400,
  name_tr = excluded.name_tr,
  name_en = excluded.name_en,
  desc_tr = excluded.desc_tr,
  desc_en = excluded.desc_en,
  perks = excluded.perks,
  tag = 'vip';

update public.spend_catalog
   set desc_tr = 'Tüm ürünlerde %25 indirim; gökkuşağı çerçevesi, animasyonlu VIP ünvanı, afiş ve tam uygulama arka planı.',
       desc_en = '25% off every product; rainbow frame, animated VIP title, banner and a full-app background.',
       perks = '["Tüm ürünlerde %25 indirim","Gökkuşağı çerçevesi + VIP ünvanı","Afiş + tam uygulama arka planı (GIF dahil)"]'::jsonb
 where sku = 'vip_lifetime';

-- ------------------------------------------------------------ 2. wallet ownership follows membership

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
               when 'title' then (
                 (c.ref_code = 'vip_rainbow' and v_vip)
                 or exists (
                   select 1 from public.spend_orders o where o.user_id = v_user and o.sku = c.sku and o.status = 'filled'
                 )
               )
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

-- ------------------------------------------------------------ 3. equip accepts the VIP title

create or replace function public.equip_cosmetic(p_kind text, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
  v_sku text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_kind not in ('title', 'frame') then raise exception 'KIND_INVALID'; end if;

  if v_ref is not null then
    select c.sku into v_sku
      from public.spend_catalog c
     where c.kind = p_kind and c.ref_code = v_ref and c.enabled;
    if v_sku is null then raise exception 'NOT_FOUND'; end if;
    if not exists (
      select 1 from public.spend_orders o
       where o.user_id = v_uid and o.sku = v_sku and o.status = 'filled'
    ) and not (
      (p_kind = 'frame' and v_ref = 'rainbow' and app.vip_active(v_uid))
      or (p_kind = 'title' and v_ref = 'vip_rainbow' and app.vip_active(v_uid))
    ) then
      raise exception 'NOT_OWNED';
    end if;
  end if;

  perform set_config('app.cosmetic_write', 'on', true);
  if p_kind = 'title' then
    update public.profiles set active_title = v_ref, updated_at = now() where id = v_uid;
  else
    update public.profiles set frame_key = v_ref, updated_at = now() where id = v_uid;
  end if;
  perform set_config('app.cosmetic_write', 'off', true);

  return jsonb_build_object('kind', p_kind, 'ref', v_ref);
end;
$$;

select pg_notify('pgrst', 'reload schema');
