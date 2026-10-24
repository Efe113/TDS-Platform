-- 0008: publish diagnostics. Temporary, anon-callable, and it commits nothing.
-- Every write runs inside a subtransaction whose EXCEPTION handler rolls it back, so the
-- function can report the real SQLSTATE + PL/pgSQL CONTEXT for the failing statement without
-- creating rows. Remove afterwards with the drop at the bottom of this file.

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
  v_ir jsonb;
  v_strategy uuid;
  v_version uuid;
  v_step text := 'init';
  v_log text := '';
begin
  -- Use a real profile so a missing-owner FK cannot masquerade as the bug we are hunting.
  if p_user is null then
    select id into p_user from public.profiles order by created_at limit 1;
  end if;
  if p_user is null then
    return 'NO PROFILE ROWS - sign up once, then run this again';
  end if;

  if p_ir is not null then
    v_ir := p_ir;
    v_log := 'using caller IR; ';
  else
    v_ir := '{"meta":{"name":"Debug strat","difficulty":"medium","gameMode":{"key":"unknown","raw":"","resolved":false},"playerCount":"solo","map":{},"event":{"isEvent":false},"waveRange":[1,40],"durationMinutes":10,"credit":{"creator":"@debug","contributors":["@a"],"sourceUrl":"https://example.test","isAuthorOwn":false}},"inventory":[{"towerKey":"operator","rawLabel":"Operator","alternatives":["executioner"],"unresolved":false},{"towerKey":"shotgunner","rawLabel":"Shotgunner","alternatives":[],"unresolved":false}],"steps":[{"stepNo":1,"waveFrom":1,"waveTo":20,"action":"place","towerKey":"operator","level":2,"count":3,"alternatives":[],"spec":"Green Track","raw":"Place 3 Lv 2 Operators","unresolved":false},{"stepNo":2,"waveFrom":21,"waveTo":40,"action":"max","towerKey":"shotgunner","alternatives":[],"raw":"Max Shotgunners","unresolved":false}]}'::jsonb;
    v_log := 'using sample IR; ';
  end if;

  begin
    v_step := 'unique_slug';
    v_log := v_log || 'slug=' || app.unique_slug(v_ir -> 'meta' ->> 'name') || '; ';

    v_step := 'strategies insert';
    insert into public.strategies (
        slug, owner_id, name, subtitle, description, difficulty, game_mode, player_count, map_key,
        is_event_strategy, event_key, wave_from, wave_to, duration_min,
        credit_url, credit_creator, credit_contributors, is_author_own, status
      )
      values (
        app.unique_slug(v_ir -> 'meta' ->> 'name'),
        p_user,
        left(nullif(trim(coalesce(v_ir -> 'meta' ->> 'name', '')), ''), 140),
        left(coalesce(v_ir -> 'meta' ->> 'subtitle', ''), 200),
        left(coalesce(v_ir -> 'meta' ->> 'description', ''), 4000),
        coalesce(nullif(v_ir -> 'meta' ->> 'difficulty', ''), 'medium'),
        coalesce(nullif(v_ir -> 'meta' -> 'gameMode' ->> 'key', ''), 'unknown'),
        coalesce(nullif(v_ir -> 'meta' ->> 'playerCount', ''), 'unknown'),
        nullif(v_ir -> 'meta' -> 'map' ->> 'key', ''),
        coalesce((v_ir -> 'meta' -> 'event' ->> 'isEvent')::boolean, false),
        nullif(v_ir -> 'meta' -> 'event' ->> 'eventKey', ''),
        nullif(v_ir -> 'meta' -> 'waveRange' ->> 0, '')::integer,
        nullif(v_ir -> 'meta' -> 'waveRange' ->> 1, '')::integer,
        nullif(v_ir -> 'meta' ->> 'durationMinutes', '')::integer,
        nullif(v_ir -> 'meta' -> 'credit' ->> 'sourceUrl', ''),
        left(v_ir -> 'meta' -> 'credit' ->> 'creator', 120),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_ir -> 'meta' -> 'credit' -> 'contributors', '[]'::jsonb))), '{}'),
        coalesce((v_ir -> 'meta' -> 'credit' ->> 'isAuthorOwn')::boolean, false),
        'imported'
      )
      returning id into v_strategy;
    v_log := v_log || 'strategy=' || v_strategy || '; ';

    v_step := 'strategy_drafts insert';
    insert into public.strategy_drafts (user_id, strategy_id, ir, report, source_sha256)
      values (p_user, v_strategy, v_ir, '{}'::jsonb, 'debug');

    v_step := 'strategy_versions insert';
    insert into public.strategy_versions (strategy_id, version_no, content, created_by)
      values (v_strategy, 1, v_ir, p_user)
      returning id into v_version;

    v_step := 'strategy_steps insert';
    insert into public.strategy_steps
        (version_id, step_no, wave_from, wave_to, phase, action, tower_key, level, count, spec, note, raw_text, unresolved)
      select v_version,
             (t.elem ->> 'stepNo')::integer,
             nullif(t.elem ->> 'waveFrom', '')::integer,
             nullif(t.elem ->> 'waveTo', '')::integer,
             t.elem ->> 'phase',
             coalesce(t.elem ->> 'action', 'raw'),
             nullif(t.elem ->> 'towerKey', ''),
             nullif(t.elem ->> 'level', '')::integer,
             nullif(t.elem ->> 'count', '')::integer,
             jsonb_build_object(
               'alternatives', coalesce(t.elem -> 'alternatives', '[]'::jsonb),
               'spec', t.elem -> 'spec'
             ),
             t.elem ->> 'note',
             coalesce(t.elem ->> 'raw', ''),
             coalesce((t.elem ->> 'unresolved')::boolean, false)
      from jsonb_array_elements(v_ir -> 'steps') with ordinality as t(elem, ord);

    v_step := 'strategy_inventory insert';
    insert into public.strategy_inventory (version_id, tower_key, slot, alternatives, notes)
      select v_version,
             t.elem ->> 'towerKey',
             (t.ord - 1)::smallint,
             coalesce(array(select jsonb_array_elements_text(coalesce(t.elem -> 'alternatives', '[]'::jsonb))), '{}'),
             t.elem ->> 'notes'
      from jsonb_array_elements(v_ir -> 'inventory') with ordinality as t(elem, ord)
      where t.elem ->> 'towerKey' is not null;

    v_step := 'strategies status update';
    update public.strategies
      set status = 'submitted', updated_at = now(),
          wave_from = coalesce(nullif(v_ir -> 'meta' -> 'waveRange' ->> 0, '')::integer, wave_from),
          wave_to = coalesce(nullif(v_ir -> 'meta' -> 'waveRange' ->> 1, '')::integer, wave_to)
      where id = v_strategy;

    v_log := v_log || 'ALL STATEMENTS OK';

    -- Nothing above is kept: raising here rolls the subtransaction back.
    raise exception 'DEBUG_ROLLBACK' using errcode = 'P0001';
  exception when others then
    if sqlerrm like 'DEBUG_ROLLBACK%' then
      return 'OK (rolled back) | ' || v_log;
    end if;
    return 'FAILED at ' || v_step
      || ' | sqlstate=' || sqlstate
      || ' | message=' || sqlerrm
      || ' | context=' || coalesce(pg_exception_context(), '(none)')
      || ' | log=' || v_log;
  end;
end;
$$;

grant execute on function public.debug_publish_pipeline(uuid, jsonb) to anon, authenticated;

-- drop function if exists public.debug_publish_pipeline(uuid, jsonb);
