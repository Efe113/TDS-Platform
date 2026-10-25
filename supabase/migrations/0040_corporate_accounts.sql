-- 0040: corporate accounts — the tier above a verified one, and it is a superset of it.
--
-- A verified account is a person the team vouched for. A corporate account is an organisation: it
-- publishes several strategies, wants its brand on the profile, and needs promotion slots for more
-- than one of them. So the tier is not a parallel feature set bolted next to verification, it is
-- verification plus the parts an organisation actually uses:
--
--   * the tick everywhere (app.verified_active() now answers yes for corporate too, so every surface
--     built on 0037 inherits the mark without a second branch at each call site),
--   * an animated gold `Kurumsal` title that replaces the green one while it is equipped,
--   * the VIP visual ground without buying VIP: rainbow frame, profile banner, custom background,
--   * 60 days of 20% off everything — which replaces the verified 10% instead of stacking with it,
--     and still multiplies with the VIP 25%,
--   * three 7-day promotion credits instead of one 3-day credit; the corporate credit is burned first
--     because it is the one that will lapse,
--   * corporate authors ranked above verified authors in Discover, inside the same "verified" filter.
--
-- Granting corporate also grants verification (an organisation is trusted by definition), and revoking
-- corporate leaves the verification alone: they are separate judgements with separate columns.
--
-- Depends on 0037 (tier columns, applications, benefit tags) and 0039 (wallet ownership by tier).
-- Safe to run twice.

-- ------------------------------------------------------------ 1. admin-pinned columns

alter table public.profiles add column if not exists is_corporate boolean not null default false;
alter table public.profiles add column if not exists corporate_at timestamptz;
alter table public.profiles add column if not exists corporate_discount_ends_at timestamptz;
alter table public.profiles add column if not exists corporate_boost_credits integer not null default 0;

-- The same guard as 0037 with one more pinned group: no client may write its own corporate flag, and
-- only the grant RPC raises the escape hatch.
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
    -- Verification itself stays admin-only. The credit counter is the one column a signed-in user
    -- may burn through, and only from inside claim_verified_boost, which raises this GUC.
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
  new.role := app.auth_role(new.id);
  return new;
end;
$$;

-- ------------------------------------------------------------ 2. entitlement helpers

create or replace function app.corporate_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p where p.id = p_user and p.is_corporate
  );
$$;

-- The discount is the only part of either tier that expires; a lapsed grant prices normally.
create or replace function app.corporate_discount_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_user and p.is_corporate and p.corporate_discount_ends_at > now()
  );
$$;

create or replace function app.corporate_boost_credits(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p.corporate_boost_credits, 0) from public.profiles p where p.id = p_user;
$$;

-- Corporate is the superset: every surface that asks "is this account trusted" gets one answer.
create or replace function app.verified_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p where p.id = p_user and (p.is_verified or p.is_corporate)
  );
$$;

-- 90% for a verified member, but a corporate account already pays 80%. Two discounts for one trust
-- judgement would price an organisation below a VIP, so the verified pass goes quiet when corporate
-- is held.
create or replace function app.verified_discount_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_user and p.is_verified and p.verified_discount_ends_at > now() and not p.is_corporate
  );
$$;

-- ------------------------------------------------------------ 3. pricing and unlocks

-- Four passes, each multiplicative: the shelf cut, then verified 10% (or corporate 20% instead of it),
-- then VIP 25%. A corporate VIP pays 0.8 * 0.75 = 60% of the discounted base. Membership is never
-- discounted by a tier.
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
  ),
  verified_pass as (
    select case
      when price <= 0 then price
      when p_item.kind <> 'vip' and app.verified_discount_active(auth.uid())
        then greatest(1, ceil(price * 90 / 100.0)::integer)
      else price
    end as price
    from base
  ),
  corporate_pass as (
    select case
      when price <= 0 then price
      when p_item.kind <> 'vip' and app.corporate_discount_active(auth.uid())
        then greatest(1, ceil(price * 80 / 100.0)::integer)
      else price
    end as price
    from verified_pass
  )
  select case
    when price <= 0 then price
    when p_item.kind <> 'vip' and app.vip_active(auth.uid())
      then greatest(1, ceil(price * 75 / 100.0)::integer)
    else price
  end
  from corporate_pass;
