-- 0.3.6 Faz B: campaigns — earning that has a beginning and an end.
--
-- The economy has had rules since 0003 and none of them could ever stop being true. `currency_rules`
-- carries no window, so a "this weekend, double coins" promotion could only be run by editing every
-- rule by hand and remembering to undo it, and `app.award_currency()` paid whatever the row said,
-- forever. The one campaign-shaped affordance was a `grant`/`flat_once` rule somebody had to fire
-- manually.
--
-- This file adds the missing time dimension and keeps the money decisions in one place:
--
--   * `campaigns`                  — what the member sees: bilingual name and short line, an optional
--                                    long body, a window, a surface (band or modal), an accent, an
--                                    optional image and an optional action.
--   * `campaign_rules`             — an overlay on an existing rule while a campaign lives: a
--                                    multiplier, or a concrete amount, or a different daily cap. The
--                                    rule keeps its identity, so caps, ledger history and the wallet's
--                                    rule list all keep working.
--   * `currency_rules.campaign_key`— a rule minted *for* one campaign. Outside that window it is
--                                    dormant: it answers 0 rather than UNKNOWN_RULE, so the trigger
--                                    paths that call it do not break.
--
-- `app.campaign_overlay_for_rule()` is the single place that decides which live campaign speaks for a
-- rule and what it says, and `award_currency` reads through it. Priority is deliberate: a rule bound to
-- campaign A only ever pays during A, and A's own overlay row wins; a plain rule takes the multiplier
-- from whichever live campaign lists it, earliest start first — so two overlapping campaigns cannot
-- stack into a four-times weekend.
--
-- The ceiling still comes from the rule, never from the caller: `p_amount` is what the event earned and
-- the effective rule amount is the maximum one event may pay. A multiplier raises that ceiling; it does
-- not hand the caller a bigger cheque.
--
-- Nothing here touches prices or the till: `spend_catalog`, `app.effective_price` and `buy_boost` are
-- unchanged. Discounts already have their own mechanism (`discount_percent` + `discount_ends_at`).
-- `admin_upsert_rule` is left exactly as 0038 wrote it — its kind/unit/cap validations stay in one
-- place; binding a rule to a campaign is the separate arm below.
--
-- Deliberately NOT named `events`: `public.events` is the TDS in-game event catalog (0001) and is
-- referenced by `strategies.event_key`. This is a promotion, not a map modifier.
--
-- Safe to run twice. Depends on 0003 (currency_rules, award_currency, ledger_append), 0029 (rule copy
-- columns), 0038 (admin arms, ledger_kind and the caps this file preserves).

-- ------------------------------------------------------------ 1. the two tables

create table if not exists public.campaigns (
  key text primary key,
  name_tr text not null check (length(trim(name_tr)) > 0),
  name_en text not null check (length(trim(name_en)) > 0),
  desc_tr text not null check (length(trim(desc_tr)) > 0),
  desc_en text not null check (length(trim(desc_en)) > 0),
  -- The modal's long text. Null means "the short line is the whole story", and the client then offers
  -- the band without a detail door rather than a modal that repeats one sentence.
  body_tr text,
  body_en text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  surface text not null default 'banner' check (surface in ('banner', 'modal')),
  -- #rrggbb, checked on write: the band paints this, so a hand-typed value cannot break the token chain.
  accent text,
  image_path text,
  action_label_tr text,
  action_label_en text,
  action_url text,
  enabled boolean not null default true,
  created_by text not null default coalesce(auth.uid()::text, 'system'),
  created_at timestamptz not null default now(),
  constraint campaigns_window_check check (ends_at > starts_at),
  constraint campaigns_accent_check check (accent is null or accent ~ '^#[0-9a-fA-F]{6}$'),
  -- The renderer puts this in a link, so an operator's typo must not be able to name a scheme: only
  -- https and the app's own deep link. A CHECK is the only place that holds — the writer is admin-only
  -- and therefore untestable from inside this file.
  constraint campaigns_action_check check (action_url is null or action_url ~ '^(https://|tdsapp://)')
);

