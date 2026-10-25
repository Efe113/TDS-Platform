-- 0037: verified accounts — a staff-granted tier with its own economy, promotion and read paths.
--
-- Why a column instead of a receipt: VIP is derived from `spend_orders` because somebody *paid* for
-- it. Verification is a judgement a moderator makes, so the truth is an admin-pinned column pair
-- (is_verified + the audit row), guarded exactly like `is_banned`. A second guard flag,
-- `app.verified_write`, lets the definer RPCs move the columns for a signed-in non-admin (crediting a
-- boost) without opening a client-writable hole.
--
-- What the tier unlocks, all server-side so no client can fake it:
--   * %10 off every product for 30 days, multiplied on top of the VIP tier pass;
--   * the green animated `verified_green` title, auto-equipped on grant and cleared on revoke;
--   * the profile banner (same unlock the VIP tier already uses);
--   * one redeemable 72h promotion credit per grant — redeemable on any strategy the user owns;
--   * a checkmark and a sort boost on every strategy they authored, in Discover.
--
-- Two pre-existing gaps are fixed here because the tier depends on them: nothing ever wrote
-- `strategies.boost_expires_at`, so a paid boost never pinned a strategy in Discover; and `buy_boost`
-- charged `spend_catalog.price` instead of `app.effective_price`, so tier discounts never reached the
-- till. Applications are a separate queue (`account_requests`) shaped so the corporate tier can reuse
-- it by kind without a new table.
--
-- Depends on 0034 (effective_price, banner_unlocked) and 0036 (wallet_summary, equip_cosmetic).
-- Safe to run twice.

-- ------------------------------------------------------------ 1. admin-pinned columns

alter table public.profiles add column if not exists is_verified boolean not null default false;
alter table public.profiles add column if not exists verified_at timestamptz;
alter table public.profiles add column if not exists verified_discount_ends_at timestamptz;
alter table public.profiles add column if not exists verified_boost_credits integer not null default 0;

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
  end if;
  new.role := app.auth_role(new.id);
  return new;
end;
$$;

-- ------------------------------------------------------------ 2. entitlement helpers

create or replace function app.verified_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p where p.id = p_user and p.is_verified
  );
$$;

-- The discount is the only part of the tier that expires; a revoked or lapsed grant prices normally.
create or replace function app.verified_discount_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_user and p.is_verified and p.verified_discount_ends_at > now()
  );
$$;

create or replace function app.verified_boost_credits(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p.verified_boost_credits, 0) from public.profiles p where p.id = p_user;
$$;

-- ------------------------------------------------------------ 3. pricing and unlocks

-- Three passes, each multiplicative: the shelf cut, then the verified 10%, then the VIP 25%. A
-- verified VIP therefore pays 0.9 * 0.75 = 67.5% of the discounted base. Membership itself is never
-- discounted by either tier.
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
  tiered as (
    select case
      when price <= 0 then price
      when p_item.kind <> 'vip' and app.verified_discount_active(auth.uid())
        then greatest(1, ceil(price * 90 / 100.0)::integer)
      else price
    end as price
    from base
  )
  select case
    when price <= 0 then price
    when p_item.kind <> 'vip' and app.vip_active(auth.uid())
      then greatest(1, ceil(price * 75 / 100.0)::integer)
    else price
  end
  from tiered;
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

-- ------------------------------------------------------------ 4. catalog rows for the tier

alter table public.spend_catalog drop constraint if exists spend_catalog_tag_check;
alter table public.spend_catalog add constraint spend_catalog_tag_check
  check (tag in ('none', 'new', 'soon', 'vip', 'verified'));

-- The verified title. tag='verified' is what keeps the till from selling it: spend_currency refuses
-- every benefit-tagged row, so the only way in is the grant RPC below.
insert into public.spend_catalog (
  sku, kind, price, ref_code, enabled, sort_order,
  name_tr, name_en, desc_tr, desc_en, perks, tag
)
values (
  'title_verified_green', 'title', 0, 'verified_green', true, 390,
  'Doğrulanmış', 'Verified',
  'Yeşil animasyonlu doğrulanmış ünvanı; adının yanında akar.',
  'Animated green verified title that flows next to your name.',
  '["Doğrulanmış hesaplara otomatik","Animasyonlu yeşil","Adının yanında görünür"]'::jsonb,
  'verified'
)
on conflict (sku) do update set
  kind = 'title', price = 0, ref_code = 'verified_green', enabled = true, sort_order = 390,
  name_tr = excluded.name_tr, name_en = excluded.name_en,
  desc_tr = excluded.desc_tr, desc_en = excluded.desc_en,
  perks = excluded.perks, tag = 'verified';

