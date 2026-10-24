-- 0025: the market becomes a real shop.
--
-- Three problems this fixes, all of them visible to the user:
--   1. The catalogue had no copy. The wallet listed SKUs and ref codes (`badge_strategy_author`,
--      `profile_banner`) because the product name only existed in the client's imagination. Copy now
--      lives in the database next to the price, so the admin edits it and every client reads it.
--   2. `owned` was only computed for themes, so a bought banner still showed "buy". Ownership is now
--      derived per kind: themes from user_themes, everything else from the spend_orders ledger.
--   3. There was exactly one boost package. Five packages with their own durations and prices turn a
--      single button into a decision, and `buy_boost` already reads duration_hours per SKU.
--
-- Admin editing lives here too (upsert / enable / reorder), because a catalogue the operator cannot
-- change is a hard-coded list with extra steps.

-- ------------------------------------------------------------ 1. catalogue copy

alter table public.spend_catalog add column if not exists name_tr text;
alter table public.spend_catalog add column if not exists name_en text;
alter table public.spend_catalog add column if not exists desc_tr text;
alter table public.spend_catalog add column if not exists desc_en text;
alter table public.spend_catalog add column if not exists perks jsonb not null default '[]'::jsonb;
alter table public.spend_catalog add column if not exists sort_order integer not null default 100;

-- ------------------------------------------------------------ 2. the products

insert into public.spend_catalog (sku, kind, price, ref_code, duration_hours, enabled, sort_order, name_tr, name_en, desc_tr, desc_en, perks)
values
  ('theme_ember', 'theme', 180, 'ember', null, true, 10,
   'Kor', 'Ember',
   'Sıcak near-black zemin, yükselen kıvılcımlar ve kart kenarında ısı izi.',
   'Warm near-black base, rising sparks and a heat line on card edges.',
   '["Yükselen kıvılcım sahnesi","Kart kenarında ısı","İlerleme çubuğunda akan gradyan"]'::jsonb),
  ('theme_toxic', 'theme', 220, 'toxic', null, true, 20,
   'Toksik', 'Toxic',
   'Asit yeşili vurgular, tarama bandı ve nabız gibi atan aktif öğeler.',
   'Acid green accents, a scan band and active items that pulse.',
   '["Başlıkta tarama bandı","Nabız gibi atan aktif öğe","Tehlike şeridi dokusu"]'::jsonb),
  ('theme_aurora', 'theme', 320, 'aurora', null, true, 30,
   'Kutup Işıkları', 'Aurora',
   'Derin indigo üzerinde akan teal kurdeleler ve yumuşak derinlik kayması.',
   'Teal ribbons flowing over deep indigo with a soft depth shift.',
   '["Akan kurdele katmanları","Kart kenarında konik parlama","İmleçle derinlik kayması"]'::jsonb),
  ('theme_void', 'theme', 420, 'void', null, true, 40,
   'Boşluk', 'Void',
   'Neredeyse siyah zemin, paralaks yıldız alanı ve film grenli doku.',
   'Near-black base, a parallax star field and a film-grain texture.',
   '["Üç katmanlı yıldız alanı","Kartlarda yıldız ışığı","Film grenli doku"]'::jsonb),

  ('boost_12h', 'boost', 180, null, 12, true, 110,
   '12 saatlik öne çıkarma', '12-hour boost',
   'Stratejin keşfet listesinin üstünde yarım gün kalır. Kısa etkinlikler için.',
   'Your strategy stays near the top of Discover for half a day. For short events.',
   '["12 saat üst sıra","Tek stratejiye uygulanır","Süre bitince otomatik düşer"]'::jsonb),
  ('boost_24h', 'boost', 300, null, 24, true, 120,
   '1 günlük öne çıkarma', '1-day boost',
   'Tam bir gün boyunca üst sırada kal; günlük oyuncu akışını yakala.',
   'Stay at the top for a full day and catch the daily player flow.',
   '["24 saat üst sıra","Aynı stratejide ikinci kez alınmaz","Bakiye anında düşer"]'::jsonb),
  ('boost_48h', 'boost', 480, null, 48, true, 130,
   '2 günlük öne çıkarma', '2-day boost',
   'Hafta sonu boyunca görünür kal. Hafta sonu trafiği için en verimli paket.',
   'Stay visible across a weekend - the most efficient package for weekend traffic.',
   '["48 saat üst sıra","Hafta sonu için ideal","Süre bitince otomatik düşer"]'::jsonb),
  ('boost_72h', 'boost', 600, null, 72, true, 140,
   '3 günlük öne çıkarma', '3-day boost',
   'Yeni yayınlanan bir stratejinin ilk üç gününü garantiye al.',
   'Secure the first three days of a freshly published strategy.',
   '["72 saat üst sıra","Yeni yayınlar için","Süre bitince otomatik düşer"]'::jsonb),
  ('boost_168h', 'boost', 1100, null, 168, true, 150,
   '7 günlük öne çıkarma', '7-day boost',
   'Tam bir hafta görünür kal. Uzun etkinlikler ve turnuvalar için.',
   'Stay visible for a whole week. Built for long events and tournaments.',
   '["168 saat üst sıra","Etkinlik ve turnuva için","En düşük günlük maliyet"]'::jsonb),

  ('badge_strategy_author', 'badge', 1200, 'strategy_author', null, true, 210,
   'Strateji Yazarı rozeti', 'Strategy Author badge',
   'Profilinde kalıcı olarak taşıdığın, yayıncı kimliğini gösteren rozet.',
   'A permanent badge on your profile that marks you as a publisher.',
   '["Profilde kalıcı","Vitrine eklenebilir","Yayıncı kimliği"]'::jsonb),

  ('cosmetic_banner', 'cosmetic', 250, 'profile_banner', null, true, 310,
   'Profil afişi', 'Profile banner',
   'Profilinin üst şeridine kendi görselini koy. Discord afişin olsa bile buradan açılır.',
   'Put your own image across the top of your profile. Even a Discord banner unlocks here.',
   '["Profil üst şeridi","Kendi görselini yükle","Kaldırınca Discord afişine döner"]'::jsonb)