create table if not exists public.campaign_rules (
  campaign_key text not null references public.campaigns (key) on delete cascade,
  rule_code text not null references public.currency_rules (code) on delete cascade,
  -- A boost is a multiplier or an explicit amount, never both: 2.0 means "twice the rule", 300 means
  -- "exactly 300 per qualifying event". Bounded above so a typo cannot mint money.
  multiplier numeric not null default 1 check (multiplier > 0 and multiplier <= 5),
  amount_override integer check (amount_override is null or amount_override > 0),
  daily_cap_override integer check (daily_cap_override is null or daily_cap_override >= 0),
  note_tr text,
  note_en text,
  created_at timestamptz not null default now(),
  primary key (campaign_key, rule_code)
);

alter table public.currency_rules
  add column if not exists campaign_key text references public.campaigns (key) on delete set null;

comment on column public.currency_rules.campaign_key is
  'set when the rule exists only for this campaign; award_currency pays it only while the window is live';

-- A campaign is operator content: no member reads the tables, everything goes through the definer
-- functions below. Postgres grants PUBLIC execute by default, so the revoke is the part that matters.
alter table public.campaigns enable row level security;
alter table public.campaign_rules enable row level security;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['campaigns', 'campaign_rules'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
  end loop;
end;
$$;

-- ------------------------------------------------------------ 2. the window, in one place

create or replace function app.campaign_state(p_key text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not c.enabled then 'off'
    when c.starts_at > now() then 'upcoming'
    when c.ends_at <= now() then 'ended'
    else 'live'
  end
  from public.campaigns c
  where c.key = p_key;
$$;

create or replace function app.campaign_live(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select c.enabled and c.starts_at <= now() and c.ends_at > now()
       from public.campaigns c
      where c.key = p_key),
    false
  );
$$;

/**
 * Which live campaign speaks for a rule right now, and what it says. One read-only function, so the
 * money path, the wallet list and the member's banner cannot disagree about the current multiplier.
 *
 * A rule with no campaign answers the neutral `{ campaignKey: null, multiplier: 1 }`, which is what
 * makes the caller's arithmetic the same in both cases.
 */
create or replace function app.campaign_overlay_for_rule(p_rule_code text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'campaignKey', c.key,
        'campaignNameTr', c.name_tr,
        'campaignNameEn', c.name_en,
        'multiplier', cr.multiplier,
        'amountOverride', cr.amount_override,
        'dailyCapOverride', cr.daily_cap_override
      )
      from public.campaign_rules cr
      join public.campaigns c on c.key = cr.campaign_key
      join public.currency_rules r on r.code = cr.rule_code
      where r.code = p_rule_code
        and r.enabled
        and c.enabled
        and c.starts_at <= now()
        and c.ends_at > now()
        -- A rule minted for campaign A ignores B, even while both are live.
        and (r.campaign_key is null or r.campaign_key = c.key)
      -- The rule's own campaign decides its terms; otherwise the earliest start wins so overlapping
      -- promotions cannot multiply each other. `nulls last` matters: for a plain rule the comparison is
      -- null, and it must sort after a real binding rather than before it.
      order by (r.campaign_key = c.key) desc nulls last, c.starts_at asc
      limit 1
    ),
    jsonb_build_object('campaignKey', null, 'multiplier', 1)
  );
$$;

/**
 * A rule minted for a campaign is dormant outside its window. This answers through it instead of
 * raising, because the callers are triggers on a usage flush and a review decision — not a human
 * waiting for an error message.
 *
 * `bool_or` is not a flourish: written as a bare `select case ... from currency_rules where code = ?`,
 * an unknown code returns **no rows**, and a query that returns no rows returns NULL — the
 * `coalesce(...)` wrapped around the CASE would never be reached, because there is no row to
 * coalesce. `false` is the answer the caller needs, and `COALESCE(bool_or(...))` on the empty set is
 * what actually produces it.
 */
create or replace function app.rule_payable_now(p_rule_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    bool_or(
      case
        when r.campaign_key is null then true
        else app.campaign_live(r.campaign_key)
      end
    ),
    false
  )
  from public.currency_rules r
  where r.code = p_rule_code;
$$;

-- ------------------------------------------------------------ 3. the reader the app polls