$$;

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
  ) or app.vip_active(p_user) or app.verified_active(p_user);
$$;

-- The brand image. VIP bought it; an organisation gets it with the tier, because a studio without its
-- own backdrop is a studio that cannot show its logo.
create or replace function app.brand_background_unlocked(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.vip_active(p_user) or app.corporate_active(p_user);
$$;

-- ------------------------------------------------------------ 4. catalog rows for the tier

alter table public.spend_catalog drop constraint if exists spend_catalog_tag_check;
alter table public.spend_catalog add constraint spend_catalog_tag_check
  check (tag in ('none', 'new', 'soon', 'vip', 'verified', 'corporate'));

-- The gold title. tag='corporate' keeps it off the shelf: the till refuses every benefit-tagged row,
-- so the only way in is the grant below.
insert into public.spend_catalog (
  sku, kind, price, ref_code, enabled, sort_order,
  name_tr, name_en, desc_tr, desc_en, perks, tag
)
values (
  'title_corporate', 'title', 0, 'corporate', true, 388,
  'Kurumsal', 'Corporate',
  'Altın animasyonlu kurumsal ünvanı; doğrulanmış ünvanın yerini alır.',
  'Animated gold corporate title; it takes the place of the verified one.',
  '["Kurumsal hesaplara otomatik","Animasyonlu altın","Marka çerçevesiyle birlikte"]'::jsonb,
  'corporate'
)
on conflict (sku) do update set
  kind = 'title', price = 0, ref_code = 'corporate', enabled = true, sort_order = 388,
  name_tr = excluded.name_tr, name_en = excluded.name_en,
  desc_tr = excluded.desc_tr, desc_en = excluded.desc_en,
  perks = excluded.perks, tag = 'corporate';

-- The receipt row a corporate promotion credit books itself against. Disabled on purpose: it is a
-- ledger vocabulary, not a product (strategy_boosts.sku has a foreign key into this table).
insert into public.spend_catalog (
  sku, kind, price, ref_code, duration_hours, enabled, sort_order,
  name_tr, name_en, desc_tr, desc_en, perks, tag
)
values (
  'boost_corporate_168h', 'boost', 0, null, 168, false, 109,
  'Kurumsal öne çıkarma kredisi', 'Corporate promotion credit',
  'Kurumsal hesaba gelen 7 günlük öne çıkarma; cüzdan kredi olarak görünür.',
  'The 7-day promotion that arrives with the corporate tier; held as a wallet credit.',
  '["Kurumsal hediye","7 gün öne çıkarma","Üç kredi birden"]'::jsonb,
  'corporate'
)
on conflict (sku) do update set
  kind = 'boost', price = 0, duration_hours = 168, enabled = false, sort_order = 109,
  name_tr = excluded.name_tr, name_en = excluded.name_en,
  desc_tr = excluded.desc_tr, desc_en = excluded.desc_en,
  perks = excluded.perks, tag = 'corporate';

-- ------------------------------------------------------------ 5. the badge and the application queue

-- The console editor validated its own tag list (0032), so it refused `verified` and would refuse
-- `corporate` even though the CHECK allows both. The list now lives beside the constraint it mirrors.
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

insert into public.badge_definitions (code, name_tr, name_en, desc_tr, icon_path, tier, conditions, award_mode, active)
values ('corporate', 'Kurumsal Hesap', 'Corporate Account',
        'Ekip onaylı kurumsal hesap; altın ünvan, marka zemini ve üç öne çıkarma kredisiyle gelir.', 'building', 'special',
        '{"metric":"staff","operator":"eq","value":"corporate"}'::jsonb, 'manual', true)
on conflict (code) do update set
  name_tr = excluded.name_tr, name_en = excluded.name_en, desc_tr = excluded.desc_tr,
  icon_path = excluded.icon_path, tier = 'special', award_mode = 'manual', active = true;

-- ------------------------------------------------------------ 6. the grant

-- One body for both doors (manual admin switch and an approved application), so they cannot drift.
-- Internal, like app.apply_verification: never granted to a role.
create or replace function app.apply_corporate(
  p_user uuid,
  p_on boolean,
  p_credits integer default null,
  p_actor uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.profiles%rowtype;
  v_days integer := 60;
  v_grant integer := 3;
  v_credits integer;
  v_frame_sku text;
begin
  select * into v_target from public.profiles p where p.id = p_user;
  if v_target.id is null then
    raise exception 'NOT_FOUND: no such profile';
  end if;

  if not p_on then
    -- An organisation loses its brand kit, not the team's judgement of it: verification stays where
    -- it was, and an operator revokes that separately if the whole account is untrusted.
    perform set_config('app.corporate_write', 'on', true);
    perform set_config('app.cosmetic_write', 'on', true);

    select c.sku into v_frame_sku
      from public.spend_catalog c
     where c.kind = 'frame' and c.ref_code = 'rainbow'
     limit 1;
    if v_frame_sku is not null then
      update public.spend_orders
         set status = 'reversed'
       where user_id = p_user and sku = v_frame_sku and status = 'filled'
         and coalesce(grant_note, '') like 'corporate:%';
    end if;

    update public.profiles
       set is_corporate = false,
           corporate_at = null,
           corporate_discount_ends_at = null,
           corporate_boost_credits = 0,
           active_title = case
             when active_title = 'corporate' then
               case when is_verified then 'verified_green' else null end
             else active_title
           end,
           frame_key = case
             -- Only the frame this tier handed out is taken back; a purchased one is the member's.
             when frame_key = 'rainbow'
               and not app.vip_active(p_user)
               and not exists (
                 select 1 from public.spend_orders o
                  where o.user_id = p_user and o.status = 'filled'
                    and o.sku in (select c2.sku from public.spend_catalog c2
                                   where c2.kind = 'frame' and c2.ref_code = 'rainbow')
               )
             then null
             else frame_key
           end,
           updated_at = now()
     where id = p_user;
    perform set_config('app.cosmetic_write', 'off', true);
    perform set_config('app.corporate_write', 'off', true);

    return jsonb_build_object('userId', p_user, 'corporate', false, 'credits', 0);
  end if;

  -- Verification is implied, and it is granted through its own function so the tick, the badge and
  -- the credit ledger behave exactly as they do for a verified member.
  perform app.apply_verification(p_user, true, null, p_actor, coalesce(p_reason, 'corporate'));

  v_credits := greatest(0, coalesce(
    p_credits,
    v_target.corporate_boost_credits + case when v_target.is_corporate then 0 else v_grant end
  ));

  perform set_config('app.corporate_write', 'on', true);
  perform set_config('app.cosmetic_write', 'on', true);
  update public.profiles
     set is_corporate = true,
         corporate_at = coalesce(corporate_at, now()),
         corporate_discount_ends_at = greatest(
           coalesce(corporate_discount_ends_at, now()), now() + make_interval(days => v_days)
         ),
         corporate_boost_credits = v_credits,
         -- The gold title is the tier's mark, so it takes the slot a green one was holding.
         active_title = case
           when coalesce(active_title, '') in ('', 'verified_green') then 'corporate'
           else active_title
         end,
         updated_at = now()
   where id = p_user;

  -- The rainbow frame arrives as a zero-priced order, exactly the way the VIP bundle records it, so
  -- ownership stays in one ledger.
  insert into public.spend_orders (user_id, sku, price_paid, idempotency_key, grant_note)
  select p_user, c.sku, 0, null, 'corporate:' || coalesce(p_actor::text, 'system')
    from public.spend_catalog c
   where c.kind = 'frame' and c.ref_code = 'rainbow'
     and not exists (
       select 1 from public.spend_orders o
        where o.user_id = p_user and o.sku = c.sku and o.status = 'filled'
     )
   order by c.enabled desc, c.sort_order
   limit 1;

  update public.profiles p
     set frame_key = coalesce(p.frame_key, 'rainbow'), updated_at = now()
   where p.id = p_user;
  perform set_config('app.cosmetic_write', 'off', true);
  perform set_config('app.corporate_write', 'off', true);

  insert into public.user_badges (user_id, code, awarded_by)
    values (p_user, 'corporate', case when p_actor is null then 'system' else 'admin' end)
    on conflict do nothing;

  return jsonb_build_object(
    'userId', p_user, 'corporate', true, 'credits', v_credits,
    'discountEndsAt', (select corporate_discount_ends_at from public.profiles where id = p_user),
    'reason', p_reason
  );
end;
$$;

-- ------------------------------------------------------------ 7. the doors

create or replace function public.admin_set_corporate(
  p_user uuid,
  p_corporate boolean,
  p_credits integer default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user = v_uid then raise exception 'SELF_FORBIDDEN'; end if;
  if coalesce(p_corporate, false) then
    v_result := app.apply_corporate(p_user, true, p_credits, v_uid, p_note);
  else
    v_result := app.apply_corporate(p_user, false, null, v_uid, p_note);
  end if;
  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
    values (v_uid, case when coalesce(p_corporate, false) then 'corporate_member' else 'uncorporate_member' end,
            'profile', p_user,
            jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), '')) || v_result);
  return v_result;
