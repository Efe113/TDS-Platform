-- 0038: give the admin console real hands.
--
-- Three things were advertised by the schema but never wired: `currency_rules.icon` existed since 0029
-- with no writer, no reader and no UI; `weekly_cap` was validated on save and then ignored at payout;
-- `params.decay_after_sessions` was editable in the form and read by nothing. And the two operations an
-- operator actually reaches for — "give this member coins" and "give this member that badge" — had no
-- RPC at all, because `award_currency` had been revoked from every client role and `user_badges` has no
-- insert policy. This file fixes those four gaps instead of layering more display-only fields on top.
--
-- Design notes:
--   * A rule's business `kind` is separated from the accounting `ledger_kind` it writes. The ledger CHECK
--     is a fixed vocabulary the wallet already colours with, so 12 earn kinds must not spread into it.
--   * Every admin money move is a normal `app.ledger_append` row: hash chain, cached balance and the
--     "balance can never go negative" rule stay intact. An admin grant is a ledger entry, not an edit.
--   * `currency_ledger` gains a real `note` column so a manual adjustment carries its reason where the
--     operator will read it again — in the ledger list — instead of in a separate audit row.
--   * `admin_adjust_balance` deliberately has no ceiling: capping it in SQL only hides the number, the
--     control here is the mandatory note plus the audit log. It refuses self-adjustment so an admin
--     cannot quietly pay themselves.
--   * Manual badge awards never touch coins unless the admin asks (`p_pay_reward`), and the badge is paid
--     through the same `badge_reward` rule the auto engine uses, so two paths cannot disagree.
--
-- Depends on 0003 (ledger + badges), 0019 (award_currency, profile_showcase), 0026 (admin console),
-- 0029 (rule/badge CRUD), 0033 (leaderboard hub), 0037 (current wallet_summary and admin_user_search).
-- Safe to run twice.

-- ------------------------------------------------------------ 1. rule shape

-- 12 business kinds. `grant` stays for one-off/admin-shaped rules.
alter table public.currency_rules drop constraint if exists currency_rules_kind_check;
alter table public.currency_rules add constraint currency_rules_kind_check
  check (kind in ('usage', 'publish', 'approval', 'badge', 'event', 'streak', 'milestone',
                  'community', 'referral', 'challenge', 'support', 'grant'));

-- The accounting column the ledger row is written with. Kept inside the existing ledger CHECK so the
-- wallet's colour and filter vocabulary does not have to grow.
alter table public.currency_rules add column if not exists ledger_kind text not null default 'usage'
  check (ledger_kind in ('usage', 'publish', 'approval', 'badge', 'grant'));

-- `icon` has been dead since 0029; make it a controlled vocabulary instead of free text. The renderer
-- owns the name -> component map, so an unknown name still renders (it falls back), it just cannot
-- crash a board.
comment on column public.currency_rules.icon is
  'Lucide icon name from the admin picker; empty means the client falls back by kind.';

-- Every existing rule keeps writing the ledger kind it always did, so no history is relabelled.
update public.currency_rules r
   set ledger_kind = case
     when r.kind in ('usage', 'publish', 'approval', 'badge', 'grant') then r.kind
     else 'grant'
   end
 where r.ledger_kind is distinct from case
     when r.kind in ('usage', 'publish', 'approval', 'badge', 'grant') then r.kind
     else 'grant'
   end;

-- Give the seeded rules their intended marks, replacing the two hardcoded client-side code->icon maps.
update public.currency_rules set icon = 'monitor-play' where code = 'usage_session';
update public.currency_rules set icon = 'upload' where code = 'publish_bonus';
update public.currency_rules set icon = 'shield-check' where code = 'approval_bonus';
update public.currency_rules set icon = 'award' where code = 'badge_reward';

-- ------------------------------------------------------------ 2. ledger gains a reason

alter table public.currency_ledger add column if not exists note text;

-- ------------------------------------------------------------ 3. payouts respect what the form promises

-- The append primitive grows a reason. Dropping the 8-argument overload first is mandatory: two
-- signatures that both accept eight positional arguments make every internal caller ambiguous.
drop function if exists app.ledger_append(uuid, integer, text, text, text, text, text, text);

