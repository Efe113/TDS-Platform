-- 0023: the strategy intelligence layer - community analytics, personal journey, step notes,
-- per-step feedback, version watching and pinned solutions.
--
-- Why this exists as SQL and not as client code: every number below is derived from rows the app has
-- been writing since M6 (overlay_sessions, usage_events, strategy_usage_daily). A client could not
-- compute any of it without downloading everyone's sessions, and a client-side "progress" object
-- would be a second source of truth that disagrees with the ledger the moment two devices sync.
--
-- Design rules encoded here:
--   * Personal progress is DERIVED from overlay_sessions, never copied into a new table. A run that
--     the usage pipeline accepted is the only thing that can say "you got to step 12".
--   * Only genuinely new facts get tables: step notes, explicit per-step verdicts, version watching
--     and the pinned solution. All of them are (user, strategy[, step]) keyed and cascade with the
--     strategy, so a takedown removes them.
--   * Aggregations are computed inside the function, so a moderator's takedown or an un-rate cannot
--     leave a stale counter behind - the same lesson as recompute_strategy_rating in 0020.
--   * "Where players struggle" comes from real behaviour (back/reset events per step), not from a
--     survey, and the explicit verdict is layered on top of it.
--   * Every write path checks auth.uid() itself; the tables are read-only to their owner via RLS and
--     have no public write grants at all.

-- ------------------------------------------------------------ 1. tables

create table if not exists public.step_marks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  step_no integer not null check (step_no > 0),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, strategy_id, step_no)
);

create index if not exists step_marks_strategy_idx on public.step_marks (strategy_id, step_no);

create table if not exists public.step_feedback (
  user_id uuid not null references public.profiles (id) on delete cascade,
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  step_no integer not null check (step_no > 0),
  verdict text not null check (verdict in ('worked', 'stuck')),
  created_at timestamptz not null default now(),
  primary key (user_id, strategy_id, step_no)
);

create index if not exists step_feedback_strategy_idx on public.step_feedback (strategy_id, step_no);

-- `seen_version_id` is what makes "there is a new version" answerable in one query.
create table if not exists public.strategy_watch (
  user_id uuid not null references public.profiles (id) on delete cascade,
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  seen_version_id uuid references public.strategy_versions (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, strategy_id)
);

