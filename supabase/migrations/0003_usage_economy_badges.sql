-- 0003: usage measurement, currency ledger, badges and leaderboard
-- Invariants: the client can never write a balance, a badge or a usage counter.

create table if not exists public.overlay_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  version_id uuid references public.strategy_versions (id) on delete set null,
  nonce uuid not null unique default gen_random_uuid(),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  steps_advanced integer not null default 0,
  max_step integer not null default 0,
  display_id text,
  app_version text,
  hook_backend text,
  qualified boolean not null default false,
  check (ended_at is null or ended_at >= started_at)
);

create index if not exists overlay_sessions_user_idx on public.overlay_sessions (user_id, started_at desc);
create index if not exists overlay_sessions_strategy_idx on public.overlay_sessions (strategy_id, started_at desc);

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.overlay_sessions (id) on delete cascade,
  seq integer not null check (seq > 0),
  step_no integer not null,
  direction text not null check (direction in ('forward', 'back', 'reset')),
  occurred_at timestamptz not null,
  unique (session_id, seq)
);

create table if not exists public.strategy_usage_daily (
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  day date not null,
  uses integer not null default 0,
  unique_users integer not null default 0,
  steps_completed integer not null default 0,
  sessions_qualified integer not null default 0,
  primary key (strategy_id, day)
);

create table if not exists public.leaderboard_config (
  board_window text primary key check (board_window in ('all_time', 'weekly', 'daily')),
  weight_users numeric(4, 3) not null default 0.700,
  weight_uses numeric(4, 3) not null default 0.300,
  decay numeric(4, 3) not null default 0.900
);

insert into public.leaderboard_config (board_window) values ('all_time'), ('weekly'), ('daily')
  on conflict (board_window) do nothing;

create table if not exists public.leaderboard_snapshots (
  board_window text not null,
  bucket text not null,
  rank integer not null,
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  score numeric(12, 4) not null,
  computed_at timestamptz not null default now(),
  primary key (board_window, bucket, strategy_id)
);

create index if not exists leaderboard_rank_idx on public.leaderboard_snapshots (board_window, bucket, rank);

-- ---------------------------------------------------------------- economy

create table if not exists public.currency_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta integer not null check (delta <> 0),
  kind text not null check (kind in ('usage', 'publish', 'approval', 'badge', 'spend', 'refund', 'grant', 'reverse')),
  rule_code text,
  ref_type text,
  ref_id text,
  idempotency_key text unique,
  balance_after integer not null,
  prev_hash text,
  entry_hash text,
  created_by text not null default coalesce(auth.uid()::text, 'system'),
  created_at timestamptz not null default now()
);

create index if not exists currency_ledger_user_idx on public.currency_ledger (user_id, created_at desc);

create table if not exists public.currency_rules (
  code text primary key,
  kind text not null check (kind in ('usage', 'publish', 'approval', 'badge', 'grant')),
  amount integer not null,
  unit text not null default 'per_event',
  daily_cap integer,
  weekly_cap integer,
  min_qualifying_seconds integer,
  min_steps integer,
  enabled boolean not null default true,
  params jsonb not null default '{}'::jsonb
);

create table if not exists public.spend_catalog (
  sku text primary key,
  kind text not null check (kind in ('badge', 'theme', 'boost', 'cosmetic')),
  price integer not null check (price > 0),
  ref_code text,
  stock integer,
  enabled boolean not null default true
);

create table if not exists public.spend_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  sku text not null references public.spend_catalog (sku),
  price_paid integer not null,
  status text not null default 'filled' check (status in ('filled', 'reversed', 'failed')),
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.profile_themes (
  key text primary key,
  name_tr text not null,
  price integer not null check (price >= 0),
  css jsonb not null default '{}'::jsonb,
  preview_path text
);

create table if not exists public.user_themes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  theme_key text not null references public.profile_themes (key),
  primary key (user_id, theme_key)
);

create table if not exists public.strategy_boosts (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  sku text references public.spend_catalog (sku),
  slots integer not null default 1,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'expired', 'reversed')),
  check (ends_at > starts_at)
);

create index if not exists strategy_boosts_active_idx on public.strategy_boosts (ends_at desc) where status = 'active';

-- ---------------------------------------------------------------- badges

create table if not exists public.badge_metrics (
  metric text primary key,
  source_table text not null,
  operators text[] not null default '{gte,lte,eq}',
  description text
);