end;
$$;

-- An approved corporate application is now a grant, not only a decision record.
create or replace function public.admin_review_account_request(
  p_id uuid,
  p_decision text,
  p_note text default null,
  p_credits integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.account_requests%rowtype;
  v_grant jsonb;
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'BAD_DECISION'; end if;

  select * into v_request from public.account_requests where id = p_id;
  if v_request.id is null then raise exception 'NOT_FOUND'; end if;
  if v_request.status <> 'pending' then raise exception 'ALREADY_DECIDED'; end if;

  update public.account_requests
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         decided_at = now(),
         decided_by = v_uid,
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  if p_decision = 'approve' and v_request.kind = 'verified' then
    v_grant := app.apply_verification(v_request.user_id, true, p_credits, v_uid, v_request.kind);
  elsif p_decision = 'approve' and v_request.kind = 'corporate' then
    v_grant := app.apply_corporate(v_request.user_id, true, p_credits, v_uid, v_request.kind);
  end if;

  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
    values (v_uid, 'account_request:' || p_decision, 'account_request', p_id,
            jsonb_build_object('kind', v_request.kind, 'userId', v_request.user_id,
                               'note', nullif(btrim(coalesce(p_note, '')), ''), 'grant', v_grant));

  return jsonb_build_object(
    'requestId', p_id, 'decision', p_decision, 'kind', v_request.kind,
    'userId', v_request.user_id, 'grant', v_grant
  );
end;
$$;

-- The queue has to answer "what will this approval do" before the button is pressed.
create or replace function public.admin_account_queue(
  p_kind text default null,
  p_status text default 'pending',
  p_limit integer default 50
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'kind', q.kind, 'status', q.status, 'createdAt', q.created_at,
           'decidedAt', q.decided_at, 'decisionNote', q.decision_note,
           'message', q.message, 'links', q.links,
           'userId', q.user_id, 'handle', q.handle, 'displayName', q.display_name,
           'alreadyVerified', q.already_verified, 'alreadyCorporate', q.already_corporate,
           'credits', q.corporate_credits + q.verified_credits,
           'published', q.published,
           'strategyId', q.strategy_id, 'strategyName', q.strategy_name
         ) order by q.created_at), '[]'::jsonb)
    from (
      select r.id, r.kind, r.status, r.created_at, r.decided_at, r.decision_note,
             r.message, r.links, r.user_id, r.strategy_id,
             p.handle, p.display_name,
             p.is_verified as already_verified, p.is_corporate as already_corporate,
             coalesce(p.corporate_boost_credits, 0) as corporate_credits,
             coalesce(p.verified_boost_credits, 0) as verified_credits,
             s.name as strategy_name,
             (select count(*) from public.strategies me
               where me.owner_id = r.user_id and me.status in ('approved', 'featured')) as published
        from public.account_requests r
        join public.profiles p on p.id = r.user_id
        left join public.strategies s on s.id = r.strategy_id
       where (p_kind is null or r.kind = p_kind)
         and (p_status is null or r.status = p_status)
       order by r.created_at
       limit greatest(least(coalesce(p_limit, 50), 200), 1)
    ) q;
