-- 0015: flush_usage could never finish - plpgsql OUT name collided with a column name.
--
-- The app reported, on every attempt:
--   column reference "qualified" is ambiguous
-- because flush_usage is declared `returns table (qualified boolean, awarded integer)`: OUT
-- parameters are plpgsql variables, and this statement used the bare column:
--
--   select count(*) into v_recent
--     from public.overlay_sessions
--    where ... and qualified and ...
--
-- `qualified` matched both the OUT variable and overlay_sessions.qualified, so Postgres refused the
-- statement. The bug has been in the function since 0003; it only became reachable now because the
-- nonce check used to reject every call before this line ran (0014).
--
-- Fix: the table gets an alias and the column is qualified. The OUT names stay as they are, since
-- they are the JSON keys the client reads. Rule going forward: inside a function with OUT
-- parameters, never write a bare column reference - alias the table.
--
-- Nothing else changes; the whole function is re-declared so the deployed copy matches the repo.

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
  -- duplicate (session_id, seq) rows, which the insert below ignores.
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
    -- Aliased on purpose: a bare `qualified` here is ambiguous with the OUT parameter of this
    -- same name, which is what made every flush fail before this file.
    select count(*) into v_recent
      from public.overlay_sessions recent
      where recent.user_id = v_user
        and recent.strategy_id = v_session.strategy_id
        and recent.qualified
        and recent.started_at > now() - interval '6 hours';

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
