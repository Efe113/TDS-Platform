-- 0019: the retention layer's foundation - real statistics, a badge engine, and a public profile.
--
-- What is broken today. stat_user_rollup gets one empty row per signup (0004) and is never written
-- again, so every metric stays 0; badge_definitions ships four auto badges whose conditions read
-- exactly those metrics, so no badge can ever be earned; and there is no public read of a user's
-- badges/theme/stats, so a profile page cannot exist yet.
--
-- Decisions worth knowing before changing any of this:
--
--   * Metrics are recomputed from source tables, never incremented. An increment drifts after a
--     failed transaction or a backfill; a recompute is idempotent, so it can run on every write and
--     whenever the subject (or a moderator) reads the profile.
--   * comments_count and upvotes_received belong to M8b (no tables yet) and are deliberately absent
--     from the upsert, so a future milestone owns them without this file fighting over them.
--   * Badge conditions stay declarative jsonb. The engine validates each op against
--     badge_metrics.operators for that metric, so the admin panel cannot quietly invent a "gt" that
--     nothing implements.
--   * Badge currency goes through award_currency with the key "badge:<user>:<code>", so a re-run
--     cannot pay twice; the 'badge_reward' rule seeded below is the per-award upper bound, the badge
--     row's own currency_reward is what is actually paid.
--   * profile_showcase is VOLATILE, not STABLE: it refreshes the subject's rollup, and a stable
--     function must not write. Anonymous browsing stays a pure read - only the subject themselves or
--     a moderator triggers the recompute, so public traffic cannot turn into writes.
--   * award_currency's guard said "you may only award to yourself, unless you are an admin". A
--     moderator approving somebody else's strategy (0018 pays bonuses there) would hit that guard
--     and fail the whole review. Moderators are now allowed, which is what the review flow needs.

-- ------------------------------------------------------------ 0. moderators may award on behalf of authors

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

  return app.ledger_append(p_user, v_amount, v_rule.kind, v_rule.code, p_ref_type, p_ref_id,
                           p_idempotency_key, coalesce(auth.uid()::text, 'rpc'));
end;
$$;

insert into public.currency_rules (code, kind, amount, unit, daily_cap, weekly_cap, params)
values ('badge_reward', 'badge', 500, 'per_badge', null, null, '{"note": "upper bound per award; badge_definitions.currency_reward is what is paid"}'::jsonb)
on conflict (code) do nothing;

-- ------------------------------------------------------------ 1. criterion evaluation

create or replace function app.criterion_met(p_criterion jsonb, p_metrics jsonb)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  -- A missing metric, an unknown operator or a non-numeric value can never satisfy a rule, and it
  -- must not abort the evaluation of the others.
  select case
    when p_criterion is null or p_metrics is null then false
    when coalesce(p_criterion ->> 'metric', '') = '' then false
    when (p_criterion ->> 'value') !~ '^-?[0-9]{1,9}$' then false
    when not exists (
      select 1 from public.badge_metrics bm
        where bm.metric = p_criterion ->> 'metric'
          and (p_criterion ->> 'op') = any (bm.operators)
    ) then false
    when p_metrics ->> (p_criterion ->> 'metric') is null then false
    else case (p_criterion ->> 'op')
           when 'gte' then (p_metrics ->> (p_criterion ->> 'metric'))::bigint >= (p_criterion ->> 'value')::bigint
           when 'lte' then (p_metrics ->> (p_criterion ->> 'metric'))::bigint <= (p_criterion ->> 'value')::bigint
           when 'eq'  then (p_metrics ->> (p_criterion ->> 'metric'))::bigint  = (p_criterion ->> 'value')::bigint
           else false
         end
  end;
$$;

create or replace function app.conditions_met(p_conditions jsonb, p_metrics jsonb)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  with counts as (
    select coalesce(jsonb_array_length(p_conditions -> 'all_of'), 0) as all_len,
           coalesce(jsonb_array_length(p_conditions -> 'any_of'), 0) as any_len
  ),
  all_ok as (
    select not exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(p_conditions -> 'all_of') = 'array' then p_conditions -> 'all_of' else '[]'::jsonb end
      ) with ordinality as e(crit, ord)
      where not app.criterion_met(e.crit, p_metrics)
    ) as ok
  ),
  any_ok as (
    select exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(p_conditions -> 'any_of') = 'array' then p_conditions -> 'any_of' else '[]'::jsonb end
      ) with ordinality as e(crit, ord)
      where app.criterion_met(e.crit, p_metrics)
    ) as ok
  )
  -- Parenthesized on purpose: without it "or" would bind looser and an empty condition object would
  -- look satisfied. A badge with no criteria at all awards nothing.
  select (c.all_len > 0 or c.any_len > 0) and a.ok and (c.any_len = 0 or o.ok)
    from counts c, all_ok a, any_ok o;