$$;

-- ------------------------------------------------------------ 8. spending a promotion credit

-- One RPC, two pockets. The corporate credit goes first because it is worth more and would be the
-- one to lapse unused.
create or replace function public.claim_verified_boost(p_strategy_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_strategy public.strategies%rowtype;
  v_corporate boolean := app.corporate_active(v_uid);
  v_sku text;
  v_hours integer;
  v_ends timestamptz;
  v_boost uuid;
begin
  if v_uid is null then raise exception 'ANONYMOUS: sign in first'; end if;
  if not app.verified_active(v_uid) then raise exception 'NOT_VERIFIED'; end if;

  if v_corporate and app.corporate_boost_credits(v_uid) > 0 then
    v_sku := 'boost_corporate_168h';
  elsif app.verified_boost_credits(v_uid) > 0 then
    v_sku := 'boost_verified_72h';
  else
    raise exception 'NO_CREDIT';
  end if;

  select * into v_strategy from public.strategies s where s.id = p_strategy_id;
  if v_strategy.id is null then raise exception 'NOT_FOUND'; end if;
  if v_strategy.owner_id <> v_uid then raise exception 'NOT_OWNER'; end if;
  if v_strategy.status not in ('approved', 'featured') then raise exception 'NOT_PUBLISHED'; end if;

  if exists (
    select 1 from public.strategy_boosts b
     where b.strategy_id = p_strategy_id and b.buyer_id = v_uid
       and b.status = 'active' and b.ends_at > now()
  ) then
    raise exception 'ALREADY_BOOSTED: this strategy is already promoted';
  end if;

  select greatest(1, coalesce(c.duration_hours, 72)) into v_hours
    from public.spend_catalog c where c.sku = v_sku;
  v_hours := coalesce(v_hours, 72);
  v_ends := now() + make_interval(hours => v_hours);

  insert into public.strategy_boosts (strategy_id, buyer_id, sku, starts_at, ends_at, status)
    values (p_strategy_id, v_uid, v_sku, now(), v_ends, 'active')
    returning id into v_boost;

  -- This is the column Discover actually reads; without it the boost is a receipt and nothing more.
  update public.strategies
     set boost_expires_at = greatest(coalesce(boost_expires_at, now()), v_ends)
   where id = p_strategy_id;

  perform set_config('app.verified_write', 'on', true);
  perform set_config('app.corporate_write', 'on', true);
  if v_sku = 'boost_corporate_168h' then
    update public.profiles
       set corporate_boost_credits = corporate_boost_credits - 1, updated_at = now()
     where id = v_uid;
  else
    update public.profiles
       set verified_boost_credits = verified_boost_credits - 1, updated_at = now()
     where id = v_uid;
  end if;
  perform set_config('app.corporate_write', 'off', true);
  perform set_config('app.verified_write', 'off', true);

  return jsonb_build_object(
    'boostId', v_boost, 'strategyId', p_strategy_id, 'endsAt', v_ends,
    'sku', v_sku, 'hours', v_hours,
    'creditsLeft', app.verified_boost_credits(v_uid) + app.corporate_boost_credits(v_uid)
  );
end;
$$;

-- ------------------------------------------------------------ 9. the till refuses the new tag too

-- The benefit list is enumerated here, so a tag added without this line would make a free tier
-- product buyable. Kept in one place with the CHECK constraint above.
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
  if v_item.tag in ('vip', 'verified', 'corporate') then
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

-- ------------------------------------------------------------ 10. equipping accepts the corporate marks

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
      (p_kind = 'frame' and v_ref = 'rainbow' and (app.vip_active(v_uid) or app.corporate_active(v_uid)))
      or (p_kind = 'title' and v_ref = 'vip_rainbow' and app.vip_active(v_uid))
      or (p_kind = 'title' and v_ref = 'verified_green' and app.verified_active(v_uid))
      or (p_kind = 'title' and v_ref = 'corporate' and app.corporate_active(v_uid))
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

-- A brand backdrop is now an organisation feature, not only a VIP one.
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
    if p_kind = 'background' and not app.brand_background_unlocked(v_uid) then
      raise exception 'VIP_REQUIRED: a custom background needs VIP or a corporate account';
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

-- ------------------------------------------------------------ 11. wallet: the tier and what it owns

-- Superset of 0039: ownership still resolves by entitlement rather than per SKU, and the corporate
-- frames are entitlements too.
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
               ) or (c.ref_code = 'profile_banner' and (v_vip or v_verified)))
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

