-- 0032: VIP membership, the rainbow frame as a VIP benefit, and VIP-only custom backgrounds.
--
-- Why membership is derived from spend_orders: the shop already has one audited purchase path, one
-- idempotency key and one ledger. A `profiles.is_vip` boolean would be a second truth that a bug or a
-- client could set without paying. `app.vip_active()` answers the same question from the receipt.
--
-- Why the background file is not re-encoded here: storage is the client's job (GIF needs to stay a
-- GIF); SQL only guards the column, the path prefix and the entitlement.

-- ------------------------------------------------------------ 1. kinds, tags, price floor

alter table public.spend_catalog drop constraint if exists spend_catalog_kind_check;
alter table public.spend_catalog add constraint spend_catalog_kind_check
  check (kind in ('badge', 'theme', 'boost', 'cosmetic', 'title', 'frame', 'vip'));

alter table public.spend_catalog drop constraint if exists spend_catalog_tag_check;
alter table public.spend_catalog add constraint spend_catalog_tag_check
  check (tag in ('none', 'new', 'soon', 'vip'));

-- VIP-only rows carry no coin price; the 0 is a shelf placeholder, not a free purchase.
alter table public.spend_catalog drop constraint if exists spend_catalog_price_check;
do $$
declare
  v_name text;
begin
  -- The constraint is auto-named by the original create table; drop it by definition as a fallback.
  for v_name in
    select conname from pg_constraint
     where conrelid = 'public.spend_catalog'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%price > 0%'
  loop
    execute format('alter table public.spend_catalog drop constraint %I', v_name);
  end loop;
end;
$$;
alter table public.spend_catalog add constraint spend_catalog_price_check check (price >= 0);

-- ------------------------------------------------------------ 2. columns and helpers

alter table public.profiles add column if not exists custom_background_path text;

create or replace function app.vip_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.spend_orders o
      join public.spend_catalog c on c.sku = o.sku
     where o.user_id = p_user and o.status = 'filled' and c.kind = 'vip'
  );
$$;

-- ------------------------------------------------------------ 3. products

insert into public.spend_catalog (
  sku, kind, price, ref_code, enabled, sort_order,
  name_tr, name_en, desc_tr, desc_en, perks, tag
)
values (
  'vip_lifetime', 'vip', 5000, 'vip', true, 5,
  'VIP Üyelik', 'VIP Membership',
  'Gökkuşağı çerçevesi ve VIP özel arka plan erişimi.',
  'Rainbow frame and VIP custom background access.',
  '["Gökkuşağı çerçevesi","Özel arka plan (GIF dahil)","Kalıcı VIP erişimi"]'::jsonb,
  'new'
)
on conflict (sku) do update set
  kind = 'vip', price = 5000, ref_code = 'vip', enabled = true, sort_order = 5,
  name_tr = excluded.name_tr, name_en = excluded.name_en,
  desc_tr = excluded.desc_tr, desc_en = excluded.desc_en,
  perks = excluded.perks;

-- The frame is seeded again so this file works even if 0031 was never run; the price is zero because
-- the till refuses tag='vip' anyway and the card hides a coin price for VIP items.
insert into public.spend_catalog (
  sku, kind, price, ref_code, enabled, sort_order,
  name_tr, name_en, desc_tr, desc_en, perks, tag
)
values (
  'frame_rainbow', 'frame', 0, 'rainbow', true, 530,
  'Gökkuşağı çerçevesi', 'Rainbow frame',
  'Avatarının çevresinde dönen, yörüngede ışıldayan gökkuşağı halkası.',
  'A luminous spectrum ring with orbiting sparks around your avatar.',
  '["VIP üyeliğe dahil","Animasyonlu gökkuşağı halkası","Tüm profillerde"]'::jsonb,
  'vip'
)
on conflict (sku) do update set
  kind = 'frame', price = 0, ref_code = 'rainbow', enabled = true, sort_order = 530,
  name_tr = excluded.name_tr, name_en = excluded.name_en,
  desc_tr = excluded.desc_tr, desc_en = excluded.desc_en,
  perks = excluded.perks, tag = 'vip';

update public.spend_catalog
   set price = 0, tag = 'vip'
 where kind = 'frame' and ref_code = 'rainbow';

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
  -- A VIP-tagged row is a benefit, not a SKU: it can only arrive through a membership purchase.
  if v_item.tag = 'vip' then
    raise exception 'VIP_ONLY: % is a VIP benefit', p_sku;
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

-- ------------------------------------------------------------ 5. frame equipping accepts VIP

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
    ) and not (p_kind = 'frame' and v_ref = 'rainbow' and app.vip_active(v_uid)) then
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