$$;

-- ------------------------------------------------------------ 2. badge engine

create or replace function app.evaluate_badges(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_badge public.badge_definitions%rowtype;
  v_metrics jsonb;
  v_rule_code text;
  v_amount integer;
  v_awarded integer := 0;
begin
  select to_jsonb(r) - 'user_id' - 'updated_at' into v_metrics
    from public.stat_user_rollup r
    where r.user_id = p_user;

  if v_metrics is null then
    return 0;
  end if;

  select r.code, r.amount into v_rule_code, v_amount
    from public.currency_rules r
    where r.kind = 'badge' and r.enabled
    order by r.code limit 1;

  for v_badge in
    select d.*
      from public.badge_definitions d
      where d.active
        and d.award_mode = 'auto'
        and not exists (select 1 from public.user_badges ub where ub.user_id = p_user and ub.code = d.code)
      order by d.code
  loop
    if app.conditions_met(v_badge.conditions, v_metrics) then
      insert into public.user_badges (user_id, code, awarded_by)
        values (p_user, v_badge.code, 'auto')
        on conflict (user_id, code) do nothing;

      -- FOUND is false when ON CONFLICT skipped the row, so a re-run cannot pay twice.
      if found then
        v_awarded := v_awarded + 1;
        if v_badge.currency_reward > 0 and v_rule_code is not null then
          perform public.award_currency(p_user, v_rule_code,
            least(v_badge.currency_reward, v_amount), 'badge', v_badge.code,
            'badge:' || p_user::text || ':' || v_badge.code);
        end if;
      end if;
    end if;
  end loop;

  return v_awarded;
end;
$$;

-- ------------------------------------------------------------ 3. rollup recomputation

create or replace function app.refresh_user_rollup(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_published integer := 0;
  v_approvals integer := 0;
  v_imports integer := 0;
  v_steps integer := 0;
  v_sessions integer := 0;
  v_maps integer := 0;
  v_days integer := 0;
  v_streak integer := 0;
  v_rank integer;
  v_metrics jsonb;
begin
  if p_user is null then
    return '{}'::jsonb;
  end if;

  select count(*)::integer into v_published
    from public.strategies s
    where s.owner_id = p_user and s.status in ('approved', 'featured');

  select count(*)::integer into v_approvals
    from public.admin_audit_log l
    where l.entity = 'strategies'
      and l.action in ('review:approve', 'review:feature')
      and l.entity_id in (select s.id::text from public.strategies s where s.owner_id = p_user);

  select count(*)::integer into v_imports
    from public.import_jobs j
    where j.user_id = p_user and j.status = 'done';

  select count(*)::integer into v_steps
    from public.usage_events e
    join public.overlay_sessions os on os.id = e.session_id
    where os.user_id = p_user and e.direction = 'forward';

  select count(*)::integer into v_sessions
    from public.overlay_sessions os
    where os.user_id = p_user and os.qualified;

  select count(distinct s.map_key)::integer into v_maps
    from public.overlay_sessions os
    join public.strategies s on s.id = os.strategy_id
    where os.user_id = p_user and os.qualified and s.map_key is not null;

  select count(distinct os.started_at::date)::integer into v_days
    from public.overlay_sessions os
    where os.user_id = p_user;

  -- Gaps and islands over distinct activity days; the newest activity must be today or yesterday.
  with activity as (
      select distinct os.started_at::date as d
        from public.overlay_sessions os
        where os.user_id = p_user
    ),
    islands as (
      select a.d, (a.d - (row_number() over (order by a.d))::integer) as grp
        from activity a
    ),
    latest as (select max(d) as last_day from activity)
  select case
           when l.last_day is null or l.last_day < current_date - 1 then 0
           else coalesce((select count(*)::integer from islands i
                           where i.grp = (select max(i2.grp) from islands i2)), 0)
         end
    into v_streak
    from latest l;

  select min(l.rank)::integer into v_rank
    from public.leaderboard_snapshots l
    join public.strategies s on s.id = l.strategy_id
    where s.owner_id = p_user and l.board_window = 'all_time' and l.bucket = 'all';

  insert into public.stat_user_rollup (
      user_id, strategies_published, approvals_received, imports_completed, steps_completed,
      sessions_qualified, distinct_maps, usage_rank_best, active_days, streak
    )
    values (p_user, v_published, v_approvals, v_imports, v_steps, v_sessions, v_maps, v_rank, v_days, v_streak)
    on conflict (user_id) do update set
      strategies_published = excluded.strategies_published,
      approvals_received = excluded.approvals_received,
      imports_completed = excluded.imports_completed,
      steps_completed = excluded.steps_completed,
      sessions_qualified = excluded.sessions_qualified,
      distinct_maps = excluded.distinct_maps,
      usage_rank_best = excluded.usage_rank_best,
      active_days = excluded.active_days,
      streak = excluded.streak,
      updated_at = now();

  perform app.evaluate_badges(p_user);

  select to_jsonb(r) - 'user_id' - 'updated_at' into v_metrics
    from public.stat_user_rollup r
    where r.user_id = p_user;

  return coalesce(v_metrics, '{}'::jsonb);
end;
$$;

-- ------------------------------------------------------------ 4. triggers on the write paths
--
-- strategy_usage_daily has no user column, so the owner is looked up from the strategy. Each trigger
-- is AFTER and only recomputes, so a failed recompute fails the write too - loud on purpose while
-- this engine is new.

create or replace function app.rollup_on_usage_daily()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  select s.owner_id into v_owner from public.strategies s where s.id = new.strategy_id;
  if v_owner is not null then
    perform app.refresh_user_rollup(v_owner);
  end if;
  return new;
end;
$$;

create or replace function app.rollup_on_strategy_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'featured') then
    perform app.refresh_user_rollup(new.owner_id);
  end if;
  return new;
end;
$$;

create or replace function app.rollup_on_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  if new.entity = 'strategies'
     and new.action in ('review:approve', 'review:feature', 'review:reject', 'review:archive') then
    select s.owner_id into v_owner from public.strategies s where s.id::text = new.entity_id;
    if v_owner is not null then
      perform app.refresh_user_rollup(v_owner);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists usage_daily_rollup on public.strategy_usage_daily;
create trigger usage_daily_rollup
  after insert on public.strategy_usage_daily
  for each row execute function app.rollup_on_usage_daily();

drop trigger if exists strategies_status_rollup on public.strategies;
create trigger strategies_status_rollup
  after update of status on public.strategies
  for each row execute function app.rollup_on_strategy_status();

drop trigger if exists audit_rollup on public.admin_audit_log;
create trigger audit_rollup
  after insert on public.admin_audit_log
  for each row execute function app.rollup_on_audit();

-- ------------------------------------------------------------ 5. public profile

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
             'code', b.code,
             'name', coalesce(b.name_tr, b.name_en, b.code),
             'nameEn', coalesce(b.name_en, b.name_tr, b.code),
             'desc', b.desc_tr,
             'tier', b.tier,
             'awardedAt', ub.awarded_at,
             'publicSlot', pb.slot
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
    'metrics', coalesce(v_metrics, '{}'::jsonb),
    'badges', v_badges,
    'showcase', v_showcase,
    'strategies', v_strategies
  );