-- ------------------------------------------------------------ 12. showcase: both titles, in both languages

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

-- ------------------------------------------------------------ 13. the admin's member list carries both tiers

create or replace function public.admin_user_search(p_query text default null, p_limit integer default 25)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select p.id, p.handle, p.display_name, p.role, p.is_banned, p.created_at,
           p.is_verified, p.verified_discount_ends_at, p.verified_boost_credits,
           p.is_corporate, p.corporate_discount_ends_at, p.corporate_boost_credits,
           p.currency_balance_cache as balance,
           -- The operator grants VIP from this row, so the row has to say whether it is already held
           -- and whether the cached number still agrees with the ledger (0041 repairs that).
           app.vip_active(p.id) as vip,
           p.currency_balance_cache is distinct from
             coalesce((select sum(l.delta) from public.currency_ledger l where l.user_id = p.id), 0)::integer
             as drift,
           (select count(*) from public.strategies s where s.owner_id = p.id and s.status in ('approved', 'featured')) as published,
           (select count(*) from public.overlay_sessions o where o.user_id = p.id) as runs
      from public.profiles p
     where (p_query is null or trim(p_query) = ''
            or p.handle ilike '%' || trim(p_query) || '%'
            or coalesce(p.display_name, '') ilike '%' || trim(p_query) || '%')
     order by p.created_at desc
     limit greatest(least(p_limit, 100), 1)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', b.id, 'handle', b.handle, 'displayName', b.display_name,
           'role', b.role, 'banned', b.is_banned, 'joinedAt', b.created_at,
           'verified', b.is_verified, 'discountEndsAt', b.verified_discount_ends_at,
           'corporate', b.is_corporate, 'corporateDiscountEndsAt', b.corporate_discount_ends_at,
           'credits', b.verified_boost_credits + b.corporate_boost_credits,
           'vip', b.vip, 'drift', b.drift,
           'balance', b.balance, 'published', b.published, 'runs', b.runs
         ) order by b.created_at desc), '[]'::jsonb)
    from base b;