create or replace function public.active_campaigns()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', c.key,
        'nameTr', c.name_tr,
        'nameEn', c.name_en,
        'descTr', c.desc_tr,
        'descEn', c.desc_en,
        'bodyTr', c.body_tr,
        'bodyEn', c.body_en,
        'startsAt', c.starts_at,
        'endsAt', c.ends_at,
        'state', case when c.starts_at > now() then 'upcoming' else 'live' end,
        'surface', c.surface,
        'accent', c.accent,
        'imagePath', c.image_path,
        'actionLabelTr', c.action_label_tr,
        'actionLabelEn', c.action_label_en,
        'actionUrl', c.action_url,
        'rules', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'code', cr.rule_code,
                'nameTr', r.name_tr,
                'nameEn', r.name_en,
                'kind', r.kind,
                'unit', r.unit,
                'baseAmount', r.amount,
                -- What one qualifying event pays right now, so the wallet can show 600 with an
                -- "etkinlikte ×2" chip instead of making the member multiply.
                'effectiveAmount', coalesce(
                  cr.amount_override,
                  greatest(1, ceil(r.amount * cr.multiplier)::integer)
                ),
                'multiplier', cr.multiplier,
                'dailyCap', coalesce(cr.daily_cap_override, r.daily_cap),
                'noteTr', cr.note_tr,
                'noteEn', cr.note_en,
                'own', coalesce(r.campaign_key = c.key, false)
              )
              order by r.kind, cr.rule_code
            ),
            '[]'::jsonb
          )
          from public.campaign_rules cr
          join public.currency_rules r on r.code = cr.rule_code
          where cr.campaign_key = c.key
        )
      )
      order by c.starts_at asc, c.key
    ),
    '[]'::jsonb
  )
  from public.campaigns c
  where c.enabled
    -- Upcoming campaigns arrive two days early: a band's other job is to tell the member the weekend
    -- doubles before the weekend starts.
    and c.starts_at <= now() + interval '2 days'
    and c.ends_at > now();
$$;

-- ------------------------------------------------------------ 4. award_currency learns about windows

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
  v_overlay jsonb;
  v_ceiling integer;
  v_daily_cap integer;
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

  -- Minted for a campaign that is not running: the rule exists, and it pays nothing.
  if not app.rule_payable_now(p_rule_code) then
    return 0;
  end if;

  v_overlay := app.campaign_overlay_for_rule(p_rule_code);

  -- The per-event ceiling, with the campaign's terms applied to it. `ceil` matches what
  -- active_campaigns() advertises, so a member is never paid one coin less than the band promised.
  v_ceiling := coalesce(
    nullif(v_overlay ->> 'amountOverride', '')::integer,
    greatest(1, ceil(v_rule.amount * coalesce((v_overlay ->> 'multiplier')::numeric, 1))::integer)
  );
  v_amount := least(p_amount, v_ceiling);
  if v_amount <= 0 then
    return 0;
  end if;

  v_daily_cap := coalesce(nullif(v_overlay ->> 'dailyCapOverride', '')::integer, v_rule.daily_cap);

  if v_daily_cap is not null then
    select coalesce(sum(delta), 0) into v_today
      from public.currency_ledger
      where user_id = p_user
        and rule_code = p_rule_code
        and created_at >= date_trunc('day', now());
    v_amount := least(v_amount, greatest(0, v_daily_cap - coalesce(v_today, 0)));
    if v_amount <= 0 then
      return 0;
    end if;
  end if;

  -- weekly_cap has been editable and validated since 0029 while nothing ever enforced it; a rule that
  -- says 200/week now stops at 200/week. Campaigns inherit that ceiling untouched — a double weekend
  -- cannot become an infinite one.
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

  -- decay_after_sessions: past the threshold, each further award of the same rule on the same day pays
  -- half (floor 1 coin), so grinding cannot mint money. Measured as a count of ledger rows against the
  -- base rule, so a campaign doubles the reward without also doubling the grind limit.
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

-- ------------------------------------------------------------ 5. the operator's arms

