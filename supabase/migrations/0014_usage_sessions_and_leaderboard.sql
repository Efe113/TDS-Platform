-- 0014: usage sessions that a client can actually drive, and a leaderboard that fills itself.
--
-- Two blockers found while wiring M6 against the deployed schema:
--
--   1. flush_usage(p_session_id, p_nonce, p_events) rejects the call unless the caller knows the
--      session's nonce - but start_overlay_session returned only the session id, so no client could
--      ever pass that check. It now returns {"sessionId": ..., "nonce": ...} and the client keeps
--      both in its on-disk outbox. The nonce is what makes a retried flush safe: a second call with
--      the same (session, nonce) cannot belong to anyone else, and usage_events has
--      unique (session_id, seq) with ON CONFLICT DO NOTHING.
--   2. Nothing anywhere wrote leaderboard_snapshots, so get_leaderboard returned an empty set
--      forever, and Supabase cron would have been the only "fix". get_leaderboard now rebuilds the
--      snapshot for its own window when it is missing or older than a TTL - one small cache table,
--      self-maintaining, no scheduler to configure. Freshness is tracked on leaderboard_config
--      (last_bucket + last_computed_at) so a window with no usage data does not recompute on every
--      call, and the bucket is the period the caller is in, not the previous one.
--
-- Also fixed while here: strategy_usage_daily.unique_users was never maintained (always 0), so any
-- board weighted by "distinct users" would rank nothing. It now counts a user once per strategy per
-- day, using overlay_sessions as the source of truth.

-- ------------------------------------------------------------ 1. session start returns the nonce

drop function if exists public.start_overlay_session(uuid, text, text, text);