$$;

-- ------------------------------------------------------------ 14. discovery: corporate above verified

-- Same signature as 0037, so no drop is needed for the facet reader. The verified bucket now counts
-- the filter's own population, which is what makes the chip's number honest.
create or replace function public.discover_facets(
  p_query text default null,
  p_mode text default null,
  p_map text default null,
  p_difficulty text default null,
  p_event boolean default null,
  p_tag text default null,
  p_verified_only boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select s.id, s.map_key, s.difficulty, s.game_mode,
           exists (
             select 1 from public.profiles pv
              where pv.id = s.owner_id and (pv.is_verified or pv.is_corporate)
           ) as author_verified,
           exists (
             select 1 from public.profiles pc
              where pc.id = s.owner_id and pc.is_corporate
           ) as author_corporate
      from public.strategies s
     where s.status in ('approved', 'featured')
       and s.current_version_id is not null
       and (p_query is null or trim(p_query) = ''
            or s.name ilike '%' || trim(p_query) || '%'
            or coalesce(s.subtitle, '') ilike '%' || trim(p_query) || '%'
            or coalesce(s.description, '') ilike '%' || trim(p_query) || '%')
       and (p_mode is null or s.game_mode = p_mode)
       and (p_map is null or s.map_key = p_map)
       and (p_difficulty is null or s.difficulty = p_difficulty)
       and (p_event is null or s.is_event_strategy = p_event)
       and (p_tag is null or exists (
         select 1 from public.strategy_tags st where st.strategy_id = s.id and st.tag_key = p_tag))
       and (not p_verified_only or exists (
         select 1 from public.profiles pv3
          where pv3.id = s.owner_id and (pv3.is_verified or pv3.is_corporate)))
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'verified', (select count(*) from base where author_verified),
    'corporate', (select count(*) from base where author_corporate),
    'maps', (
      select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', c) order by c desc, k), '[]'::jsonb)
      from (select map_key as k, count(*) as c from base where map_key is not null group by map_key) f
    ),
    'difficulties', (
      select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', c) order by c desc, k), '[]'::jsonb)
      from (select difficulty as k, count(*) as c from base group by difficulty) f
    ),
    'modes', (
      select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', c) order by c desc, k), '[]'::jsonb)
      from (select game_mode as k, count(*) as c from base where game_mode <> 'unknown' group by game_mode) f
    )
  );