end;
$$;

create or replace function public.set_public_badges(p_codes text[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_slot integer := 0;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;
  if coalesce(array_length(p_codes, 1), 0) > 4 then
    raise exception 'TOO_MANY_BADGES: the showcase holds four badges';
  end if;

  foreach v_code in array coalesce(p_codes, '{}'::text[]) loop
    if not exists (select 1 from public.user_badges ub where ub.user_id = v_user and ub.code = v_code) then
      raise exception 'NOT_OWNED: %', v_code;
    end if;
  end loop;

  delete from public.public_badges where user_id = v_user;

  foreach v_code in array coalesce(p_codes, '{}'::text[]) loop
    v_slot := v_slot + 1;
    insert into public.public_badges (user_id, code, slot) values (v_user, v_code, v_slot::smallint);
  end loop;

  return v_slot;
end;
$$;

-- ------------------------------------------------------------ 6. import log (feeds imports_completed)

create or replace function public.record_import(
  p_kind text,
  p_status text,
  p_source_url text default null,
  p_doc_id text default null,
  p_sha256 text default null,
  p_error_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_job uuid;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;

  insert into public.import_jobs (user_id, kind, source_url, doc_id, source_sha256, status, error_code, finished_at)
    values (
      v_user,
      case when p_kind in ('gdocs_link', 'file', 'paste') then p_kind else 'paste' end,
      left(nullif(p_source_url, ''), 500),
      left(nullif(p_doc_id, ''), 120),
      left(nullif(p_sha256, ''), 80),
      case when p_status in ('pending', 'done', 'failed') then p_status else 'done' end,
      left(nullif(p_error_code, ''), 60),
      case when p_status = 'pending' then null else now() end
    )
    returning id into v_job;

  return v_job;
end;
$$;

-- ------------------------------------------------------------ 7. privileges

do $$
declare
  v_sig text;
  v_list text[] := array[
    'public.profile_showcase(uuid)',
    'public.set_public_badges(text[])',
    'public.record_import(text, text, text, text, text, text)'
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

  -- Profiles are browsable without an account; the function returns public fields only.
  v_sig := 'public.profile_showcase(uuid)';
  if to_regprocedure(v_sig) is not null then
    execute format('grant execute on function %s to anon', v_sig);
  end if;
end;
$$;