create or replace function public.start_overlay_session(
  p_strategy_id uuid,
  p_display_id text,
  p_app_version text,
  p_hook_backend text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_version uuid;
  v_session uuid;
  v_nonce uuid;
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
    values (v_user, p_strategy_id, v_version, nullif(left(coalesce(p_display_id, ''), 60), ''),
            nullif(left(coalesce(p_app_version, ''), 30), ''), nullif(left(coalesce(p_hook_backend, ''), 30), ''))
    returning id, nonce into v_session, v_nonce;

  return jsonb_build_object('sessionId', v_session, 'nonce', v_nonce);
end;
$$;

grant execute on function public.start_overlay_session(uuid, text, text, text) to authenticated;

-- ------------------------------------------------------------ 2. flush keeps unique_users honest

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
  v_new_user boolean := true;
begin
  select * into v_session from public.overlay_sessions where id = p_session_id;
  if not found or v_session.user_id is distinct from v_user or v_session.nonce is distinct from p_nonce then
    raise exception 'FORBIDDEN: session does not belong to this client';
  end if;

  -- A session is closed exactly once, so a retry from the client's outbox can only ever add
  -- duplicate events (ignored below), never double-count a use.
  if v_session.ended_at is not null then
    return query select v_session.qualified, 0;
    return;
  end if;

  insert into public.usage_events (session_id, seq, step_no, direction, occurred_at)
    select p_session_id,
           (t.elem ->> 'seq')::integer,
           (t.elem ->> 'stepNo')::integer,
           t.elem ->> 'direction',
           to_timestamp((t.elem ->> 'at')::double precision / 1000.0)
    from jsonb_array_elements(
      case when jsonb_typeof(p_events) = 'array' then p_events else '[]'::jsonb end
    ) with ordinality as t(elem, ord)
    where (t.elem ->> 'seq') ~ '^[0-9]{1,6}$'
      and (t.elem ->> 'stepNo') ~ '^[0-9]{1,4}$'
      and (t.elem ->> 'at') ~ '^[0-9]{1,14}$'
      and t.elem ->> 'direction' in ('forward', 'back', 'reset')
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

  -- Counted once per person per strategy per day: any earlier qualifying session today means this
  -- one adds a use but not a new user.
  select not exists (
    select 1 from public.overlay_sessions other
      where other.user_id = v_user
        and other.strategy_id = v_session.strategy_id
        and other.id <> p_session_id
        and other.qualified
        and other.started_at::date = current_date
  ) into v_new_user;

  update public.overlay_sessions
    set ended_at = now(), steps_advanced = coalesce(v_forward, 0), max_step = coalesce(v_max, 0), qualified = v_is_qualified
    where id = p_session_id;

  insert into public.strategy_usage_daily (strategy_id, day, uses, unique_users, steps_completed, sessions_qualified)
    values (v_session.strategy_id, current_date, 1,
            case when v_is_qualified and v_new_user then 1 else 0 end,
            coalesce(v_forward, 0),
            case when v_is_qualified then 1 else 0 end)
    on conflict (strategy_id, day)
      do update set uses = strategy_usage_daily.uses + 1,
                    unique_users = strategy_usage_daily.unique_users + excluded.unique_users,
                    steps_completed = strategy_usage_daily.steps_completed + excluded.steps_completed,
                    sessions_qualified = strategy_usage_daily.sessions_qualified + excluded.sessions_qualified;

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

grant execute on function public.flush_usage(uuid, uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ 3. leaderboard: bucket + rebuild

alter table public.leaderboard_config add column if not exists last_bucket text;
alter table public.leaderboard_config add column if not exists last_computed_at timestamptz;

create or replace function app.leaderboard_bucket(p_window text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  -- The bucket names the period the board covers, so a rebuild for the current week is not
  -- confused with last week's snapshot.
  select case
    when p_window = 'weekly' then to_char(now(), 'IYYY-IW')
    when p_window = 'daily' then to_char(current_date, 'YYYY-MM-DD')
    else 'all'
  end;
$$;

create or replace function app.leaderboard_window_start(p_window text)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p_window = 'weekly' then now() - interval '7 days'
    when p_window = 'daily' then date_trunc('day', now())
    else to_timestamp(0)
  end;
$$;

create or replace function app.rebuild_leaderboard(p_window text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bucket text;
  v_start timestamptz;
  v_users numeric(4, 3);
  v_uses numeric(4, 3);
  v_decay numeric(4, 3);
  v_count integer;
begin
  if p_window not in ('all_time', 'weekly', 'daily') then
    raise exception 'BAD_WINDOW: use all_time, weekly or daily';
  end if;

  select c.weight_users, c.weight_uses, c.decay
    into v_users, v_uses, v_decay
    from public.leaderboard_config c where c.board_window = p_window;

  v_users := coalesce(v_users, 0.700);
  v_uses := coalesce(v_uses, 0.300);
  -- all_time means all_time: decay would silently turn it into a recency board.
  v_decay := case when p_window = 'all_time' then 1.000 else coalesce(v_decay, 0.900) end;

  v_bucket := app.leaderboard_bucket(p_window);
  v_start := app.leaderboard_window_start(p_window);

  delete from public.leaderboard_snapshots where board_window = p_window and bucket = v_bucket;

  insert into public.leaderboard_snapshots (board_window, bucket, rank, strategy_id, score, computed_at)
    select p_window, v_bucket,
           row_number() over (order by s.score desc, st.name asc, st.id asc),
           st.id, round(s.score::numeric, 4), now()
      from (
        select coalesce(d.strategy_id, u.strategy_id) as strategy_id,
               coalesce(u.users, 0) * v_users
                 + coalesce(d.decayed_uses, 0)::numeric * v_uses as score
          from (
            -- Age weighting: a use decays by v_decay per day, so a busy old strategy cannot sit on
            -- its laurels forever. all_time overrides this with decay = 1 (see above).
            select sd.strategy_id,
                   sum(sd.uses * power(v_decay::double precision, greatest(0, current_date - sd.day))) as decayed_uses
              from public.strategy_usage_daily sd
              where sd.day >= v_start::date
              group by sd.strategy_id
          ) d
          full outer join (
            select q.strategy_id, count(distinct q.user_id) as users
              from public.overlay_sessions q
              where q.qualified and q.started_at >= v_start
              group by q.strategy_id
          ) u on u.strategy_id = d.strategy_id
      ) s
      join public.strategies st on st.id = s.strategy_id
      where st.status in ('approved', 'featured') and s.score > 0;

  get diagnostics v_count = row_count;

  update public.leaderboard_config
    set last_bucket = v_bucket, last_computed_at = now()
    where board_window = p_window;

  return v_count;
end;
$$;

create or replace function public.get_leaderboard(p_window text default 'all_time', p_limit integer default 50)
returns table (rank integer, strategy_id uuid, name text, score numeric, is_event_strategy boolean, map_key text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_bucket text;
  v_limit integer;
begin
  if p_window not in ('all_time', 'weekly', 'daily') then
    raise exception 'BAD_WINDOW: use all_time, weekly or daily';
  end if;

  v_bucket := app.leaderboard_bucket(p_window);
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);

  -- Lazy, TTL-gated rebuild: writes only the derived cache rows, and the freshness stamp lives on
  -- leaderboard_config so an empty window does not recompute on every call.
  if not exists (
    select 1 from public.leaderboard_config c
      where c.board_window = p_window
        and c.last_bucket = v_bucket
        and c.last_computed_at > now() - interval '15 minutes'
  ) then
    perform app.rebuild_leaderboard(p_window);
  end if;

  return query
    select l.rank, l.strategy_id, st.name, l.score, st.is_event_strategy, st.map_key
      from public.leaderboard_snapshots l
      join public.strategies st on st.id = l.strategy_id
      where l.board_window = p_window
        and l.bucket = v_bucket
        and st.status in ('approved', 'featured')
      order by l.rank
      limit v_limit;
end;
$$;

grant execute on function public.get_leaderboard(text, integer) to anon, authenticated;