-- The promotion credit's receipt row. It stays disabled on purpose: strategy_boosts.sku has a foreign
-- key into this table, so the grant needs a real SKU, but a disabled row never reaches the shop shelf
-- or the wallet catalog.
insert into public.spend_catalog (
  sku, kind, price, ref_code, duration_hours, enabled, sort_order,
  name_tr, name_en, desc_tr, desc_en, perks, tag
)
values (
  'boost_verified_72h', 'boost', 0, null, 72, false, 108,
  'Doğrulanmış öne çıkarma kredisi', 'Verified promotion credit',
  'Doğrulama ile gelen 3 günlük öne çıkarma; cüzdan kredi olarak görünür.',
  'The 3-day promotion that arrives with verification; held as a wallet credit.',
  '["Doğrulama hediyesi","3 gün öne çıkarma","Kendi stratejinde"]'::jsonb,
  'verified'
)
on conflict (sku) do update set
  kind = 'boost', price = 0, duration_hours = 72, enabled = false, sort_order = 108,
  name_tr = excluded.name_tr, name_en = excluded.name_en,
  desc_tr = excluded.desc_tr, desc_en = excluded.desc_en,
  perks = excluded.perks, tag = 'verified';

-- ------------------------------------------------------------ 5. applications

-- user_badges.code has a foreign key, so the badge the grant awards has to exist first. It is manual
-- (never auto-evaluated) and hidden from the auto-award engine.
insert into public.badge_definitions (code, name_tr, name_en, desc_tr, icon_path, tier, conditions, award_mode, active)
values ('verified', 'Doğrulanmış Hesap', 'Verified Account',
        'Ekip tarafından doğrulanmış hesap; tik rozeti ve yeşil ünvanla gelir.', 'badge-check', 'special',
        '{"metric":"staff","operator":"eq","value":"verified"}'::jsonb, 'manual', true)
on conflict (code) do update set
  name_tr = excluded.name_tr, name_en = excluded.name_en, desc_tr = excluded.desc_tr,
  tier = 'special', award_mode = 'manual', active = true;

create table if not exists public.account_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'verified' check (kind in ('verified', 'corporate')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  message text not null check (char_length(message) between 20 and 2000),
  links text check (links is null or char_length(links) <= 1000),
  strategy_id uuid references public.strategies (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  decision_note text
);

create index if not exists account_requests_open_idx on public.account_requests (user_id, kind)
  where status = 'pending';
create unique index if not exists account_requests_one_open_idx on public.account_requests (user_id, kind)
  where status = 'pending';
create index if not exists account_requests_queue_idx on public.account_requests (created_at)
  where status = 'pending';

alter table public.account_requests enable row level security;

drop policy if exists account_requests_read_own on public.account_requests;
create policy account_requests_read_own on public.account_requests
  for select using (user_id = auth.uid() or app.is_admin());

drop policy if exists account_requests_insert_own on public.account_requests;
create policy account_requests_insert_own on public.account_requests
  for insert with check (user_id = auth.uid() and status = 'pending');

-- Decisions happen only inside the RPC below, so no client may update or delete a submission.

-- ------------------------------------------------------------ 6. the grant, shared by both doors

-- admin_set_verified (manual) and admin_review_account_request (approved application) must not be able
-- to drift apart, so both call this. Not granted to any role: it lives in `app`, like every other
-- internal helper.
create or replace function app.apply_verification(
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
  v_days integer := 30;
  v_credits integer;
begin
  select * into v_target from public.profiles p where p.id = p_user;
  if v_target.id is null then
    raise exception 'NOT_FOUND: no such profile';
  end if;

  if not p_on then
    perform set_config('app.verified_write', 'on', true);
    perform set_config('app.cosmetic_write', 'on', true);
    update public.profiles
       set is_verified = false,
           verified_at = null,
           verified_discount_ends_at = null,
           verified_boost_credits = 0,
           active_title = case when active_title = 'verified_green' then null else active_title end,
           updated_at = now()
     where id = p_user;
    perform set_config('app.cosmetic_write', 'off', true);
    perform set_config('app.verified_write', 'off', true);
    return jsonb_build_object('userId', p_user, 'verified', false, 'credits', 0);
  end if;

  -- Re-granting extends the discount window instead of restarting it, and never throws away credits the
  -- user has not spent. An explicit p_credits always wins (an admin topping someone up).
  v_credits := greatest(0, coalesce(
    p_credits,
    v_target.verified_boost_credits + case when v_target.is_verified then 0 else 1 end
  ));

  perform set_config('app.verified_write', 'on', true);
  perform set_config('app.cosmetic_write', 'on', true);
  update public.profiles
     set is_verified = true,
         verified_at = coalesce(verified_at, now()),
         verified_discount_ends_at = greatest(
           coalesce(verified_discount_ends_at, now()), now() + make_interval(days => v_days)
         ),
         verified_boost_credits = v_credits,
         active_title = case
           when coalesce(active_title, '') = '' then 'verified_green'
           else active_title
         end,
         updated_at = now()
   where id = p_user;
  perform set_config('app.cosmetic_write', 'off', true);
  perform set_config('app.verified_write', 'off', true);

  insert into public.user_badges (user_id, code, awarded_by)
    values (p_user, 'verified', case when p_actor is null then 'system' else 'admin' end)
    on conflict do nothing;

  return jsonb_build_object(
    'userId', p_user, 'verified', true, 'credits', v_credits,
    'discountEndsAt', (select verified_discount_ends_at from public.profiles where id = p_user),
    'reason', p_reason
  );
end;
$$;

-- ------------------------------------------------------------ 7. doors

-- Manual grant/revoke, the pattern of admin_set_user_ban.
create or replace function public.admin_set_verified(
  p_user uuid,
  p_verified boolean,
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
  if coalesce(p_verified, false) then
    v_result := app.apply_verification(p_user, true, p_credits, v_uid, p_note);
  else
    v_result := app.apply_verification(p_user, false, null, v_uid, p_note);
  end if;
  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
    values (v_uid, case when coalesce(p_verified, false) then 'verify_member' else 'unverify_member' end,
            'profile', p_user,
            jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), '')) || v_result);
  return v_result;