create or replace function public.admin_list_campaigns()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_out jsonb;
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN: admin only';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', c.key,
        'nameTr', c.name_tr,
        'nameEn', c.name_en,
        'descTr', c.desc_tr,
        'descEn', c.desc_en,
        'bodyTr', c.body_tr,
        'bodyEn', c.body_en,
        'startsAt', c.starts_at,
        'endsAt', c.ends_at,
        'state', app.campaign_state(c.key),
        'surface', c.surface,
        'accent', c.accent,
        'imagePath', c.image_path,
        'actionLabelTr', c.action_label_tr,
        'actionLabelEn', c.action_label_en,
        'actionUrl', c.action_url,
        'enabled', c.enabled,
        'rules', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'code', cr.rule_code,
                'multiplier', cr.multiplier,
                'amountOverride', cr.amount_override,
                'dailyCapOverride', cr.daily_cap_override,
                'noteTr', cr.note_tr,
                'noteEn', cr.note_en,
                'ruleNameTr', r.name_tr,
                'ruleNameEn', r.name_en,
                'ruleKind', r.kind,
                'ruleUnit', r.unit,
                'ruleAmount', r.amount,
                'own', coalesce(r.campaign_key = c.key, false)
              )
              order by cr.rule_code
            ),
            '[]'::jsonb
          )
          from public.campaign_rules cr
          join public.currency_rules r on r.code = cr.rule_code
          where cr.campaign_key = c.key
        ),
        -- Rules minted for this campaign, so the editor can say "these three rows exist only now".
        'boundRules', (
          select coalesce(jsonb_agg(jsonb_build_object('code', r.code, 'nameTr', r.name_tr, 'nameEn', r.name_en,
                                                       'enabled', r.enabled) order by r.code), '[]'::jsonb)
          from public.currency_rules r
          where r.campaign_key = c.key
        )
      )
      order by c.starts_at desc, c.key
    ),
    '[]'::jsonb
  )
  into v_out
  from public.campaigns c;

  return v_out;
end;
$$;

