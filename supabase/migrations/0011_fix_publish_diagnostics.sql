-- 0011: fix the 0010 diagnostic and make it name the failing statement.
--
-- 0010 applied cleanly, but calling debug_publish_pipeline() returned
--   42883 "function pg_exception_context() does not exist"
-- because pg_exception_context is not a SQL function: it is a GET STACKED DIAGNOSTICS item. That
-- crash is itself the finding - the handler branch only runs when the emulated publish FAILED -
-- so the report has to be built without throwing. Nothing else in the publish chain changes here.
--
-- Remove afterwards together with the function it defines:
--   drop function if exists public.debug_publish_pipeline(uuid, jsonb);

drop function if exists public.debug_publish_pipeline(uuid);
drop function if exists public.debug_publish_pipeline(uuid, jsonb);

create or replace function public.debug_publish_pipeline(
  p_user uuid default null,
  p_ir jsonb default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_ir jsonb;
  v_role text := 'not switched';
  v_run text;
  v_defs text;
  v_shape text;
  v_strategy uuid;
  v_state text;
  v_msg text;
  v_detail text;
  v_hint text;
  v_ctx text;
  v_sample jsonb := '{
    "meta": {"name": "Debug strat", "difficulty": "medium", "gameMode": {"key": "unknown"},
             "playerCount": "solo", "map": {}, "event": {"isEvent": false}, "waveRange": [1, 40],
             "durationMinutes": 10,
             "credit": {"creator": "@debug", "contributors": ["@a"],
                        "sourceUrl": "https://example.test", "isAuthorOwn": false}},
    "inventory": [{"towerKey": "operator", "rawLabel": "Operator", "alternatives": ["executioner"], "unresolved": false}],
    "steps": [{"stepNo": 1, "waveFrom": 1, "waveTo": 20, "action": "place", "towerKey": "operator",
               "level": 2, "count": 3, "alternatives": [], "spec": "Green Track",
               "raw": "Place 3 Lv 2 Operators", "unresolved": false}]
  }'::jsonb;
begin
  select coalesce(p_user, (select id from public.profiles order by created_at limit 1)) into v_user;
  if v_user is null then
    return 'NO PROFILE ROWS - sign up once, then run this again';
  end if;

  v_ir := coalesce(p_ir, v_sample);

  -- The chain is security definer, but auth.uid() still has to resolve, so the claims the API
  -- gateway normally sets are emulated. They are transaction-local and this subtransaction is
  -- always aborted, so neither the writes nor the impersonation survive the call.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_user::text, true);

    begin
      execute 'set local role authenticated';
      v_role := 'authenticated';
    exception when others then
      -- A project where the function owner is not a member of authenticated: the definer
      -- functions still run as their owner, so the SQL body is exercised either way.
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_role := 'NOT SWITCHED (' || v_state || ': ' || v_msg || ')';
    end;

    v_strategy := public.submit_strategy(v_ir, 'debug-0011', null);
    raise exception 'DEBUG_ROLLBACK' using errcode = 'P0001';
  exception when others then
    -- The whole subtransaction is already undone at this point.
    get stacked diagnostics v_state = returned_sqlstate,
                            v_msg = message_text,
                            v_detail = pg_exception_detail,
                            v_hint = pg_exception_hint,
                            v_ctx = pg_exception_context;

    if v_msg like 'DEBUG_ROLLBACK%' then
      v_run := 'OK (rolled back) | strategy=' || coalesce(v_strategy::text, '?');
    else
      v_run := 'FAILED | sqlstate=' || coalesce(v_state, '?')
        || ' | message=' || coalesce(v_msg, '?')
        || ' | detail=' || coalesce(nullif(v_detail, ''), '(none)')
        || ' | hint=' || coalesce(nullif(v_hint, ''), '(none)')
        || ' | context=' || coalesce(nullif(v_ctx, ''), '(none)');
    end if;
  end;

  -- Live shape of the tables in the chain, so column drift shows up next to the source drift.
  select coalesce(string_agg(
           c.table_name || ': ' || c.column_name || ' ' || c.data_type
             || ' null=' || c.is_nullable || ' default=' || coalesce(c.column_default, '-'),
           chr(10) order by c.table_name, c.ordinal_position),
         '(no columns)')
    into v_shape
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('strategies', 'strategy_drafts')
      and c.column_name in ('slug', 'status', 'owner_id', 'ir', 'strategy_id', 'user_id', 'source_sha256', 'updated_at');

  select coalesce(string_agg(
           '### ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
             || ' definer=' || coalesce(p.prosecdef::text, '?')
             || ' config=' || coalesce(array_to_string(p.proconfig, ','), '(none)')
             || chr(10) || left(pg_get_functiondef(p.oid), 900),
           chr(10) || chr(10) order by n.nspname, p.proname),
         '(none in pg_proc)')
    into v_defs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and p.proname in ('create_strategy_from_draft', 'publish_strategy', 'submit_strategy', 'unique_slug');

  return '== run ==' || chr(10) || v_run || chr(10)
    || 'role used: ' || v_role || chr(10)
    || 'as user: ' || v_user || chr(10) || chr(10)
    || '== live columns ==' || chr(10) || v_shape || chr(10) || chr(10)
    || '== deployed source ==' || chr(10) || v_defs;
end;
$$;

grant execute on function public.debug_publish_pipeline(uuid, jsonb) to anon, authenticated;