create or replace function app.ledger_append(
  p_user uuid,
  p_delta integer,
  p_kind text,
  p_rule text,
  p_ref_type text,
  p_ref_id text,
  p_idem text,
  p_created_by text,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_prev_hash text;
  v_after integer;
begin
  if p_idem is not null and exists (
    select 1 from public.currency_ledger where idempotency_key = p_idem
  ) then
    select balance_after into v_after from public.currency_ledger where idempotency_key = p_idem;
    return coalesce(v_after, 0);
  end if;

  select entry_hash into v_prev_hash
    from public.currency_ledger order by id desc limit 1;

  select coalesce(sum(delta), 0) + p_delta into v_after
    from public.currency_ledger
    where user_id = p_user;

  if v_after < 0 then
    raise exception 'INSUFFICIENT_FUNDS: user % would end at %', p_user, v_after;
  end if;

  insert into public.currency_ledger
      (user_id, delta, kind, rule_code, ref_type, ref_id, idempotency_key, balance_after, prev_hash, entry_hash, created_by, note)
    values
      (p_user, p_delta, p_kind, p_rule, p_ref_type, p_ref_id, p_idem, v_after,
       v_prev_hash,
       encode(digest(coalesce(v_prev_hash, '') || p_user::text || p_delta::text || coalesce(p_idem, ''), 'sha256'), 'hex'),
       p_created_by, nullif(btrim(coalesce(p_note, '')), ''));

  update public.profiles set currency_balance_cache = v_after where id = p_user;

  return v_after;
end;
$$;

create or replace function public.award_currency(
  p_user uuid,
  p_rule_code text,
  p_amount integer,
  p_ref_type text,
  p_ref_id text,
  p_idempotency_key text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule public.currency_rules%rowtype;
  v_amount integer;
  v_today integer;
  v_week integer;
  v_decay integer;
  v_earned integer;
begin
  if p_user is distinct from auth.uid() and not app.is_moderator() then
    raise exception 'FORBIDDEN: you can only award to yourself';
  end if;

  select * into v_rule from public.currency_rules where code = p_rule_code and enabled;
  if not found then
    raise exception 'UNKNOWN_RULE: %', p_rule_code;
  end if;

  v_amount := least(p_amount, v_rule.amount);
  if v_amount <= 0 then
    return 0;
  end if;

  if v_rule.daily_cap is not null then
    select coalesce(sum(delta), 0) into v_today
      from public.currency_ledger
      where user_id = p_user
        and rule_code = p_rule_code
        and created_at >= date_trunc('day', now());
    v_amount := least(v_amount, greatest(0, v_rule.daily_cap - coalesce(v_today, 0)));
    if v_amount <= 0 then
      return 0;
    end if;
  end if;

  -- weekly_cap has been editable and validated since 0029 while nothing ever enforced it; a rule
  -- that says 200/week now stops at 200/week.
  if v_rule.weekly_cap is not null then
    select coalesce(sum(delta), 0) into v_week
      from public.currency_ledger
      where user_id = p_user
        and rule_code = p_rule_code
        and created_at >= date_trunc('week', now());
    v_amount := least(v_amount, greatest(0, v_rule.weekly_cap - coalesce(v_week, 0)));
    if v_amount <= 0 then
      return 0;
    end if;
  end if;

  -- decay_after_sessions was stored by the form and read by nobody. Past the threshold, each further
  -- award of the same rule on the same day pays half (floor 1 coin), so grinding cannot mint money.
  v_decay := nullif(trim(coalesce(v_rule.params ->> 'decay_after_sessions', '')), '')::integer;
  if v_decay is not null and v_decay > 0 then
    select count(*) into v_earned
      from public.currency_ledger
      where user_id = p_user
        and rule_code = p_rule_code
        and delta > 0
        and created_at >= date_trunc('day', now());
    if v_earned >= v_decay then
      v_amount := greatest(1, trunc(v_amount / power(2, least(4, 1 + v_earned - v_decay)))::integer);
    end if;
  end if;

  return app.ledger_append(p_user, v_amount, v_rule.ledger_kind, v_rule.code, p_ref_type, p_ref_id,
                           p_idempotency_key, coalesce(auth.uid()::text, 'rpc'));
end;
$$;

-- ------------------------------------------------------------ 4. the rule editor gains its missing fields

drop function if exists public.admin_upsert_rule(
  text, text, integer, text, integer, integer, integer, integer, boolean, text, text, text, text, jsonb
);

create or replace function public.admin_upsert_rule(
  p_code text,
  p_kind text,
  p_amount integer,
  p_unit text,
  p_daily_cap integer default null,
  p_weekly_cap integer default null,
  p_min_seconds integer default null,
  p_min_steps integer default null,
  p_enabled boolean default true,
  p_name_tr text default null,
  p_name_en text default null,
  p_desc_tr text default null,
  p_desc_en text default null,
  p_icon text default null,
  p_ledger_kind text default 'usage',
  p_params jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  if v_code !~ '^[a-z0-9_]{3,40}$' then raise exception 'CODE_INVALID'; end if;
  if p_kind not in ('usage', 'publish', 'approval', 'badge', 'event', 'streak', 'milestone',
                       'community', 'referral', 'challenge', 'support', 'grant') then
    raise exception 'KIND_INVALID';
  end if;
  -- The ledger CHECK is a fixed vocabulary; a rule may earn for an event but must still book into one
  -- of these kinds, or the wallet's colouring and filters break.
  if p_ledger_kind not in ('usage', 'publish', 'approval', 'badge', 'grant') then
    raise exception 'LEDGER_KIND_INVALID';
  end if;
  if p_unit is not null and p_unit <> 'per_event' and p_unit not in (
    'per_qualifying_session', 'per_approved_version', 'per_first_approval', 'per_badge', 'per_session',
    'per_day', 'per_hour', 'per_step', 'per_wave', 'per_percent', 'per_report', 'per_comment',
    'per_invite', 'per_vote', 'per_run', 'flat_once', 'per_event'
  ) then
    raise exception 'UNIT_INVALID: %', p_unit;
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'AMOUNT_INVALID'; end if;
  if p_daily_cap is not null and p_daily_cap < p_amount then raise exception 'CAP_BELOW_AMOUNT'; end if;
  if p_weekly_cap is not null and p_daily_cap is not null and p_weekly_cap < p_daily_cap then
    raise exception 'WEEKLY_BELOW_DAILY';
  end if;

  insert into public.currency_rules as r (
    code, kind, amount, unit, daily_cap, weekly_cap, min_qualifying_seconds, min_steps, enabled,
    name_tr, name_en, desc_tr, desc_en, icon, ledger_kind, params
  )
  values (
    v_code, p_kind, p_amount, coalesce(p_unit, 'per_event'), p_daily_cap, p_weekly_cap,
    p_min_seconds, p_min_steps, coalesce(p_enabled, true),
    nullif(btrim(coalesce(p_name_tr, '')), ''), nullif(btrim(coalesce(p_name_en, '')), ''),
    nullif(btrim(coalesce(p_desc_tr, '')), ''), nullif(btrim(coalesce(p_desc_en, '')), ''),
    nullif(lower(btrim(coalesce(p_icon, ''))), ''), coalesce(p_ledger_kind, 'usage'),
    coalesce(p_params, '{}'::jsonb)
  )
  on conflict (code) do update set
    kind = excluded.kind, amount = excluded.amount, unit = excluded.unit,
    daily_cap = excluded.daily_cap, weekly_cap = excluded.weekly_cap,
    min_qualifying_seconds = excluded.min_qualifying_seconds, min_steps = excluded.min_steps,
    enabled = excluded.enabled, name_tr = excluded.name_tr, name_en = excluded.name_en,
    desc_tr = excluded.desc_tr, desc_en = excluded.desc_en,
    icon = excluded.icon, ledger_kind = excluded.ledger_kind, params = excluded.params;

  return jsonb_build_object('code', v_code);
end;
$$;

-- ------------------------------------------------------------ 5. admin money and badge operations

-- An admin grant is a ledger entry with a reason. No ceiling in SQL: the controls are the mandatory
-- note, the audit row and the refusal to pay yourself.
create or replace function public.admin_adjust_balance(
  p_user uuid,
  p_delta integer,
  p_note text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_key text;
  v_balance integer;
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user is null then raise exception 'USER_REQUIRED'; end if;
  if p_user = v_uid then raise exception 'SELF_FORBIDDEN: use the wallet for your own coins'; end if;
  if coalesce(p_delta, 0) = 0 then raise exception 'DELTA_INVALID'; end if;
  if v_note is null then raise exception 'NOTE_REQUIRED'; end if;
  if char_length(v_note) > 300 then raise exception 'NOTE_LONG'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then raise exception 'NOT_FOUND'; end if;

  -- Without a client key, the note itself is the dedupe: the same reason cannot be paid twice in a row.
  v_key := coalesce(
    nullif(btrim(coalesce(p_idempotency_key, '')), ''),
    'admin:' || p_user::text || ':' || md5(p_delta::text || '|' || v_note)
  );

  v_balance := app.ledger_append(
    p_user, p_delta,
    case when p_delta > 0 then 'grant' else 'reverse' end,
    'admin_adjust', 'admin', v_uid::text, v_key, v_uid::text,
    v_note
  );

  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
    values (v_uid, 'adjust_balance', 'profile', p_user,
            jsonb_build_object('delta', p_delta, 'note', v_note, 'balance', v_balance));

  return jsonb_build_object('userId', p_user, 'delta', p_delta, 'balance', v_balance, 'note', v_note);
end;
$$;

-- Manually run a rule for one member: with p_ignore_limits the admin number is paid as typed, otherwise
-- the rule's own clamp, daily and weekly ceilings still apply.
create or replace function public.admin_award_rule(
  p_user uuid,
  p_code text,
  p_amount integer default null,
  p_ignore_limits boolean default false,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_rule public.currency_rules%rowtype;
  v_amount integer;
  v_balance integer;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user is null then raise exception 'USER_REQUIRED'; end if;
  if v_note is null then raise exception 'NOTE_REQUIRED'; end if;

  select * into v_rule from public.currency_rules where code = p_code and enabled;
  if v_rule.code is null then raise exception 'UNKNOWN_RULE: %', p_code; end if;

  v_amount := coalesce(nullif(p_amount, 0), v_rule.amount);
  if v_amount <= 0 then raise exception 'AMOUNT_INVALID'; end if;

  if coalesce(p_ignore_limits, false) then
    v_balance := app.ledger_append(
      p_user, v_amount, v_rule.ledger_kind, v_rule.code, 'admin', v_uid::text,
      'admin-rule:' || p_user::text || ':' || v_rule.code || ':' || md5(v_amount::text || '|' || v_note),
      v_uid::text, v_note
    );
  else
    v_balance := public.award_currency(
      p_user, v_rule.code, v_amount, 'admin', v_uid::text,
      'admin-rule:' || p_user::text || ':' || v_rule.code || ':' || md5(v_amount::text || '|' || v_note)
    );
  end if;

  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
    values (v_uid, 'award_rule', 'profile', p_user,
            jsonb_build_object('rule', v_rule.code, 'amount', v_amount,
                               'ignoreLimits', coalesce(p_ignore_limits, false),
                               'note', v_note, 'balance', v_balance));

  return jsonb_build_object('userId', p_user, 'rule', v_rule.code, 'amount', v_amount,
                            'balance', v_balance, 'paid', v_balance is not null);
end;
$$;

-- The badge drawer for one member: every definition plus whether this member holds it.
create or replace function public.admin_user_badges(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', b.code, 'name', b.name_tr, 'nameEn', b.name_en, 'desc', b.desc_tr,
           'tier', b.tier, 'awardMode', b.award_mode, 'reward', b.currency_reward,
           'iconPath', b.icon_path, 'active', b.active,
           'awarded', ub.user_id is not null, 'awardedAt', ub.awarded_at, 'awardedBy', ub.awarded_by
         ) order by b.tier, b.code), '[]'::jsonb)
    from public.badge_definitions b
    left join public.user_badges ub on ub.code = b.code and ub.user_id = p_user
   where p_user is not null;
$$;

-- Manual award. Coins move only when the admin checks the box, and then through the same rule the
-- auto engine pays from, so a manual badge and an earned one cannot disagree.
create or replace function public.admin_award_badge(
  p_user uuid,
  p_code text,
  p_pay_reward boolean default false,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_badge public.badge_definitions%rowtype;
  v_rule_code text;
  v_reward integer;
  v_balance integer;
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then raise exception 'NOT_FOUND'; end if;

  select * into v_badge from public.badge_definitions where code = p_code;
  if v_badge.code is null then raise exception 'UNKNOWN_BADGE: %', p_code; end if;

  insert into public.user_badges (user_id, code, awarded_by)
    values (p_user, v_badge.code, 'admin')
    on conflict (user_id, code) do update set awarded_by = 'admin';

  if coalesce(p_pay_reward, false) and v_badge.currency_reward > 0 then
    select r.code into v_rule_code from public.currency_rules r
     where r.kind = 'badge' and r.enabled order by r.code limit 1;
    if v_rule_code is not null then
      v_reward := least(v_badge.currency_reward,
                        (select r.amount from public.currency_rules r where r.code = v_rule_code));
      v_balance := public.award_currency(
        p_user, v_rule_code, v_reward, 'admin', v_badge.code,
        'admin-badge:' || p_user::text || ':' || v_badge.code
      );
    end if;
  end if;

  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
    values (v_uid, 'award_badge', 'profile', p_user,
            jsonb_build_object('badge', v_badge.code, 'payReward', coalesce(p_pay_reward, false),
                               'reward', coalesce(v_reward, 0),
                               'note', nullif(btrim(coalesce(p_note, '')), '')));

  return jsonb_build_object('userId', p_user, 'badge', v_badge.code,
                            'reward', coalesce(v_reward, 0), 'balance', v_balance);
end;
$$;

create or replace function public.admin_revoke_badge(p_user uuid, p_code text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;

  delete from public.public_badges where user_id = p_user and code = p_code;
  delete from public.user_badges where user_id = p_user and code = p_code;

  -- Coins already paid for the badge stay paid: clawing back would need a negative ledger row the
  -- member did not agree to, and that is a different operation with its own name.
  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
    values (v_uid, 'revoke_badge', 'profile', p_user,
            jsonb_build_object('badge', p_code, 'note', nullif(btrim(coalesce(p_note, '')), '')));

  return jsonb_build_object('userId', p_user, 'badge', p_code, 'revoked', true);
end;
$$;

-- ------------------------------------------------------------ 6. reads that must now carry the new marks

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

create or replace function public.admin_ledger_search(p_query text default null, p_kind text default null, p_limit integer default 40)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'handle', p.handle, 'userId', l.user_id, 'delta', l.delta,
           'kind', l.kind, 'ruleCode', l.rule_code, 'refType', l.ref_type, 'note', l.note,
           'createdBy', l.created_by, 'at', l.created_at
         ) order by l.id desc), '[]'::jsonb)
    from (
      select l.*
        from public.currency_ledger l
        join public.profiles p on p.id = l.user_id
       where (p_kind is null or p_kind = '' or l.kind = p_kind)
         and (p_query is null or trim(p_query) = ''
              or p.handle ilike '%' || trim(p_query) || '%'
              or coalesce(l.rule_code, '') ilike '%' || trim(p_query) || '%')
       order by l.id desc
       limit greatest(least(p_limit, 200), 1)
    ) l
    join public.profiles p on p.id = l.user_id;
$$;

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

-- Badge tiles in the leaderboard rail finally show the real icon instead of an initial.
create or replace function public.leaderboard_hub(
  p_board text default 'strategies',
  p_metric text default 'sessions',
  p_window text default 'all_time',
  p_limit integer default 50
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_board text := coalesce(p_board, 'strategies');
  v_metric text := coalesce(p_metric, 'sessions');
  v_window text := coalesce(p_window, 'all_time');
  v_limit integer := greatest(least(coalesce(p_limit, 50), 100), 1);
  v_prev_window text;
  v_start timestamptz;
  v_prev_start timestamptz;
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_board not in ('strategies', 'players') then
    raise exception 'BOARD_INVALID';
  end if;
  if v_metric not in ('sessions', 'steps', 'coins', 'publishes') then
    raise exception 'METRIC_INVALID';
  end if;
  if v_window not in ('all_time', 'weekly', 'daily') then
    raise exception 'WINDOW_INVALID';
  end if;

  v_prev_window := case v_window
    when 'daily' then 'weekly'
    when 'weekly' then 'all_time'
    else null
  end;
  v_start := app.leaderboard_window_start(v_window);
  v_prev_start := case when v_prev_window is null then null else app.leaderboard_window_start(v_prev_window) end;

  if v_board = 'strategies' then
    with cur as (
      select g.rank, g.strategy_id, g.name, g.score, g.is_event_strategy, g.map_key,
             s.owner_id, p.handle, p.display_name, p.avatar_path, p.frame_key,
             t.name_tr as title_name,
             app.vip_active(s.owner_id) as vip,
             coalesce(r.sessions_qualified, 0)::integer as sessions,
             coalesce(r.steps_completed, 0)::integer as steps,
             coalesce(r.streak, 0)::integer as streak,
             coalesce(r.active_days, 0)::integer as active_days,
             r.usage_rank_best,
             bd.badges, coalesce(bd.badge_count, 0) as badge_count
        from public.get_leaderboard(v_window, 200) g
        join public.strategies s on s.id = g.strategy_id
        join public.profiles p on p.id = s.owner_id
        left join public.spend_catalog t on t.kind = 'title' and t.ref_code = p.active_title
        left join public.stat_user_rollup r on r.user_id = s.owner_id
        left join lateral (
          select jsonb_agg(
                   jsonb_build_object(
                     'code', b.code,
                     'name', coalesce(b.name_tr, b.name_en, b.code),
                     'tier', b.tier,
                   'iconPath', b.icon_path$1) order by ub.awarded_at desc
                 ) as badges,
                 count(*) as badge_count
            from public.user_badges ub
            join public.badge_definitions b on b.code = ub.code
           where ub.user_id = s.owner_id
        ) bd on true
    ),
    prev as (
      select g.strategy_id, g.rank
        from public.get_leaderboard(coalesce(v_prev_window, v_window), 200) g
       where v_prev_window is not null
    ),
    shaped as (
      select c.rank, c.owner_id, c.score,
             pr.rank as previous_rank,
             case when pr.rank is null then null else pr.rank - c.rank end as movement,
             jsonb_build_object(
               'entityId', c.strategy_id,
               'kind', 'strategy',
               'rank', c.rank,
               'previousRank', pr.rank,
               'movement', case when pr.rank is null then null else pr.rank - c.rank end,
               'score', c.score,
               'name', c.name,
               'playerId', c.owner_id,
               'handle', c.handle,
               'displayName', c.display_name,
               'avatarPath', c.avatar_path,
               'frameKey', c.frame_key,
               'titleName', c.title_name,
               'vip', c.vip,
               'badges', coalesce(c.badges, '[]'::jsonb),
               'badgeCount', c.badge_count,
               'topStrategyId', c.strategy_id,
               'topStrategyName', c.name,
               'mapKey', c.map_key,
               'isEvent', c.is_event_strategy,
               'sessions', c.sessions,
               'steps', c.steps,
               'coins', 0,
               'publishes', 0,
               'streak', c.streak,
               'activeDays', c.active_days,
               'bestRank', c.usage_rank_best
             ) as obj
        from cur c
        left join prev pr on pr.strategy_id = c.strategy_id
    ),
    me_row as (
      select s.* from shaped s where s.owner_id = v_uid order by s.rank limit 1
    ),
    total as (
      select count(*)::integer as n from shaped
    )
    select jsonb_build_object(
      'board', 'strategies',
      'metric', 'sessions',
      'window', v_window,
      'previousWindow', v_prev_window,
      'bucket', app.leaderboard_bucket(v_window),
      'windowStart', case when v_window = 'all_time' then null else v_start end,
      'generatedAt', now(),
      'total', (select n from total),
      'rows', (
        select coalesce(jsonb_agg(obj order by rank), '[]'::jsonb)
          from (select * from shaped order by rank limit v_limit) r
      ),
      'me', (
        select obj || jsonb_build_object(
          'percentile', case
            when (select n from total) > 0
              then greatest(1, round((me_row.rank::numeric / (select n from total)) * 100))::integer
            else null
          end,
          'gapToNext', (select x.score - me_row.score from shaped x where x.rank = me_row.rank - 1)
        )
          from me_row
      ),
      'nearMe', (
        select coalesce(jsonb_agg(obj order by rank), '[]'::jsonb)
          from shaped
         where rank between (select rank from me_row) - 2 and (select rank from me_row) + 2
      ),
      'movers', jsonb_build_object(
        'climbers', (
          select coalesce(jsonb_agg(obj order by movement desc), '[]'::jsonb)
            from (select * from shaped where movement > 0 order by movement desc, rank limit 3) c
        ),
        'fallers', (
          select coalesce(jsonb_agg(obj order by movement asc), '[]'::jsonb)
            from (select * from shaped where movement < 0 order by movement asc, rank limit 3) f
        )
      )
    ) into v_result;

    return v_result;
  end if;

  with users as (
    select p.id, p.handle, p.display_name, p.avatar_path, p.frame_key,
           t.name_tr as title_name,
           app.vip_active(p.id) as vip,
           coalesce(r.streak, 0)::integer as streak,
           coalesce(r.active_days, 0)::integer as active_days,
           r.usage_rank_best,
           ts.id as top_strategy_id,
           ts.name as top_strategy_name,
           bd.badges, coalesce(bd.badge_count, 0) as badge_count
      from public.profiles p
      left join public.spend_catalog t on t.kind = 'title' and t.ref_code = p.active_title
      left join public.stat_user_rollup r on r.user_id = p.id
      left join lateral (
        select s.id, s.name
          from public.strategies s
         where s.owner_id = p.id and s.status in ('approved', 'featured')
         order by s.times_used desc, s.name
         limit 1
      ) ts on true
      left join lateral (
        select jsonb_agg(
                 jsonb_build_object(
                   'code', b.code,
                   'name', coalesce(b.name_tr, b.name_en, b.code),
                   'tier', b.tier,
                 'iconPath', b.icon_path$1) order by ub.awarded_at desc
               ) as badges,
               count(*) as badge_count
          from public.user_badges ub
          join public.badge_definitions b on b.code = ub.code
         where ub.user_id = p.id
      ) bd on true
  ),
  metric_rows as (
    select u.*,
           (
             select count(*)::integer
               from public.overlay_sessions os
              where os.user_id = u.id and os.qualified and os.started_at >= v_start
           ) as sessions,
           (
             select coalesce(sum(os.steps_advanced), 0)::integer
               from public.overlay_sessions os
              where os.user_id = u.id and os.qualified and os.started_at >= v_start
           ) as steps,
           (
             select coalesce(sum(l.delta), 0)::integer
               from public.currency_ledger l
              where l.user_id = u.id and l.delta > 0 and l.created_at >= v_start
           ) as coins,
           (
             select count(*)::integer
               from public.strategies s
              where s.owner_id = u.id and s.status in ('approved', 'featured') and s.created_at >= v_start
           ) as publishes
      from users u
  ),
  scored as (
    select m.*,
           case v_metric
             when 'sessions' then m.sessions
             when 'steps' then m.steps
             when 'coins' then m.coins
             else m.publishes
           end as score
      from metric_rows m
  ),
  ranked as (
    select s.*, row_number() over (order by s.score desc, s.handle asc) as rank
      from scored s
     where s.score > 0
  ),
  prev_scores as (
    select u.id,
           case v_metric
             when 'sessions' then (
               select count(*)::integer from public.overlay_sessions os
                where os.user_id = u.id and os.qualified and os.started_at >= v_prev_start
             )
             when 'steps' then (
               select coalesce(sum(os.steps_advanced), 0)::integer from public.overlay_sessions os
                where os.user_id = u.id and os.qualified and os.started_at >= v_prev_start
             )
             when 'coins' then (
               select coalesce(sum(l.delta), 0)::integer from public.currency_ledger l
                where l.user_id = u.id and l.delta > 0 and l.created_at >= v_prev_start
             )
             else (
               select count(*)::integer from public.strategies s
                where s.owner_id = u.id and s.status in ('approved', 'featured') and s.created_at >= v_prev_start
             )
           end as score
      from users u
     where v_prev_start is not null
  ),
  prev_ranked as (
    select p.id, row_number() over (order by p.score desc, u.handle asc) as rank
      from prev_scores p
      join users u on u.id = p.id
     where p.score > 0
  ),
  shaped as (
    select r.rank, r.id, r.score,
           pr.rank as previous_rank,
           case when pr.rank is null then null else pr.rank - r.rank end as movement,
           jsonb_build_object(
             'entityId', r.id,
             'kind', 'player',
             'rank', r.rank,
             'previousRank', pr.rank,
             'movement', case when pr.rank is null then null else pr.rank - r.rank end,
             'score', r.score,
             'name', coalesce(r.display_name, r.handle),
             'playerId', r.id,
             'handle', r.handle,
             'displayName', r.display_name,
             'avatarPath', r.avatar_path,
             'frameKey', r.frame_key,
             'titleName', r.title_name,
             'vip', r.vip,
             'badges', coalesce(r.badges, '[]'::jsonb),
             'badgeCount', r.badge_count,
             'topStrategyId', r.top_strategy_id,
             'topStrategyName', r.top_strategy_name,
             'mapKey', null,
             'isEvent', false,
             'sessions', r.sessions,
             'steps', r.steps,
             'coins', r.coins,
             'publishes', r.publishes,
             'streak', r.streak,
             'activeDays', r.active_days,
             'bestRank', r.usage_rank_best
           ) as obj
      from ranked r
      left join prev_ranked pr on pr.id = r.id
  ),
  me_row as (
    select s.* from shaped s where s.id = v_uid order by s.rank limit 1
  ),
  total as (
    select count(*)::integer as n from shaped
  )
  select jsonb_build_object(
    'board', 'players',
    'metric', v_metric,
    'window', v_window,
    'previousWindow', v_prev_window,
    'bucket', app.leaderboard_bucket(v_window),
    'windowStart', case when v_window = 'all_time' then null else v_start end,
    'generatedAt', now(),
    'total', (select n from total),
    'rows', (
      select coalesce(jsonb_agg(obj order by rank), '[]'::jsonb)
        from (select * from shaped order by rank limit v_limit) r
    ),
    'me', (
      select obj || jsonb_build_object(
        'percentile', case
          when (select n from total) > 0
            then greatest(1, round((me_row.rank::numeric / (select n from total)) * 100))::integer
          else null
        end,
        'gapToNext', (select x.score - me_row.score from shaped x where x.rank = me_row.rank - 1)
      )
        from me_row
    ),
    'nearMe', (
      select coalesce(jsonb_agg(obj order by rank), '[]'::jsonb)
        from shaped
       where rank between (select rank from me_row) - 2 and (select rank from me_row) + 2
    ),
    'movers', jsonb_build_object(
      'climbers', (
        select coalesce(jsonb_agg(obj order by movement desc), '[]'::jsonb)
          from (select * from shaped where movement > 0 order by movement desc, rank limit 3) c
      ),
      'fallers', (
        select coalesce(jsonb_agg(obj order by movement asc), '[]'::jsonb)
          from (select * from shaped where movement < 0 order by movement asc, rank limit 3) f
      )
    )
  ) into v_result;

  return v_result;
end;
$$;

-- ------------------------------------------------------------ 7. privileges

do $$
declare
  v_sig text;
  v_list text[] := array[
    'public.admin_adjust_balance(uuid, integer, text, text)',
    'public.admin_award_rule(uuid, text, integer, boolean, text)',
    'public.admin_user_badges(uuid)',
    'public.admin_award_badge(uuid, text, boolean, text)',
    'public.admin_revoke_badge(uuid, text, text)',
    'public.admin_upsert_rule(text, text, integer, text, integer, integer, integer, integer, boolean, text, text, text, text, text, text, jsonb)',
    'public.admin_upsert_badge(text, text, text, text, text, text, integer, jsonb, boolean, text)',
    'public.admin_delete_rule(text)'
  ];
  -- 0016 and 0018 took award_currency away from clients for a good reason: its own guard allows
  -- self-award, so a signed-in user could mint up to the daily cap with fresh idempotency keys. The
  -- definer RPCs above reach it as the function owner, so it must stay un-granted.
  v_internal text[] := array[
    'public.award_currency(uuid, text, integer, text, text, text)',
    'app.ledger_append(uuid, integer, text, text, text, text, text, text, text)'
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

  foreach v_sig in array v_internal loop
    if to_regprocedure(v_sig) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', v_sig);
    end if;
  end loop;
end;
$$;

-- currency_ledger gained a column, two RPCs changed signature and five are new: PostgREST must reload.
select pg_notify('pgrst', 'reload schema');

do $$
begin
  raise notice '0038: admin economy and badge hands ready (icons, kinds, caps, decay, manual balance, badge awards).';
end;
$$;