create table if not exists public.badge_definitions (
  code text primary key,
  name_tr text not null,
  name_en text,
  desc_tr text,
  icon_path text,
  tier text not null default 'bronze' check (tier in ('bronze', 'silver', 'gold', 'special')),
  conditions jsonb not null,
  award_mode text not null default 'auto' check (award_mode in ('auto', 'manual')),
  currency_reward integer not null default 0 check (currency_reward >= 0),
  active boolean not null default true
);

create table if not exists public.user_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  code text not null references public.badge_definitions (code) on delete cascade,
  awarded_at timestamptz not null default now(),
  awarded_by text,
  primary key (user_id, code)
);

create table if not exists public.public_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  code text not null references public.badge_definitions (code) on delete cascade,
  slot smallint not null check (slot between 1 and 4),
  primary key (user_id, slot)
);

create table if not exists public.stat_user_rollup (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  strategies_published integer not null default 0,
  approvals_received integer not null default 0,
  imports_completed integer not null default 0,
  steps_completed integer not null default 0,
  sessions_qualified integer not null default 0,
  distinct_maps integer not null default 0,
  usage_rank_best integer,
  comments_count integer not null default 0,
  upvotes_received integer not null default 0,
  active_days integer not null default 0,
  streak integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS

alter table public.overlay_sessions enable row level security;
alter table public.usage_events enable row level security;
alter table public.strategy_usage_daily enable row level security;
alter table public.leaderboard_config enable row level security;
alter table public.leaderboard_snapshots enable row level security;
alter table public.currency_ledger enable row level security;
alter table public.currency_rules enable row level security;
alter table public.spend_catalog enable row level security;
alter table public.spend_orders enable row level security;
alter table public.profile_themes enable row level security;
alter table public.user_themes enable row level security;
alter table public.strategy_boosts enable row level security;
alter table public.badge_definitions enable row level security;
alter table public.badge_metrics enable row level security;
alter table public.user_badges enable row level security;
alter table public.public_badges enable row level security;
alter table public.stat_user_rollup enable row level security;

drop policy if exists sessions_owner_rw on public.overlay_sessions;
create policy sessions_owner_rw on public.overlay_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists sessions_admin_read on public.overlay_sessions;
create policy sessions_admin_read on public.overlay_sessions
  for select using (app.is_admin());

drop policy if exists usage_owner_write on public.usage_events;
create policy usage_owner_write on public.usage_events
  for insert with check (
    exists (select 1 from public.overlay_sessions s where s.id = session_id and s.user_id = auth.uid())
  );
drop policy if exists usage_owner_read on public.usage_events;
create policy usage_owner_read on public.usage_events
  for select using (
    exists (select 1 from public.overlay_sessions s where s.id = session_id and s.user_id = auth.uid())
  );

drop policy if exists usage_daily_read on public.strategy_usage_daily;
create policy usage_daily_read on public.strategy_usage_daily for select using (true);
drop policy if exists leaderboard_read on public.leaderboard_snapshots;
create policy leaderboard_read on public.leaderboard_snapshots for select using (true);
drop policy if exists leaderboard_config_read on public.leaderboard_config;
create policy leaderboard_config_read on public.leaderboard_config for select using (true);
drop policy if exists currency_rules_read on public.currency_rules;
create policy currency_rules_read on public.currency_rules for select using (true);
drop policy if exists spend_catalog_read on public.spend_catalog;
create policy spend_catalog_read on public.spend_catalog for select using (true);
drop policy if exists themes_read on public.profile_themes;
create policy themes_read on public.profile_themes for select using (true);
drop policy if exists badges_read on public.badge_definitions;
create policy badges_read on public.badge_definitions for select using (true);
drop policy if exists badge_metrics_read on public.badge_metrics;
create policy badge_metrics_read on public.badge_metrics for select using (true);

-- The ledger is append-only and machine-written: reads are own/admin, and no client
-- INSERT/UPDATE/DELETE policy exists at all, so every write must go through a definer RPC.
drop policy if exists ledger_read on public.currency_ledger;
create policy ledger_read on public.currency_ledger
  for select using (user_id = auth.uid() or app.is_admin());
drop policy if exists orders_read on public.spend_orders;
create policy orders_read on public.spend_orders
  for select using (user_id = auth.uid() or app.is_admin());
drop policy if exists user_themes_read on public.user_themes;
create policy user_themes_read on public.user_themes for select using (user_id = auth.uid() or app.is_admin());
drop policy if exists user_badges_read on public.user_badges;
create policy user_badges_read on public.user_badges for select using (user_id = auth.uid() or app.is_admin());
drop policy if exists public_badges_rw on public.public_badges;
create policy public_badges_rw on public.public_badges
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists rollup_read on public.stat_user_rollup;
create policy rollup_read on public.stat_user_rollup for select using (true);
drop policy if exists boosts_read on public.strategy_boosts;
create policy boosts_read on public.strategy_boosts for select using (true);

revoke update, delete, truncate on public.currency_ledger from authenticated, anon;
revoke insert, update, delete, truncate on public.strategy_usage_daily from authenticated, anon;
revoke insert, update, delete, truncate on public.leaderboard_snapshots from authenticated, anon;
revoke insert, update, delete, truncate on public.stat_user_rollup from authenticated, anon;
revoke insert, update, delete, truncate on public.user_badges from authenticated, anon;
revoke insert, update, delete, truncate on public.currency_rules, public.spend_catalog, public.badge_definitions from authenticated;

-- ---------------------------------------------------------------- money paths

create or replace function app.ledger_append(
  p_user uuid,
  p_delta integer,
  p_kind text,
  p_rule text,
  p_ref_type text,
  p_ref_id text,
  p_idem text,
  p_created_by text
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
      (user_id, delta, kind, rule_code, ref_type, ref_id, idempotency_key, balance_after, prev_hash, entry_hash, created_by)
    values
      (p_user, p_delta, p_kind, p_rule, p_ref_type, p_ref_id, p_idem, v_after,
       v_prev_hash,
       encode(digest(coalesce(v_prev_hash, '') || p_user::text || p_delta::text || coalesce(p_idem, ''), 'sha256'), 'hex'),
       p_created_by);

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
begin
  if p_user is distinct from auth.uid() and not app.is_admin() then
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

  return app.ledger_append(p_user, v_amount, v_rule.kind, v_rule.code, p_ref_type, p_ref_id,
                           p_idempotency_key, coalesce(auth.uid()::text, 'rpc'));
end;
$$;

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
begin
  select * into v_item from public.spend_catalog where sku = p_sku and enabled;
  if not found then
    raise exception 'UNKNOWN_SKU: %', p_sku;
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

  -- Balance comes from the ledger, never from the cached column.
  select coalesce(sum(delta), 0) into v_balance from public.currency_ledger where user_id = v_user;
  if v_balance < v_item.price then
    raise exception 'INSUFFICIENT_FUNDS: need % have %', v_item.price, v_balance;
  end if;

  insert into public.spend_orders (user_id, sku, price_paid, idempotency_key)
    values (v_user, p_sku, v_item.price, p_idempotency_key)
    returning id into v_order;

  v_balance := app.ledger_append(v_user, -v_item.price, 'spend', v_item.sku, 'order', v_order::text,
                                 p_idempotency_key, v_user::text);

  if v_item.kind = 'theme' then
    insert into public.user_themes (user_id, theme_key)
      values (v_user, v_item.ref_code) on conflict do nothing;
  elsif v_item.kind = 'badge' then
    insert into public.user_badges (user_id, code, awarded_by)
      values (v_user, v_item.ref_code, 'purchase') on conflict do nothing;
  elsif v_item.kind = 'boost' then
    insert into public.strategy_boosts (strategy_id, buyer_id, sku, ends_at)
      values (v_item.ref_code::uuid, v_user, v_item.sku, now() + interval '72 hours');
  end if;

  return query select v_order, v_balance;
end;
$$;

create or replace function public.verify_balance(p_user uuid)
returns table (ledger_balance integer, cached_balance integer, matches boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select coalesce((select sum(delta) from public.currency_ledger where user_id = p_user), 0)::integer,
           (select currency_balance_cache from public.profiles where id = p_user),
           coalesce((select sum(delta) from public.currency_ledger where user_id = p_user), 0)::integer
             = coalesce((select currency_balance_cache from public.profiles where id = p_user), 0);
end;
$$;

-- ---------------------------------------------------------------- usage flush

create or replace function public.start_overlay_session(
  p_strategy_id uuid,
  p_display_id text,
  p_app_version text,
  p_hook_backend text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_version uuid;
  v_session uuid;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;

  select s.current_version_id into v_version
    from public.strategies s
    where s.id = p_strategy_id and s.status in ('approved', 'featured');
  if v_version is null then
    raise exception 'NOT_PUBLISHED: strategy has no live version';
  end if;

  insert into public.overlay_sessions
      (user_id, strategy_id, version_id, display_id, app_version, hook_backend)
    values (v_user, p_strategy_id, v_version, p_display_id, p_app_version, p_hook_backend)
    returning id into v_session;

  return v_session;
end;
$$;

create or replace function public.flush_usage(
  p_session_id uuid,
  p_nonce uuid,
  p_events jsonb
)
returns table (qualified boolean, awarded integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.overlay_sessions%rowtype;
  v_user uuid := auth.uid();
  v_rule public.currency_rules%rowtype;
  v_forward integer := 0;
  v_max integer := 0;
  v_seconds integer;
  v_is_qualified boolean := false;
  v_award integer;
  v_recent integer;
begin
  select * into v_session from public.overlay_sessions where id = p_session_id;
  if not found or v_session.user_id is distinct from v_user or v_session.nonce is distinct from p_nonce then
    raise exception 'FORBIDDEN: session does not belong to this client';
  end if;
  if v_session.ended_at is not null then
    return query select v_session.qualified, 0;
    return;
  end if;

  insert into public.usage_events (session_id, seq, step_no, direction, occurred_at)
    select p_session_id,
           (t.elem ->> 'seq')::integer,
           (t.elem ->> 'stepNo')::integer,
           (t.elem ->> 'direction'),
           to_timestamp((t.elem ->> 'at')::double precision / 1000.0)
    from jsonb_array_elements(p_events) with ordinality as t(elem, ord)
    on conflict (session_id, seq) do nothing;

  select count(*) filter (where direction = 'forward'), max(step_no)
    into v_forward, v_max
    from public.usage_events where session_id = p_session_id;

  v_seconds := greatest(0, floor(extract(epoch from (now() - v_session.started_at)))::integer);

  select * into v_rule from public.currency_rules where kind = 'usage' and enabled order by code limit 1;

  if v_rule is not null then
    select count(*) into v_recent
      from public.overlay_sessions
      where user_id = v_user
        and strategy_id = v_session.strategy_id
        and qualified
        and started_at > now() - interval '6 hours';

    v_is_qualified := v_seconds >= coalesce(v_rule.min_qualifying_seconds, 180)
      and v_forward >= coalesce(v_rule.min_steps, 5)
      and v_recent = 0;
  end if;

  update public.overlay_sessions
    set ended_at = now(), steps_advanced = coalesce(v_forward, 0), max_step = coalesce(v_max, 0), qualified = v_is_qualified
    where id = p_session_id;

  insert into public.strategy_usage_daily (strategy_id, day, uses, steps_completed, sessions_qualified)
    values (v_session.strategy_id, current_date, 1, coalesce(v_forward, 0), case when v_is_qualified then 1 else 0 end)
    on conflict (strategy_id, day)
      do update set uses = public.strategy_usage_daily.uses + 1,
                    steps_completed = public.strategy_usage_daily.steps_completed + excluded.steps_completed,
                    sessions_qualified = public.strategy_usage_daily.sessions_qualified + excluded.sessions_qualified;

  update public.strategies
    set times_used = times_used + case when v_is_qualified then 1 else 0 end
    where id = v_session.strategy_id;

  if v_is_qualified and v_rule is not null then
    v_award := public.award_currency(v_user, v_rule.code, v_rule.amount, 'session', p_session_id::text, p_session_id::text || ':usage');
  else
    v_award := 0;
  end if;

  return query select v_is_qualified, coalesce(v_award, 0);
end;
$$;

create or replace function public.get_leaderboard(p_window text default 'all_time', p_limit integer default 50)
returns table (rank integer, strategy_id uuid, name text, score numeric, is_event_strategy boolean, map_key text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with source as (
    select l.rank, l.strategy_id, l.score
      from public.leaderboard_snapshots l
      where l.board_window = p_window
        and l.bucket = case
                        when p_window = 'weekly' then to_char(now() - interval '1 day', 'IYYY-IW')
                        when p_window = 'daily' then to_char(current_date - 1, 'YYYY-MM-DD')
                        else 'all'
                      end
      order by l.rank
      limit least(p_limit, 200)
  )
  select s.rank, s.strategy_id, st.name, s.score, st.is_event_strategy, st.map_key
    from source s
    join public.strategies st on st.id = s.strategy_id
    where st.status in ('approved', 'featured')
    order by s.rank;
$$;

grant execute on function public.start_overlay_session(uuid, text, text, text) to authenticated;
grant execute on function public.flush_usage(uuid, uuid, jsonb) to authenticated;
grant execute on function public.award_currency(uuid, text, integer, text, text, text) to authenticated;
grant execute on function public.spend_currency(text, text) to authenticated;
grant execute on function public.get_leaderboard(text, integer) to anon, authenticated;
grant execute on function public.verify_balance(uuid) to authenticated;
