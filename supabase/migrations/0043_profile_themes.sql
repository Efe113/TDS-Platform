-- 0043: profile themes, pronouns, and the cosmetic pins that 0037 quietly dropped.
--
-- Three things in one file, because they all land on the same surface:
--
--   1. SECURITY. 0026 pinned `active_title` and `frame_key` behind `app.cosmetic_write`, and 0017
--      pinned `theme_key` behind `app.theme_write`. When 0037 re-declared `guard_profile_columns()`
--      to add the verified columns it copied 0017's shape and both pins were lost — so any signed-in
--      member could PATCH their own profile row and hand themselves the VIP title, the rainbow frame
--      or any HUD theme. 0040 kept that shape. This file restores every pin, adds the new profile
--      theme column to the same rule, and is the canonical version from now on.
--   2. PROFILE THEMES (Discord-style personalisation, sold as its own product). A profile theme paints
--      the profile itself: banner wash, avatar ring, name glow, layered motion. The flagship `aurum`
--      arrives with VIP; `slate` with verification; `onyx` with a corporate account; `nebula` and
--      `abyss` are bought with coins. They live in `spend_catalog` as cosmetic rows keyed by
--      `ref_code`, so the till, the receipts and the ownership question stay exactly where they are.
--   3. The profile card needs the fields Discord shows: pronouns, the tier marks and the equipped
--      theme, all read from the server so every surface agrees.
--
-- Also seeds `frame_gold`, the one frame in the client registry that never had a catalog row, so it
-- can finally be bought and equipped instead of failing with NOT_FOUND.
--
-- Depends on 0040 (guard shape, equip_cosmetic, wallet_summary, profile_showcase) and 0042.
-- Safe to run twice.

-- ------------------------------------------------------------ 1. new profile columns

alter table public.profiles add column if not exists profile_theme_key text;
alter table public.profiles add column if not exists pronouns text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_pronouns_length'
  ) then
    alter table public.profiles add constraint profiles_pronouns_length check (pronouns is null or char_length(pronouns) <= 60);
  end if;
end;
$$;

-- ------------------------------------------------------------ 2. the guard, complete again

create or replace function app.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Wallet counters are written only by the ledger RPCs; RLS cannot compare OLD vs NEW,
  -- so a trigger pins the server-owned columns for every non-admin update.
  if not app.is_admin() then
    new.currency_balance_cache := old.currency_balance_cache;
    new.xp := old.xp;
    new.role := old.role;
    new.is_banned := old.is_banned;
    -- Only select_theme() moves the HUD theme, and it says so with a transaction-local flag.
    if coalesce(current_setting('app.theme_write', true), '') <> '1' then
      new.theme_key := old.theme_key;
    end if;
    -- 0026 pinned these; 0037 lost the pin while copying this function to add the verified columns.
    -- Without it a member could PATCH their own row and paint the VIP title, the rainbow frame or a
    -- bought profile theme onto their account. Every cosmetic column is pinned again, theme included.
    if coalesce(current_setting('app.cosmetic_write', true), '') <> 'on' then
      new.active_title := old.active_title;
      new.frame_key := old.frame_key;
      new.profile_theme_key := old.profile_theme_key;
    end if;
    if coalesce(current_setting('app.verified_write', true), '') <> 'on' then
      new.is_verified := old.is_verified;
      new.verified_at := old.verified_at;
      new.verified_discount_ends_at := old.verified_discount_ends_at;
      new.verified_boost_credits := old.verified_boost_credits;
    end if;
    if coalesce(current_setting('app.corporate_write', true), '') <> 'on' then
      new.is_corporate := old.is_corporate;
      new.corporate_at := old.corporate_at;
      new.corporate_discount_ends_at := old.corporate_discount_ends_at;
      new.corporate_boost_credits := old.corporate_boost_credits;
    end if;
  end if;
  -- Display name, handle, bio and pronouns stay the member's own; image paths are validated by
  -- set_profile_media, the only writer that knows the per-user storage prefix.
  new.role := app.auth_role(new.id);
  return new;
end;
$$;

-- ------------------------------------------------------------ 3. what unlocks a profile theme