end;
$$;

-- An application: one open request per kind, so a user cannot spam the queue.
create or replace function public.submit_account_request(
  p_kind text default 'verified',
  p_message text default null,
  p_links text default null,
  p_strategy_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_kind text := coalesce(nullif(btrim(coalesce(p_kind, '')), ''), 'verified');
  v_existing uuid;
  v_id uuid;
begin
  if v_uid is null then raise exception 'ANONYMOUS: sign in first'; end if;
  if v_kind not in ('verified', 'corporate') then raise exception 'BAD_KIND'; end if;
  if nullif(btrim(coalesce(p_message, '')), '') is null then raise exception 'MESSAGE_SHORT'; end if;
  if char_length(btrim(p_message)) < 20 then raise exception 'MESSAGE_SHORT'; end if;

  if p_strategy_id is not null and not exists (
    select 1 from public.strategies s
     where s.id = p_strategy_id and s.owner_id = v_uid
  ) then
    raise exception 'NOT_OWNER: pick one of your own strategies';
  end if;

  select id into v_existing from public.account_requests
    where user_id = v_uid and kind = v_kind and status = 'pending';
  if v_existing is not null then
    return jsonb_build_object('requestId', v_existing, 'status', 'pending', 'replayed', true);
  end if;

  insert into public.account_requests (user_id, kind, message, links, strategy_id)
    values (v_uid, v_kind, btrim(p_message), nullif(btrim(coalesce(p_links, '')), ''), p_strategy_id)
    returning id into v_id;

  return jsonb_build_object('requestId', v_id, 'status', 'pending', 'replayed', false);
end;
$$;

-- What the applicant already has in flight, so the form can say "under review" instead of silently
-- rejecting the next submit.
create or replace function public.my_account_requests()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'kind', r.kind, 'status', r.status, 'message', r.message,
           'links', r.links, 'strategyId', r.strategy_id, 'strategyName', s.name,
           'createdAt', r.created_at, 'decidedAt', r.decided_at, 'decisionNote', r.decision_note
         ) order by r.created_at desc), '[]'::jsonb)
    from public.account_requests r
    left join public.strategies s on s.id = r.strategy_id
   where r.user_id = auth.uid();