-- At most one pinned solution per strategy; only the strategy owner or the comment author can set it.
create table if not exists public.comment_solutions (
  strategy_id uuid primary key references public.strategies (id) on delete cascade,
  comment_id uuid not null references public.comments (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.step_marks enable row level security;
alter table public.step_feedback enable row level security;
alter table public.strategy_watch enable row level security;
alter table public.comment_solutions enable row level security;

drop policy if exists step_marks_read on public.step_marks;
create policy step_marks_read on public.step_marks for select using (user_id = auth.uid());

drop policy if exists step_feedback_read on public.step_feedback;
create policy step_feedback_read on public.step_feedback
  for select using (user_id = auth.uid() or app.is_moderator());

drop policy if exists strategy_watch_read on public.strategy_watch;
create policy strategy_watch_read on public.strategy_watch for select using (user_id = auth.uid());

drop policy if exists comment_solutions_read on public.comment_solutions;
create policy comment_solutions_read on public.comment_solutions for select using (true);

-- All writes go through the RPCs below, which validate first. `from public` matters: Supabase grants
-- table privileges to PUBLIC by default, so omitting it leaves a writable table behind the functions.
revoke all on table public.step_marks, public.step_feedback, public.strategy_watch, public.comment_solutions
  from public, authenticated, anon;

-- ------------------------------------------------------------ 2. read-side analytics

-- Community truth for one strategy: how it actually plays out for other people.
create or replace function public.strategy_stats(p_strategy_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_runs integer;
  v_qualified integer;
  v_avg_steps numeric;
  v_completion numeric;
  v_median_seconds numeric;
  v_trend7 integer;
  v_trend_prev7 integer;
  v_unique_people integer;
begin
  if p_strategy_id is null then return '{}'::jsonb; end if;

  select count(*),
         count(*) filter (where s.qualified),
         coalesce(round(avg(s.max_step)::numeric, 1), 0),
         count(distinct s.user_id)
    into v_runs, v_qualified, v_avg_steps, v_unique_people
    from public.overlay_sessions s
   where s.strategy_id = p_strategy_id;

  -- Completion needs the version's step count, otherwise "average step 9" means nothing.
  select case when v_runs > 0 then round((v_qualified::numeric / v_runs) * 100) else 0 end
    into v_completion;

  select round(percentile_cont(0.5) within group (
           order by extract(epoch from (s.ended_at - s.started_at)))
         )
    into v_median_seconds
    from public.overlay_sessions s
   where s.strategy_id = p_strategy_id
     and s.qualified
     and s.ended_at is not null;

  -- Two plain windows rather than FILTER, because the aggregate here has no other rows to exclude.
  select coalesce(sum(uses), 0)
    into v_trend_prev7
    from public.strategy_usage_daily
   where strategy_id = p_strategy_id
     and day > now()::date - 14
     and day <= now()::date - 7;

  select coalesce(sum(uses), 0)
    into v_trend7
    from public.strategy_usage_daily
   where strategy_id = p_strategy_id
     and day > now()::date - 7;

  return jsonb_build_object(
    'runs', coalesce(v_runs, 0),
    'qualifiedRuns', coalesce(v_qualified, 0),
    'uniquePeople', coalesce(v_unique_people, 0),
    'averageStepsReached', coalesce(v_avg_steps, 0),
    'completionPercent', coalesce(v_completion, 0),
    'medianSeconds', v_median_seconds,
    'weekUses', coalesce(v_trend7, 0),
    'previousWeekUses', coalesce(v_trend_prev7, 0)
  );
end;
$$;

-- Where the run actually stalls. Back/reset events are grouped by the step they happened on, so a
-- spike means "people retry here", which is the single most useful line on a strategy page.
create or replace function public.step_health(p_strategy_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with retries as (
    select e.step_no,
           count(*) filter (where e.direction = 'back') as backs,
           count(*) filter (where e.direction = 'reset') as resets
      from public.usage_events e
      join public.overlay_sessions s on s.id = e.session_id
     where s.strategy_id = p_strategy_id
     group by e.step_no
  ),
  verdicts as (
    select f.step_no,
           count(*) filter (where f.verdict = 'worked') as worked,
           count(*) filter (where f.verdict = 'stuck') as stuck
      from public.step_feedback f
     where f.strategy_id = p_strategy_id
     group by f.step_no
  )
  -- A full join, not a left join: a verdict on a step nobody retried is still worth showing, and the
  -- other way round (retries with no verdicts) is the common case.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'stepNo', coalesce(k.step_no, v.step_no),
        'backs', coalesce(k.backs, 0),
        'resets', coalesce(k.resets, 0),
        'worked', coalesce(v.worked, 0),
        'stuck', coalesce(v.stuck, 0)
      ) order by coalesce(k.step_no, v.step_no)
    ),
    '[]'::jsonb
  )
  from retries k
  full join verdicts v on v.step_no = k.step_no;
$$;

-- This user's own history on one strategy, derived from the session ledger.
create or replace function public.my_journey(p_strategy_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_runs integer;
  v_best_step integer;
  v_last_run timestamptz;
  v_best_seconds numeric;
begin
  if v_uid is null or p_strategy_id is null then return '{}'::jsonb; end if;

  select count(*), max(s.max_step), max(s.started_at)
    into v_runs, v_best_step, v_last_run
    from public.overlay_sessions s
   where s.user_id = v_uid and s.strategy_id = p_strategy_id;

  select round(min(case when s.ended_at is not null and s.qualified
                        then extract(epoch from (s.ended_at - s.started_at)) end))
    into v_best_seconds
    from public.overlay_sessions s
   where s.user_id = v_uid and s.strategy_id = p_strategy_id;

  return jsonb_build_object(
    'runs', coalesce(v_runs, 0),
    'bestStep', coalesce(v_best_step, 0),
    'lastRunAt', v_last_run,
    'bestSeconds', v_best_seconds
  );
end;
$$;

-- ------------------------------------------------------------ 3. personal layer writes

create or replace function public.set_step_mark(p_strategy_id uuid, p_step_no integer, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := coalesce(p_note, '');
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_step_no is null or p_step_no < 1 then
    raise exception 'STEP_INVALID';
  end if;
  if char_length(v_body) > 500 then
    raise exception 'NOTE_TOO_LONG';
  end if;
  if not exists (select 1 from public.strategies s where s.id = p_strategy_id) then
    raise exception 'NOT_FOUND';
  end if;

  if trim(v_body) = '' then
    delete from public.step_marks
     where user_id = v_uid and strategy_id = p_strategy_id and step_no = p_step_no;
  else
    insert into public.step_marks (user_id, strategy_id, step_no, note)
    values (v_uid, p_strategy_id, p_step_no, trim(v_body))
    on conflict (user_id, strategy_id, step_no)
    do update set note = excluded.note, updated_at = now();
  end if;

  return public.step_marks_list(p_strategy_id);
end;
$$;

create or replace function public.step_marks_list(p_strategy_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('stepNo', m.step_no, 'note', m.note) order by m.step_no),
    '[]'::jsonb
  )
  from public.step_marks m
  where m.strategy_id = p_strategy_id and m.user_id = auth.uid();
$$;

-- One verdict per (user, strategy, step); the same verdict again clears it, like a toggle.
create or replace function public.rate_step(p_strategy_id uuid, p_step_no integer, p_verdict text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_verdict not in ('worked', 'stuck') then
    raise exception 'VERDICT_INVALID';
  end if;
  if p_step_no is null or p_step_no < 1 then
    raise exception 'STEP_INVALID';
  end if;

  if exists (
    select 1 from public.step_feedback
     where user_id = v_uid and strategy_id = p_strategy_id and step_no = p_step_no and verdict = p_verdict
  ) then
    delete from public.step_feedback
     where user_id = v_uid and strategy_id = p_strategy_id and step_no = p_step_no;
  else
    insert into public.step_feedback (user_id, strategy_id, step_no, verdict)
    values (v_uid, p_strategy_id, p_step_no, p_verdict)
    on conflict (user_id, strategy_id, step_no) do update set verdict = excluded.verdict;
  end if;

  return public.step_health(p_strategy_id);
end;
$$;

create or replace function public.toggle_watch(p_strategy_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_live uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select s.current_version_id into v_live from public.strategies s where s.id = p_strategy_id;
  if v_live is null and not exists (select 1 from public.strategies where id = p_strategy_id) then
    raise exception 'NOT_FOUND';
  end if;

  if exists (select 1 from public.strategy_watch where user_id = v_uid and strategy_id = p_strategy_id) then
    delete from public.strategy_watch where user_id = v_uid and strategy_id = p_strategy_id;
    return false;
  end if;

  insert into public.strategy_watch (user_id, strategy_id, seen_version_id)
  values (v_uid, p_strategy_id, v_live);
  return true;
end;
$$;

-- What the watched strategies changed since the user last looked, in one round trip.
create or replace function public.watch_updates()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'strategyId', w.strategy_id,
        'name', s.name,
        'slug', s.slug,
        'fromVersion', (v_old.version_no),
        'toVersion', (v_new.version_no),
        'changedAt', v_new.published_at
      ) order by v_new.published_at desc
    ),
    '[]'::jsonb
  )
  from public.strategy_watch w
  join public.strategies s on s.id = w.strategy_id
  join public.strategy_versions v_new on v_new.id = s.current_version_id
  left join public.strategy_versions v_old on v_old.id = w.seen_version_id
  where w.user_id = auth.uid()
    and (w.seen_version_id is null or w.seen_version_id <> s.current_version_id);
$$;

create or replace function public.mark_watch_seen(p_strategy_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.strategy_watch
     set seen_version_id = (select current_version_id from public.strategies where id = p_strategy_id)
   where user_id = auth.uid() and strategy_id = p_strategy_id;
end;
$$;

-- Pinned solution: the strategy owner may pin any comment on their strategy; the comment author may
-- pin their own answer. Everyone else gets a permission error rather than a silent no-op.
create or replace function public.mark_solution(p_strategy_id uuid, p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_author uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select owner_id into v_owner from public.strategies where id = p_strategy_id;
  select user_id into v_author from public.comments where id = p_comment_id and strategy_id = p_strategy_id;
  if v_author is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_owner is distinct from v_uid and v_author <> v_uid then
    raise exception 'FORBIDDEN';
  end if;

  insert into public.comment_solutions (strategy_id, comment_id, created_by)
  values (p_strategy_id, p_comment_id, v_uid)
  on conflict (strategy_id) do update set comment_id = excluded.comment_id, created_at = now();

  return true;
end;
$$;

create or replace function public.clear_solution(p_strategy_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  select owner_id into v_owner from public.strategies where id = p_strategy_id;
  if v_owner is distinct from v_uid then
    raise exception 'FORBIDDEN';
  end if;
  delete from public.comment_solutions where strategy_id = p_strategy_id;
  return true;
end;
$$;

create or replace function public.solution_for(p_strategy_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select comment_id from public.comment_solutions where strategy_id = p_strategy_id;
$$;

-- The home digest: what this user was actually doing, across strategies, newest first. Derived from
-- the session ledger so it can never disagree with what the usage pipeline recorded.
create or replace function public.my_recent_strategies(p_limit integer default 4)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ranked as (
    select s.strategy_id,
           max(s.started_at) as last_run,
           max(s.max_step) as best_step,
           count(*) as runs,
           count(*) filter (where s.qualified) as qualified_runs
      from public.overlay_sessions s
     where s.user_id = auth.uid()
     group by s.strategy_id
     order by last_run desc
     limit greatest(least(p_limit, 10), 1)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'strategyId', r.strategy_id,
        'name', st.name,
        'slug', st.slug,
        'totalSteps', coalesce(v.step_count, 0),
        'bestStep', r.best_step,
        'runs', r.runs,
        'qualifiedRuns', r.qualified_runs,
        'lastRunAt', r.last_run
      ) order by r.last_run desc
    ),
    '[]'::jsonb
  )
  from ranked r
  join public.strategies st on st.id = r.strategy_id
  left join (
    select id, (select count(*) from public.strategy_steps ss where ss.version_id = sv.id) as step_count
      from public.strategy_versions sv
  ) v on v.id = st.current_version_id;
$$;

-- ------------------------------------------------------------ 4. discovery upgrades

-- Real facet counters, so the filter chips can say how many results each choice holds before the
-- user commits to it. Same predicates as the search, kept in one place on purpose.
create or replace function public.discover_facets(
  p_query text default null,
  p_mode text default null,
  p_map text default null,
  p_difficulty text default null,
  p_event boolean default null,
  p_tag text default null
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

-- search_strategies v2. Dropping first is deliberate: adding parameters to the old signature leaves
-- two overloads whose defaults make every call ambiguous.
drop function if exists public.search_strategies(
  text, text, text, text, boolean, text, text, integer, integer
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
  p_watch_only boolean default false
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
  rows_total bigint
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
      coalesce(tr.uses_7d, 0) as uses_7d
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
         c.total
    from chosen c;
$$;

-- ------------------------------------------------------------ 5. privileges

do $$
declare
  v_sig text;
  v_list text[] := array[
    'public.strategy_stats(uuid)',
    'public.step_health(uuid)',
    'public.my_journey(uuid)',
    'public.my_recent_strategies(integer)',
    'public.step_marks_list(uuid)',
    'public.set_step_mark(uuid, integer, text)',
    'public.rate_step(uuid, integer, text)',
    'public.toggle_watch(uuid)',
    'public.watch_updates()',
    'public.mark_watch_seen(uuid)',
    'public.mark_solution(uuid, uuid)',
    'public.clear_solution(uuid)',
    'public.solution_for(uuid)',
    'public.discover_facets(text, text, text, text, boolean, text)',
    'public.search_strategies(text, text, text, text, boolean, text, text, integer, integer, boolean, boolean)'
  ];
  v_public text[] := array[
    'public.strategy_stats(uuid)',
    'public.step_health(uuid)',
    'public.solution_for(uuid)',
    'public.discover_facets(text, text, text, text, boolean, text)',
    'public.search_strategies(text, text, text, text, boolean, text, text, integer, integer, boolean, boolean)'
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

  foreach v_sig in array v_public loop
    if to_regprocedure(v_sig) is not null then
      execute format('grant execute on function %s to anon', v_sig);
    end if;
  end loop;
end;
$$;

do $$
begin
  raise notice '0023: strategy intelligence layer ready (stats, journey, marks, feedback, watch, solutions, facets, search v2).';
  raise notice '0023: search_strategies now returns is_watched, trend_7d and rows_total - the desktop app must be on the matching build.';
end;
$$;