on conflict (sku) do update set
  kind = excluded.kind,
  price = excluded.price,
  ref_code = excluded.ref_code,
  duration_hours = excluded.duration_hours,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order,
  name_tr = excluded.name_tr,
  name_en = excluded.name_en,
  desc_tr = excluded.desc_tr,
  desc_en = excluded.desc_en,
  perks = excluded.perks;

-- The old single package keeps its row if a database already sold it; it is simply no longer the only one.

-- ------------------------------------------------------------ 3. wallet summary v2

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
             'strategyId', b.strategy_id,
             'strategyName', s.name,
             'sku', b.sku,
             'endsAt', b.ends_at
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

-- ------------------------------------------------------------ 4. admin catalogue editing

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
  p_perks jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sku text := lower(btrim(coalesce(p_sku, '')));
begin
  if not app.is_moderator() then
    raise exception 'FORBIDDEN';
  end if;
  if v_sku !~ '^[a-z0-9_]{3,40}$' then
    raise exception 'SKU_INVALID';
  end if;
  if p_kind not in ('badge', 'theme', 'boost', 'cosmetic') then
    raise exception 'KIND_INVALID';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'PRICE_INVALID';
  end if;
  if p_kind = 'boost' and (p_duration_hours is null or p_duration_hours < 1) then
    raise exception 'DURATION_REQUIRED';
  end if;

  insert into public.spend_catalog as c (
    sku, kind, price, ref_code, duration_hours, enabled, sort_order, name_tr, name_en, desc_tr, desc_en, perks
  )
  values (
    v_sku, p_kind, p_price, nullif(btrim(coalesce(p_ref_code, '')), ''), p_duration_hours,
    coalesce(p_enabled, true), coalesce(p_sort_order, 100),
    nullif(btrim(coalesce(p_name_tr, '')), ''), nullif(btrim(coalesce(p_name_en, '')), ''),
    nullif(btrim(coalesce(p_desc_tr, '')), ''), nullif(btrim(coalesce(p_desc_en, '')), ''),
    coalesce(p_perks, '[]'::jsonb)
  )
  on conflict (sku) do update set
    kind = excluded.kind,
    price = excluded.price,
    ref_code = excluded.ref_code,
    duration_hours = excluded.duration_hours,
    enabled = excluded.enabled,
    sort_order = excluded.sort_order,
    name_tr = excluded.name_tr,
    name_en = excluded.name_en,
    desc_tr = excluded.desc_tr,
    desc_en = excluded.desc_en,
    perks = excluded.perks;

  return jsonb_build_object('sku', v_sku, 'price', p_price, 'kind', p_kind);
end;
$$;

create or replace function public.admin_set_catalog_enabled(p_sku text, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.is_moderator() then
    raise exception 'FORBIDDEN';
  end if;
  update public.spend_catalog set enabled = coalesce(p_enabled, false) where sku = p_sku;
  return found;
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
           'sku', c.sku,
           'kind', c.kind,
           'price', c.price,
           'refCode', c.ref_code,
           'durationHours', c.duration_hours,
           'enabled', c.enabled,
           'sortOrder', c.sort_order,
           'nameTr', c.name_tr,
           'nameEn', c.name_en,
           'descTr', c.desc_tr,
           'descEn', c.desc_en,
           'perks', c.perks,
           'sales', (select count(*) from public.spend_orders o where o.sku = c.sku and o.status = 'filled'),
           'revenue', (select coalesce(sum(o.price_paid), 0) from public.spend_orders o where o.sku = c.sku and o.status = 'filled')
         ) order by c.sort_order, c.sku), '[]'::jsonb)
    from public.spend_catalog c;
$$;

-- ------------------------------------------------------------ 5. privileges

do $$
declare
  v_sig text;
  v_list text[] := array[
    'public.wallet_summary()',
    'public.admin_catalog()',
    'public.admin_upsert_catalog_item(text, text, integer, text, integer, boolean, integer, text, text, text, text, jsonb)',
    'public.admin_set_catalog_enabled(text, boolean)'
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
  raise notice '0025: catalogue copy lives in spend_catalog, five boost packages, ownership per kind, admin editing.';
end;
$$;