$$;

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
           'alreadyVerified', q.already_verified, 'published', q.published,
           'strategyId', q.strategy_id, 'strategyName', q.strategy_name
         ) order by q.created_at), '[]'::jsonb)
    from (
      select r.id, r.kind, r.status, r.created_at, r.decided_at, r.decision_note,
             r.message, r.links, r.user_id, r.strategy_id,
             p.handle, p.display_name, p.is_verified as already_verified,
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

-- Approving a verified application is the grant; approving a corporate one only records the decision,
-- because that tier's perks are not defined yet.
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

-- ------------------------------------------------------------ 8. spending the promotion credit

-- The credit exists because a grant is not a strategy choice: the user decides which of their own
-- published strategies gets the 3 days. No coin is moved, so no ledger row is written.
create or replace function public.claim_verified_boost(p_strategy_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_strategy public.strategies%rowtype;
  v_hours integer;
  v_ends timestamptz;
  v_boost uuid;
begin
  if v_uid is null then raise exception 'ANONYMOUS: sign in first'; end if;
  if not app.verified_active(v_uid) then raise exception 'NOT_VERIFIED'; end if;
  if app.verified_boost_credits(v_uid) < 1 then raise exception 'NO_CREDIT'; end if;

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
    from public.spend_catalog c where c.sku = 'boost_verified_72h';
  v_hours := coalesce(v_hours, 72);
  v_ends := now() + make_interval(hours => v_hours);

  insert into public.strategy_boosts (strategy_id, buyer_id, sku, starts_at, ends_at, status)
    values (p_strategy_id, v_uid, 'boost_verified_72h', now(), v_ends, 'active')
    returning id into v_boost;

  -- This is the column Discover actually reads; without it the boost is a receipt and nothing more.
  update public.strategies
     set boost_expires_at = greatest(coalesce(boost_expires_at, now()), v_ends)
   where id = p_strategy_id;

  perform set_config('app.verified_write', 'on', true);
  update public.profiles
     set verified_boost_credits = verified_boost_credits - 1, updated_at = now()
   where id = v_uid;
  perform set_config('app.verified_write', 'off', true);

  return jsonb_build_object(
    'boostId', v_boost, 'strategyId', p_strategy_id, 'endsAt', v_ends,
    'creditsLeft', app.verified_boost_credits(v_uid)
  );
end;
$$;

-- ------------------------------------------------------------ 9. the till refuses benefit-tagged rows and takes the verified pass

create or replace function public.spend_currency(p_sku text, p_idempotency_key text)
returns table (order_id uuid, balance integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $
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
  -- neither a VIP nor a verified product can be bought off the shelf (0037).
  if v_item.tag in ('vip', 'verified') then
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
$;

-- ------------------------------------------------------------ 10. buying a boost now actually pins the strategy

create or replace function public.buy_boost(
  p_strategy_id uuid,
  p_sku text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $
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
  v_price integer;
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

  -- The shelf and the receipt must agree, so boosts take the tier passes too (0037).
  v_price := app.effective_price(v_item);
  v_hours := greatest(1, coalesce(v_item.duration_hours, 72));
  v_ends := now() + make_interval(hours => v_hours);

  insert into public.spend_orders (user_id, sku, price_paid, idempotency_key)
    values (v_user, p_sku, v_price, nullif(p_idempotency_key, ''))
    returning id into v_order;

  -- ledger_append raises INSUFFICIENT_FUNDS before any row is committed, so a rejected purchase
  -- leaves no order behind: the whole function is one transaction.
  v_balance := app.ledger_append(v_user, -v_price, 'spend', p_sku, 'order', v_order::text,
                                 nullif(p_idempotency_key, '') || ':ledger', v_user::text);

  insert into public.strategy_boosts (strategy_id, buyer_id, sku, starts_at, ends_at, status, order_id)
    values (p_strategy_id, v_user, p_sku, now(), v_ends, 'active', v_order)
    returning id into v_boost;

  -- Discover pins on strategies.boost_expires_at. Nothing wrote it before 0037, which is why a paid
  -- boost bought a receipt and never a promotion.
  update public.strategies
     set boost_expires_at = greatest(coalesce(boost_expires_at, now()), v_ends)
   where id = p_strategy_id;

  return jsonb_build_object(
    'replayed', false,
    'boostId', v_boost,
    'strategyId', p_strategy_id,
    'endsAt', v_ends,
    'pricePaid', v_price,
    'balance', v_balance
  );
end;
$;

-- ------------------------------------------------------------ 11. equipping accepts the verified title

create or replace function public.equip_cosmetic(p_kind text, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $
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
      or (p_kind = 'title' and v_ref = 'verified_green' and app.verified_active(v_uid))
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
$;

-- ------------------------------------------------------------ 12. wallet and showcase expose the tier

create or replace function public.wallet_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $
declare
  v_user uuid := auth.uid();
  v_vip boolean;
  v_verified boolean;
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
  v_credits := app.verified_boost_credits(v_user);

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
               ) or (c.ref_code = 'profile_banner' and (v_vip or v_verified)))
               when 'title' then (
                 (c.ref_code = 'vip_rainbow' and v_vip)
                 or (c.ref_code = 'verified_green' and v_verified)
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
    'verifiedDiscountEndsAt', (select p.verified_discount_ends_at from public.profiles p where p.id = v_user),
    'verifiedBoostCredits', v_credits,
    'vipBackgroundPath', case when v_vip then (
      select p.custom_background_path from public.profiles p where p.id = v_user
    ) else null end,
    'rules', v_rules, 'entries', v_entries, 'catalog', v_catalog, 'boosts', v_boosts,
    'maintenance', app.maintenance_on()
  );
end;
$;

create or replace function public.profile_showcase(p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $
declare
  v_caller uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_vip boolean := app.vip_active(p_user);
  v_verified boolean := app.verified_active(p_user);
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
    'verified', v_verified,
    'verifiedBoostCredits', case when v_caller = p_user or app.is_admin()
                                 then app.verified_boost_credits(p_user) else null end,
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
$;


-- ------------------------------------------------------------ 13. the admin's member list carries the tier

-- Same body as 0026 plus the verification columns: the users table is where an operator grants or
-- revokes the tier by hand, so it has to show what is already set.
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
           p.currency_balance_cache as balance,
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
           'credits', b.verified_boost_credits,
           'balance', b.balance, 'published', b.published, 'runs', b.runs
         ) order by b.created_at desc), '[]'::jsonb)
    from base b;
$$;

-- ------------------------------------------------------------ 14. discovery ranks verified authors first

-- Verified accounts have to sit above ordinary strategies the same way an active promotion does, and
-- the facet counters have to agree with the filter, so both readers change signature together. As in
-- 0023, the old overloads are dropped first: a defaulted extra parameter would leave every call
-- ambiguous between two signatures.
drop function if exists public.discover_facets(text, text, text, text, boolean, text);
drop function if exists public.search_strategies(
  text, text, text, text, boolean, text, text, integer, integer, boolean, boolean
);

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
    select s.id, s.map_key, s.difficulty, s.game_mode
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
         select 1 from public.profiles pv where pv.id = s.owner_id and pv.is_verified))
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
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
  author_verified boolean
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
        where pv.id = s.owner_id and pv.is_verified
      ) as author_verified
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
          where pv2.id = s.owner_id and pv2.is_verified))
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
         c.author_verified
    from chosen c;
