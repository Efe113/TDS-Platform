-- 0033: a leaderboard hub for both strategies and players.
--
-- The old board only ranked strategies and the client could not see who owned them, how they moved or
-- what the player did. This function returns one shaped payload: current rows, the caller's standing,
-- the rows around the caller, and the biggest climbers/fallers. It never exposes raw usage rows - only
-- aggregates that a public leaderboard is allowed to show.
--
-- Boards:
--   strategies - the existing weighted strategy score.
--   players    - sessions / steps / coins / publishes in the selected window, with career context.
--
-- Movement compares the current window with the previous one (daily -> weekly -> all_time), matching
-- the existing strategy board behaviour. all_time has no previous window, so movement is null.

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
                     'tier', b.tier
                   ) order by ub.awarded_at desc
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
                   'tier', b.tier
                 ) order by ub.awarded_at desc
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

do $$
begin
  if to_regprocedure('public.leaderboard_hub(text, text, text, integer)') is not null then
    execute 'revoke execute on function public.leaderboard_hub(text, text, text, integer) from public, anon';
    execute 'grant execute on function public.leaderboard_hub(text, text, text, integer) to anon, authenticated';
  end if;
end;
$$;