$$;

-- A new OUT column changes the return type, which Postgres will not do with create or replace, so the
-- 0037 signature is dropped first. The argument list is untouched: every installed client keeps
-- calling this with the same names.
drop function if exists public.search_strategies(
  text, text, text, text, boolean, text, text, integer, integer, boolean, boolean, boolean
);

create or replace function public.search_strategies(
  p_query text default null,
  p_mode text default null,
  p_map text default null,
  p_difficulty text default null,
  p_event boolean default null,
  p_tag text default null,
  p_sort text default 'new',
  p_limit integer default 24,
  p_offset integer default 0,
  p_favorites_only boolean default false,
  p_watch_only boolean default false,
  p_verified_only boolean default false
)
returns table (
  id uuid,
  slug text,
  name text,
  subtitle text,
  difficulty text,
  game_mode text,
  player_count text,
  map_key text,
  is_event_strategy boolean,
  event_key text,
  wave_from integer,
  wave_to integer,
  times_used integer,
  rating_avg numeric,
  rating_count integer,
  credit_creator text,
  owner_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  is_pinned boolean,
  is_favorited boolean,
  is_watched boolean,
  trend_7d bigint,
  rows_total bigint,
  author_verified boolean,
  author_corporate boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with trend as (
    select strategy_id, coalesce(sum(uses), 0) as uses_7d
      from public.strategy_usage_daily
     where day > now()::date - 7
     group by strategy_id
  ),
  base as (
    select s.*,
      (s.boost_expires_at is not null and s.boost_expires_at > now()) as boosted_now,
      exists (
        select 1 from public.favorites f
        where f.strategy_id = s.id and f.user_id = auth.uid()
      ) as favorited,
      exists (
        select 1 from public.strategy_watch w
        where w.strategy_id = s.id and w.user_id = auth.uid()
      ) as watched,
      coalesce(tr.uses_7d, 0) as uses_7d,
      exists (
        select 1 from public.profiles pv
        where pv.id = s.owner_id and (pv.is_verified or pv.is_corporate)
      ) as author_verified,
      exists (
        select 1 from public.profiles pc
        where pc.id = s.owner_id and pc.is_corporate
      ) as author_corporate
      from public.strategies s
      left join trend tr on tr.strategy_id = s.id
      where s.status in ('approved', 'featured')
        and s.current_version_id is not null
        and (p_query is null or trim(p_query) = ''
             or s.name ilike '%' || trim(p_query) || '%'
             or coalesce(s.subtitle, '') ilike '%' || trim(p_query) || '%'
             or coalesce(s.description, '') ilike '%' || trim(p_query) || '%')
        and (p_mode is null or s.game_mode = p_mode)
        and (p_map is null or s.map_key = p_map)
        and (p_difficulty is null or s.difficulty = p_difficulty)
        and (p_event is null or s.is_event_strategy = p_event)
        and (p_tag is null or exists (
          select 1 from public.strategy_tags st where st.strategy_id = s.id and st.tag_key = p_tag))
        and (not p_favorites_only or exists (
          select 1 from public.favorites f2
          where f2.strategy_id = s.id and f2.user_id = auth.uid()))
        and (not p_watch_only or exists (
          select 1 from public.strategy_watch w2
          where w2.strategy_id = s.id and w2.user_id = auth.uid()))
        and (not p_verified_only or exists (
          select 1 from public.profiles pv2
          where pv2.id = s.owner_id and (pv2.is_verified or pv2.is_corporate)))
  ),
  pinned as (
    select b.id, row_number() over (order by b.boost_expires_at desc) as rn
      from base b
      where b.boosted_now
  ),
  chosen as (
    select b.*, count(*) over () as total, coalesce(p.rn <= 3, false) as pin_first
      from base b
      left join pinned p on p.id = b.id
      order by coalesce(p.rn <= 3, false) desc nulls last,
        -- An organisation outranks a verified person, which outranks everyone else. Both sit under the
        -- same tick, so the order is the only place the difference is visible.
        b.author_corporate desc nulls last,
        b.author_verified desc nulls last,
        case when p_sort = 'used' then b.times_used end desc nulls last,
        case when p_sort = 'rating' then b.rating_avg end desc nulls last,
        case when p_sort = 'trending' then b.uses_7d end desc nulls last,
        case when p_sort = 'new' then b.created_at end desc nulls last,
        b.created_at desc
      limit greatest(least(p_limit, 60), 1)
      offset greatest(p_offset, 0)
  )
  select c.id, c.slug, c.name, c.subtitle, c.difficulty, c.game_mode, c.player_count,
         c.map_key, c.is_event_strategy, c.event_key, c.wave_from, c.wave_to,
         c.times_used, c.rating_avg, c.rating_count, c.credit_creator, c.owner_id,
         c.created_at, c.updated_at,
         c.pin_first,
         c.favorited,
         c.watched,
         c.uses_7d,
         c.total,
         c.author_verified,
         c.author_corporate
    from chosen c;
$$;

-- ------------------------------------------------------------ 15. privileges and reload

do $$
declare
  v_sig text;
  v_list text[] := array[
    'public.admin_set_corporate(uuid, boolean, integer, text)',
    'public.admin_account_queue(text, text, integer)',
    'public.admin_review_account_request(uuid, text, text, integer)',
    'public.claim_verified_boost(uuid)',
    'public.set_profile_media(text, text)'
  ];
  v_open text[] := array[
    'public.discover_facets(text, text, text, text, boolean, text, boolean)',
    'public.search_strategies(text, text, text, text, boolean, text, text, integer, integer, boolean, boolean, boolean)'
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

  foreach v_sig in array v_open loop
    if to_regprocedure(v_sig) is not null then
      execute format('revoke execute on function %s from public', v_sig);
      execute format('grant execute on function %s to anon, authenticated', v_sig);
    end if;
  end loop;

  -- Helpers run only inside a definer function; a client must not probe tier counts.
  foreach v_sig in array array[
    'app.corporate_active(uuid)',
    'app.corporate_discount_active(uuid)',
    'app.corporate_boost_credits(uuid)',
    'app.brand_background_unlocked(uuid)',
    'app.apply_corporate(uuid, boolean, integer, uuid, text)'
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
  raise notice '0040: corporate accounts ready (gold title, brand kit, 20%% for 60 days, three 7-day credits, ranked above verified).';
end;
$$;