$$;
-- ------------------------------------------------------------ 15. maintenance covers applications

do $$
declare
  v_table text;
begin
  foreach v_table in array array['spend_orders', 'comments', 'ratings', 'favorites', 'account_requests'] loop
    execute format('drop trigger if exists %I_guard_maintenance on public.%I', v_table, v_table);
    execute format(
      'create trigger %I_guard_maintenance before insert on public.%I for each row execute function app.guard_maintenance()',
      v_table, v_table
    );
  end loop;
end;
$$;

-- ------------------------------------------------------------ 16. privileges

do $$
declare
  v_sig text;
  v_list text[] := array[
    'public.admin_set_verified(uuid, boolean, integer, text)',
    'public.submit_account_request(text, text, text, uuid)',
    'public.my_account_requests()',
    'public.admin_account_queue(text, text, integer)',
    'public.admin_review_account_request(uuid, text, text, integer)',
    'public.claim_verified_boost(uuid)'
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

  -- The helpers only ever run inside a definer function; a client must not probe credit counts.
  foreach v_sig in array array[
    'app.verified_active(uuid)',
    'app.verified_discount_active(uuid)',
    'app.verified_boost_credits(uuid)',
    'app.apply_verification(uuid, boolean, integer, uuid, text)'
  ] loop
    if to_regprocedure(v_sig) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', v_sig);
    end if;
  end loop;
end;
$$;

-- wallet_summary grew, profiles gained columns and two RPCs changed signature: PostgREST must re-read.
select pg_notify('pgrst', 'reload schema');

do $$
begin
  raise notice '0037: verified accounts ready (tier, discount, title, promotion credit, applications, discovery).';
end;
$$;