-- ------------------------------------------------------------ 6. profile reads carry VIP + background

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
    'joinedAt', v_profile.created_at,
    'themeKey', v_profile.theme_key,
    'themeName', (select t.name_tr from public.profile_themes t where t.key = v_profile.theme_key),
    'themeAccent', (select t.css ->> 'accent' from public.profile_themes t where t.key = v_profile.theme_key),
    'avatarPath', v_profile.avatar_path,
    'bannerPath', v_profile.banner_path,
    'bannerUnlocked', app.banner_unlocked(p_user),
    'vip', v_vip,
    'customBackgroundPath', case when v_vip then v_profile.custom_background_path else null end,
    'titleKey', v_profile.active_title,
    'titleName', (select c.name_tr from public.spend_catalog c where c.kind = 'title' and c.ref_code = v_profile.active_title),
    'frameKey', v_profile.frame_key,
    'isSelf', v_caller = p_user,
    'metrics', coalesce(v_metrics, '{}'::jsonb),
    'badges', v_badges,
    'showcase', v_showcase,
    'strategies', v_strategies
  );
end;
$$;

-- ------------------------------------------------------------ 7. media writes

create or replace function public.set_profile_media(p_kind text, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
  v_prefix text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_kind not in ('avatar', 'banner', 'background') then
    raise exception 'KIND_INVALID';
  end if;

  v_prefix := case
    when p_kind = 'avatar' then 'avatars'
    when p_kind = 'banner' then 'banners'
    else 'backgrounds'
  end;

  if v_path is not null then
    if v_path !~ ('^' || v_prefix || '/' || v_uid::text || '/[A-Za-z0-9._-]+$') then
      raise exception 'PATH_INVALID';
    end if;
    if p_kind = 'banner' and not app.banner_unlocked(v_uid) then
      raise exception 'BANNER_LOCKED';
    end if;
    if p_kind = 'background' and not app.vip_active(v_uid) then
      raise exception 'VIP_REQUIRED';
    end if;
  end if;

  if p_kind = 'avatar' then
    update public.profiles set avatar_path = v_path, updated_at = now() where id = v_uid;
  elsif p_kind = 'banner' then
    update public.profiles set banner_path = v_path, updated_at = now() where id = v_uid;
  else
    update public.profiles set custom_background_path = v_path, updated_at = now() where id = v_uid;
  end if;

  return public.profile_showcase(v_uid);
end;
$$;

-- ------------------------------------------------------------ 8. storage prefixes

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'objects') then
    execute 'drop policy if exists tds_media_insert_own on storage.objects';
    execute 'drop policy if exists tds_media_update_own on storage.objects';
    execute 'drop policy if exists tds_media_delete_own on storage.objects';

    execute $p$
      create policy tds_media_insert_own on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'strategy-media'
          and (
            name like ('avatars/' || auth.uid()::text || '/%')
            or name like ('banners/' || auth.uid()::text || '/%')
            or (app.vip_active(auth.uid()) and name like ('backgrounds/' || auth.uid()::text || '/%'))
          )
        )
    $p$;

    execute $p$
      create policy tds_media_update_own on storage.objects
        for update to authenticated
        using (
          bucket_id = 'strategy-media'
          and (
            name like ('avatars/' || auth.uid()::text || '/%')
            or name like ('banners/' || auth.uid()::text || '/%')
            or (app.vip_active(auth.uid()) and name like ('backgrounds/' || auth.uid()::text || '/%'))
          )
        )
    $p$;

    execute $p$
      create policy tds_media_delete_own on storage.objects
        for delete to authenticated
        using (
          bucket_id = 'strategy-media'
          and (
            name like ('avatars/' || auth.uid()::text || '/%')
            or name like ('banners/' || auth.uid()::text || '/%')
            or name like ('backgrounds/' || auth.uid()::text || '/%')
          )
        )
    $p$;
  else
    raise notice '0032: storage schema not found, media policies skipped.';
  end if;
end;
$$;

-- ------------------------------------------------------------ 9. admin editing accepts VIP

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
  if p_kind not in ('badge', 'theme', 'boost', 'cosmetic', 'title', 'frame', 'vip') then raise exception 'KIND_INVALID'; end if;
  if p_price is null or p_price < 0 then raise exception 'PRICE_INVALID'; end if;
  if p_kind = 'boost' and (p_duration_hours is null or p_duration_hours < 1) then raise exception 'DURATION_REQUIRED'; end if;
  if v_discount < 0 or v_discount > 90 then raise exception 'DISCOUNT_INVALID'; end if;
  if v_discount > 0 and p_kind = 'boost' then raise exception 'DISCOUNT_NOT_FOR_BOOSTS'; end if;
  if coalesce(p_tag, 'none') not in ('none', 'new', 'soon', 'vip') then raise exception 'TAG_INVALID'; end if;

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