-- The vocabulary lives here and in the client registry; a test compares the two. A theme is held when
-- it was bought, or when the tier that carries it is active.
create or replace function app.profile_theme_unlocked(p_user uuid, p_ref text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_ref in ('aurum', 'nebula', 'abyss', 'slate', 'onyx')
     and (
       exists (
         select 1 from public.spend_orders o
         join public.spend_catalog c on c.sku = o.sku
          where o.user_id = p_user and o.status = 'filled'
            and c.kind = 'cosmetic' and c.ref_code = p_ref
       )
       or (p_ref = 'aurum' and app.vip_active(p_user))
       or (p_ref = 'slate' and app.verified_active(p_user))
       or (p_ref = 'onyx' and app.corporate_active(p_user))
     );
$$;

-- ------------------------------------------------------------ 4. catalog rows: five themes and the missing frame

insert into public.spend_catalog (
  sku, kind, price, ref_code, enabled, sort_order,
  name_tr, name_en, desc_tr, desc_en, perks, tag
)
values
  (
    'theme_aurum', 'cosmetic', 0, 'aurum', true, 410,
    'Aurum profil teması', 'Aurum profile theme',
    'Kazınmış altın ışınlar, kayan kıvılcım alanı ve parlayan avatar halkası. VIP ile gelir.',
    'Engraved gold rays, a drifting spark field and a lit avatar ring. Comes with VIP.',
    '["VIP ile gelir","Kazınmış altın katmanları","Avatar halkası parıltısı"]'::jsonb,
    'vip'
  ),
  (
    'theme_slate', 'cosmetic', 0, 'slate', true, 411,
    'Arduvaz profil teması', 'Slate profile theme',
    'Doğrulanmış hesaplara özel yeşil metalik profil zemini.',
    'A green metallic profile ground reserved for verified accounts.',
    '["Doğrulama ile gelir","Mat yeşil metal","Sakin hareket"]'::jsonb,
    'verified'
  ),
  (
    'theme_onyx', 'cosmetic', 0, 'onyx', true, 412,
    'Oniks profil teması', 'Onyx profile theme',
    'Kurumsal hesaplara özel siyah-altın profil zemini, kalın kenarlık.',
    'A black-and-gold corporate ground with a heavy edge.',
    '["Kurumsal ile gelir","Siyah-altın","Kurum çerçevesi kalın"]'::jsonb,
    'corporate'
  ),
  (
    'theme_nebula', 'cosmetic', 1400, 'nebula', true, 413,
    'Nebula profil teması', 'Nebula profile theme',
    'Mor-mavi bulut katmanları avatarın arkasında yavaşça sürüklenir.',
    'Violet and blue cloud layers drift slowly behind the avatar.',
    '["İki katman bulut","Yavaş paralaks","Coin ile satın alınır"]'::jsonb,
    'new'
  ),
  (
    'theme_abyss', 'cosmetic', 2200, 'abyss', true, 414,
    'Abiss profil teması', 'Abyss profile theme',
    'Yıldız tozlu boşluk zeminine derinlik hizası ve soğuk kenarlık.',
    'A starfield void with a depth line and a cold rim.',
    '["Yıldız alanı","Derinlik hizası","En koyu zemin"]'::jsonb,
    'none'
  ),
  (
    'frame_gold', 'frame', 800, 'gold', true, 535,
    'Altın çerçeve', 'Gold frame',
    'Avatarın çevresinde mat altın halka ve iç parlama.',
    'A matte gold ring with an inner glow around the avatar.',
    '["Coin ile satın alınır","Mat altın halka","Statik parlama"]'::jsonb,
    'none'
  )
on conflict (sku) do update set
  kind = excluded.kind, price = excluded.price, ref_code = excluded.ref_code,
  enabled = true, sort_order = excluded.sort_order,
  name_tr = excluded.name_tr, name_en = excluded.name_en,
  desc_tr = excluded.desc_tr, desc_en = excluded.desc_en,
  perks = excluded.perks, tag = excluded.tag;

-- ------------------------------------------------------------ 5. equipping accepts the profile theme

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
  if p_kind not in ('title', 'frame', 'profile') then raise exception 'KIND_INVALID'; end if;

  if v_ref is not null then
    -- A profile theme is a cosmetic row: the product vocabulary stays put, the equip target is
    -- the registry key (0043).
    select c.sku into v_sku
      from public.spend_catalog c
     where c.kind = (case when p_kind = 'profile' then 'cosmetic' else p_kind end)
       and c.ref_code = v_ref and c.enabled;
    if v_sku is null then raise exception 'NOT_FOUND'; end if;
    if not exists (
      select 1 from public.spend_orders o
       where o.user_id = v_uid and o.sku = v_sku and o.status = 'filled'
    ) and not (
      (p_kind = 'frame' and v_ref = 'rainbow' and (app.vip_active(v_uid) or app.corporate_active(v_uid)))
      or (p_kind = 'title' and v_ref = 'vip_rainbow' and app.vip_active(v_uid))
      or (p_kind = 'title' and v_ref = 'verified_green' and app.verified_active(v_uid))
      or (p_kind = 'title' and v_ref = 'corporate' and app.corporate_active(v_uid))
      or (p_kind = 'profile' and app.profile_theme_unlocked(v_uid, v_ref))
    ) then
      raise exception 'NOT_OWNED';
    end if;
  end if;

  perform set_config('app.cosmetic_write', 'on', true);
  if p_kind = 'title' then
    update public.profiles set active_title = v_ref, updated_at = now() where id = v_uid;
  elsif p_kind = 'profile' then
    update public.profiles set profile_theme_key = v_ref, updated_at = now() where id = v_uid;
  else
    update public.profiles set frame_key = v_ref, updated_at = now() where id = v_uid;
  end if;
  perform set_config('app.cosmetic_write', 'off', true);

  return jsonb_build_object('kind', p_kind, 'ref', v_ref);
end;
$$;

-- ------------------------------------------------------------ 6. pronouns in the profile editor

create or replace function public.update_profile(
  p_display_name text default null,
  p_handle text default null,
  p_bio text default null,
  p_pronouns text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_handle text := nullif(btrim(coalesce(p_handle, '')), '');
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_bio text := nullif(btrim(coalesce(p_bio, '')), '');
  v_pronouns text := nullif(btrim(coalesce(p_pronouns, '')), '');
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if v_name is not null and char_length(v_name) > 32 then
    raise exception 'NAME_TOO_LONG';
  end if;
  if v_bio is not null and char_length(v_bio) > 600 then
    raise exception 'BIO_TOO_LONG';
  end if;
  -- Pronouns are a short, free-form mark under the name (Discord's own shape).
  if v_pronouns is not null and char_length(v_pronouns) > 60 then
    raise exception 'PRONOUNS_TOO_LONG';
  end if;
  if v_handle is not null then
    if char_length(v_handle) < 3 or char_length(v_handle) > 32 then
      raise exception 'HANDLE_INVALID';
    end if;
    if v_handle !~ '^[a-z0-9_.]+$' then
      raise exception 'HANDLE_INVALID';
    end if;
    if exists (select 1 from public.profiles p where p.handle = v_handle and p.id <> v_uid) then
      raise exception 'HANDLE_TAKEN';
    end if;
  end if;

  update public.profiles p
     set display_name = v_name,
         handle = coalesce(v_handle, p.handle),
         bio = v_bio,
         pronouns = v_pronouns,
         updated_at = now()
   where p.id = v_uid;

  return public.profile_showcase(v_uid);
end;
$$;

-- ------------------------------------------------------------ 7. readers carry the theme and the pronouns

create or replace function public.profile_showcase(p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_vip boolean := app.vip_active(p_user);
  v_verified boolean := app.verified_active(p_user);
  v_corporate boolean := app.corporate_active(p_user);
  v_badges jsonb;
  v_showcase jsonb;
  v_metrics jsonb;
  v_strategies jsonb;
begin
  select * into v_profile from public.profiles p where p.id = p_user;
  if v_profile.id is null then
    raise exception 'NOT_FOUND: no such profile';
  end if;

  if v_caller = p_user or app.is_moderator() then
    v_metrics := app.refresh_user_rollup(p_user);
  else
    select to_jsonb(r) - 'user_id' - 'updated_at' into v_metrics
      from public.stat_user_rollup r where r.user_id = p_user;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
             'code', b.code, 'name', coalesce(b.name_tr, b.name_en, b.code),
             'nameEn', coalesce(b.name_en, b.name_tr, b.code), 'desc', b.desc_tr,
             'iconPath', b.icon_path, 'awardedBy', ub.awarded_by,
             'tier', b.tier, 'awardedAt', ub.awarded_at, 'publicSlot', pb.slot
           ) order by ub.awarded_at desc), '[]'::jsonb)
    into v_badges
    from public.user_badges ub
    join public.badge_definitions b on b.code = ub.code
    left join public.public_badges pb on pb.user_id = ub.user_id and pb.code = ub.code
    where ub.user_id = p_user;

  select coalesce(jsonb_agg(jsonb_build_object('code', pb.code, 'slot', pb.slot) order by pb.slot), '[]'::jsonb)
    into v_showcase
    from public.public_badges pb where pb.user_id = p_user;

  select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'slug', s.slug, 'name', s.name, 'timesUsed', s.times_used,
             'status', s.status, 'isEventStrategy', s.is_event_strategy) order by s.times_used desc, s.name), '[]'::jsonb)
    into v_strategies
    from (
      select s.id, s.slug, s.name, s.times_used, s.status, s.is_event_strategy
        from public.strategies s
        where s.owner_id = p_user and s.status in ('approved', 'featured')
        order by s.times_used desc, s.name
        limit 5
    ) s;

  return jsonb_build_object(
    'userId', p_user,
    'handle', v_profile.handle,
    'displayName', v_profile.display_name,
    'bio', v_profile.bio,
    'pronouns', v_profile.pronouns,
    'joinedAt', v_profile.created_at,
    'themeKey', v_profile.theme_key,
    'themeName', (select t.name_tr from public.profile_themes t where t.key = v_profile.theme_key),
    'themeAccent', (select t.css ->> 'accent' from public.profile_themes t where t.key = v_profile.theme_key),
    'avatarPath', v_profile.avatar_path,
    'bannerPath', v_profile.banner_path,
    'bannerUnlocked', app.banner_unlocked(p_user),
    'vip', v_vip,
    'verified', v_verified,
    'corporate', v_corporate,
    'verifiedBoostCredits', case when v_caller = p_user or app.is_admin()
                                 then app.verified_boost_credits(p_user) + app.corporate_boost_credits(p_user)
                                 else null end,
    'customBackgroundPath', case when app.brand_background_unlocked(p_user)
                                 then v_profile.custom_background_path else null end,
    'profileTheme', v_profile.profile_theme_key,
    'profileThemeName', (select c.name_tr from public.spend_catalog c where c.kind = 'cosmetic' and c.ref_code = v_profile.profile_theme_key),
    'profileThemeNameEn', (select c.name_en from public.spend_catalog c where c.kind = 'cosmetic' and c.ref_code = v_profile.profile_theme_key),
    'titleKey', v_profile.active_title,
    'titleName', (select c.name_tr from public.spend_catalog c where c.kind = 'title' and c.ref_code = v_profile.active_title),
    'titleNameEn', (select c.name_en from public.spend_catalog c where c.kind = 'title' and c.ref_code = v_profile.active_title),
    'isSelf', v_caller = p_user,
    'metrics', coalesce(v_metrics, '{}'::jsonb),
    'badges', v_badges,
    'showcase', v_showcase,
    'strategies', v_strategies
  );