create or replace function public.admin_upsert_campaign(
  p_key text,
  p_name_tr text,
  p_name_en text,
  p_desc_tr text,
  p_desc_en text,
  p_body_tr text default null,
  p_body_en text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_surface text default 'banner',
  p_accent text default null,
  p_image_path text default null,
  p_action_label_tr text default null,
  p_action_label_en text default null,
  p_action_url text default null,
  p_enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN: admin only';
  end if;

  v_key := lower(btrim(coalesce(p_key, '')));
  if v_key !~ '^[a-z0-9][a-z0-9-]{1,47}$' then
    raise exception 'INVALID_KEY: use 2-48 characters of a-z, 0-9 and dash';
  end if;
  if nullif(btrim(coalesce(p_name_tr, '')), '') is null
     or nullif(btrim(coalesce(p_name_en, '')), '') is null then
    raise exception 'INVALID_NAME: both languages are required';
  end if;
  if nullif(btrim(coalesce(p_desc_tr, '')), '') is null
     or nullif(btrim(coalesce(p_desc_en, '')), '') is null then
    raise exception 'INVALID_DESC: the short line is required in both languages';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'INVALID_WINDOW: the campaign must end after it starts';
  end if;
  -- Saving something nobody could ever see is almost always a date mistake, so it is refused rather
  -- than stored. A campaign that has run stays in the list for the record; disable it instead.
  if p_ends_at <= now() then
    raise exception 'INVALID_WINDOW: this campaign is already over — change the dates';
  end if;
  if p_surface not in ('banner', 'modal') then
    raise exception 'INVALID_SURFACE: use banner or modal';
  end if;

  insert into public.campaigns (
    key, name_tr, name_en, desc_tr, desc_en, body_tr, body_en,
    starts_at, ends_at, surface, accent, image_path,
    action_label_tr, action_label_en, action_url, enabled, created_by
  )
  values (
    v_key, btrim(p_name_tr), btrim(p_name_en), btrim(p_desc_tr), btrim(p_desc_en),
    nullif(btrim(coalesce(p_body_tr, '')), ''), nullif(btrim(coalesce(p_body_en, '')), ''),
    p_starts_at, p_ends_at, p_surface,
    nullif(btrim(coalesce(p_accent, '')), ''), nullif(btrim(coalesce(p_image_path, '')), ''),
    nullif(btrim(coalesce(p_action_label_tr, '')), ''), nullif(btrim(coalesce(p_action_label_en, '')), ''),
    nullif(btrim(coalesce(p_action_url, '')), ''), coalesce(p_enabled, true),
    coalesce(auth.uid()::text, 'system')
  )
  on conflict (key) do update set
    name_tr = excluded.name_tr,
    name_en = excluded.name_en,
    desc_tr = excluded.desc_tr,
    desc_en = excluded.desc_en,
    body_tr = excluded.body_tr,
    body_en = excluded.body_en,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    surface = excluded.surface,
    accent = excluded.accent,
    image_path = excluded.image_path,
    action_label_tr = excluded.action_label_tr,
    action_label_en = excluded.action_label_en,
    action_url = excluded.action_url,
    enabled = excluded.enabled;

  return jsonb_build_object('code', v_key, 'state', app.campaign_state(v_key));
end;
$$;

/**
 * The campaign's earning sheet, written in one call. The array is
 * [{ code, multiplier, amountOverride, dailyCapOverride, noteTr, noteEn }] — the same rule vocabulary
 * the economy editor already uses, so an operator picks a rule from a list instead of typing a code.
 */
create or replace function public.admin_set_campaign_rules(p_key text, p_rules jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry jsonb;
  v_code text;
  v_multiplier numeric;
  v_amount integer;
  v_cap integer;
  v_kept text[] := '{}';
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN: admin only';
  end if;

  if not exists (select 1 from public.campaigns where key = p_key) then
    raise exception 'UNKNOWN_CAMPAIGN: %', p_key;
  end if;

  if jsonb_typeof(coalesce(p_rules, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_RULES: expected an array';
  end if;

  delete from public.campaign_rules where campaign_key = p_key;

  for v_entry in select * from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) loop
    v_code := nullif(btrim(coalesce(v_entry ->> 'code', '')), '');
    if v_code is null then
      continue;
    end if;
    if not exists (select 1 from public.currency_rules where code = v_code) then
      raise exception 'UNKNOWN_RULE: %', v_code;
    end if;
    if v_code = any (v_kept) then
      raise exception 'DUPLICATE_RULE: % listed twice', v_code;
    end if;

    v_multiplier := coalesce(nullif(v_entry ->> 'multiplier', '')::numeric, 1);
    if v_multiplier <= 0 or v_multiplier > 5 then
      raise exception 'INVALID_MULTIPLIER: % is outside 0.1-5', v_multiplier;
    end if;

    v_amount := nullif(coalesce(v_entry ->> 'amountOverride', ''), '')::integer;
    if v_amount is not null and v_amount <= 0 then
      raise exception 'INVALID_AMOUNT: a campaign amount must be positive or empty';
    end if;

    v_cap := nullif(coalesce(v_entry ->> 'dailyCapOverride', ''), '')::integer;
    if v_cap is not null and v_cap < 0 then
      raise exception 'INVALID_CAP: a daily cap cannot be negative';
    end if;
    -- The same rule the economy editor refuses: a cap below one event's pay makes the cap the amount,
    -- and the member sees the cap as a bug in the campaign.
    if v_cap is not null and v_amount is not null and v_cap < v_amount then
      raise exception 'CAP_BELOW_AMOUNT: % caps below its own amount', v_code;
    end if;

    v_kept := array_append(v_kept, v_code);

    insert into public.campaign_rules (
      campaign_key, rule_code, multiplier, amount_override, daily_cap_override, note_tr, note_en
    )
    values (
      p_key, v_code, v_multiplier, v_amount, v_cap,
      nullif(btrim(coalesce(v_entry ->> 'noteTr', '')), ''),
      nullif(btrim(coalesce(v_entry ->> 'noteEn', '')), '')
    );
  end loop;

  return jsonb_build_object('campaignKey', p_key, 'rules', to_jsonb(v_kept));
end;
$$;

/**
 * Binding a plain rule to a campaign, or detaching it again. 0038's `admin_upsert_rule` is left alone
 * on purpose: its kind, unit and cap validations are the economy's own, and a campaign should not
 * duplicate them in a second copy that can drift.
 */
create or replace function public.admin_set_rule_campaign(p_code text, p_campaign_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN: admin only';
  end if;

  if not exists (select 1 from public.currency_rules where code = p_code) then
    raise exception 'UNKNOWN_RULE: %', p_code;
  end if;
  if p_campaign_key is not null and not exists (select 1 from public.campaigns where key = p_campaign_key) then
    raise exception 'UNKNOWN_CAMPAIGN: %', p_campaign_key;
  end if;

  update public.currency_rules set campaign_key = p_campaign_key where code = p_code;

  return jsonb_build_object('code', p_code, 'campaignKey', p_campaign_key);
end;
$$;

/**
 * Deleting a campaign must not leave a rule that pays forever. Rules minted for it are disabled first,
 * not deleted — the ledger already cites their codes, and a wallet history row has to keep resolving to
 * a named rule.
 */
create or replace function public.admin_delete_campaign(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_disabled integer;
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN: admin only';
  end if;

  update public.currency_rules set enabled = false where campaign_key = p_key;
  get diagnostics v_disabled = row_count;

  delete from public.campaigns where key = p_key;
  if not found then
    raise exception 'UNKNOWN_CAMPAIGN: %', p_key;
  end if;

  return jsonb_build_object('campaignKey', p_key, 'rulesDisabled', v_disabled);
end;
$$;

-- ------------------------------------------------------------ 6. privileges

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.active_campaigns()',
    'public.admin_list_campaigns()',
    'public.admin_upsert_campaign(text, text, text, text, text, text, text, timestamptz, timestamptz, text, text, text, text, text, text, boolean)',
    'public.admin_set_campaign_rules(text, jsonb)',
    'public.admin_set_rule_campaign(text, text)',
    'public.admin_delete_campaign(text)'
  ] loop
    if to_regprocedure(v_sig) is not null then
      execute format('grant execute on function %s to authenticated', v_sig);
    end if;
    if to_regprocedure(v_sig) is null then
      raise warning '0051: % was not created', v_sig;
    end if;
  end loop;

  -- The banner reader is called before sign-in too: a visitor should see that the weekend doubles.
  if to_regprocedure('public.active_campaigns()') is not null then
    execute 'grant execute on function public.active_campaigns() to anon';
  end if;

  -- Window helpers answer from inside the server; a member never calls them over HTTP.
  foreach v_sig in array array[
    'app.campaign_state(text)',
    'app.campaign_live(text)',
    'app.campaign_overlay_for_rule(text)',
    'app.rule_payable_now(text)'
  ] loop
    if to_regprocedure(v_sig) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', v_sig);
    end if;
  end loop;
end;
$$;

-- ------------------------------------------------------------ 7. prove it landed

do $$
declare
  v_rule text;
  v_overlay jsonb;
  v_state text;
begin
  if to_regclass('public.campaigns') is null or to_regclass('public.campaign_rules') is null then
    raise exception '0051 failed: the campaign tables are missing';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'campaigns_window_check' and conrelid = 'public.campaigns'::regclass
  ) then
    raise exception '0051 failed: a campaign can still end before it starts';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'campaigns_action_check' and conrelid = 'public.campaigns'::regclass
  ) then
    raise exception '0051 failed: an action url is still unrestricted';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'currency_rules' and column_name = 'campaign_key'
  ) then
    raise exception '0051 failed: currency_rules cannot be bound to a campaign';
  end if;

  -- The overlay resolver must answer for a real rule and must not invent a campaign.
  select code into v_rule from public.currency_rules where enabled order by code limit 1;
  if v_rule is null then
    raise exception '0051 failed: there is no enabled rule to test the overlay against';
  end if;

  v_overlay := app.campaign_overlay_for_rule(v_rule);
  if v_overlay ? 'campaignKey' and (v_overlay ->> 'campaignKey') is not null then
    raise exception '0051 failed: a campaign answered while none is live';
  end if;
  if coalesce((v_overlay ->> 'multiplier')::numeric, 0) <> 1 then
    raise exception '0051 failed: a rule with no campaign must multiply by 1, got %', v_overlay ->> 'multiplier';
  end if;

  if app.rule_payable_now(v_rule) is distinct from true then
    raise exception '0051 failed: a plain rule stopped being payable';
  end if;

  if app.rule_payable_now('no_such_rule_at_all') is distinct from false then
    raise exception '0051 failed: an unknown rule should not read as payable';
  end if;

  v_state := app.campaign_state('definitely-not-a-campaign');
  if v_state is not null and v_state <> 'off' then
    raise exception '0051 failed: an unknown campaign should read off or null, got %', v_state;
  end if;

  -- The money path must actually go through the window; a re-deploy of the old body would pass every
  -- other check in this file.
  if pg_get_functiondef('public.award_currency(uuid, text, integer, text, text, text)'::regprocedure)
     not like '%rule_payable_now%' then
    raise exception '0051 failed: award_currency still ignores campaign windows';
  end if;

  -- 0038's rule editor must still be the one editor: this file adds a binder, not a second writer.
  if to_regprocedure('public.admin_set_rule_campaign(text, text)') is null then
    raise exception '0051 failed: the rule binder is missing';
  end if;

  raise notice '0051 ok: etkinlikler tarih penceresiyle yaşıyor — kurallar ya bu pencerede çarpanla ödüyor ya da kendi kampanyasıyla.';
end;
$$;

select pg_notify('pgrst', 'reload schema');