end;
$$;

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
  v_verified boolean;
  v_corporate boolean;
  v_credits integer;
  v_balance integer := 0;
  v_cached integer;
  v_rules jsonb;
  v_entries jsonb;
  v_catalog jsonb;
  v_boosts jsonb;
begin
  if v_user is null then raise exception 'ANONYMOUS: sign in first'; end if;
  v_vip := app.vip_active(v_user);
  v_verified := app.verified_active(v_user);
  v_corporate := app.corporate_active(v_user);
  v_credits := app.verified_boost_credits(v_user) + app.corporate_boost_credits(v_user);

  select coalesce(sum(l.delta), 0)::integer into v_balance from public.currency_ledger l where l.user_id = v_user;
  select p.currency_balance_cache into v_cached from public.profiles p where p.id = v_user;

  select coalesce(jsonb_agg(jsonb_build_object(
             'code', r.code, 'kind', r.kind, 'ledgerKind', r.ledger_kind, 'amount', r.amount,
             'unit', r.unit, 'icon', r.icon,
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
             'delta', e.delta, 'kind', e.kind, 'ruleCode', e.rule_code, 'refType', e.ref_type,
             'note', e.note, 'at', e.created_at
           ) order by e.id desc), '[]'::jsonb)
    into v_entries
    from (
      select l.id, l.delta, l.kind, l.rule_code, l.ref_type, l.note, l.created_at
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
               ) or (c.ref_code = 'profile_banner' and (v_vip or v_verified))
                 or app.profile_theme_unlocked(v_user, c.ref_code))
               when 'vip' then v_vip
               when 'frame' then (
                 (c.ref_code = 'rainbow' and (v_vip or v_corporate))
                 or exists (
                   select 1 from public.spend_orders o where o.user_id = v_user and o.sku = c.sku and o.status = 'filled'
                 )
               )
               when 'title' then (
                 (c.ref_code = 'vip_rainbow' and v_vip)
                 or (c.ref_code = 'verified_green' and v_verified)
                 or (c.ref_code = 'corporate' and v_corporate)
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
    'verified', v_verified,
    'corporate', v_corporate,
    'verifiedDiscountEndsAt', (select p.verified_discount_ends_at from public.profiles p where p.id = v_user),
    'corporateDiscountEndsAt', (select p.corporate_discount_ends_at from public.profiles p where p.id = v_user),
    'verifiedBoostCredits', v_credits,
    'vipBackgroundPath', case when app.brand_background_unlocked(v_user) then (
      select p.custom_background_path from public.profiles p where p.id = v_user
    ) else null end,
    'rules', v_rules, 'entries', v_entries, 'catalog', v_catalog, 'boosts', v_boosts,
    'maintenance', app.maintenance_on()
  );
end;
$$;

-- ------------------------------------------------------------ 8. privileges and reload

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'app.profile_theme_unlocked(uuid, text)'
  ] loop
    if to_regprocedure(v_sig) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', v_sig);
    end if;
  end loop;
end;
$$;

select pg_notify('pgrst', 'reload schema');

do $$
begin
  raise notice '0043: cosmetic pins restored, five profile themes live, pronouns and gold frame ready.';
end;
$$;
