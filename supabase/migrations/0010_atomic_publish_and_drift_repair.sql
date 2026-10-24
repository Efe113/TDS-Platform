-- 0010: atomic publishing, and a repair for database drift.
--
-- Evidence that forced this file. The live database no longer matches the migrations in the
-- repository: pg_proc reports create_strategy_from_draft(jsonb,text,text) with prosecdef = false,
-- while both 0007 and the intended revision declare it `security definer`. So some half-applied
-- revision is what the app actually calls, and its errors (invalid input syntax for type json,
-- null value in column "ir", NO_DRAFT) cannot be reproduced from the repository files at all.
-- Every function in the publish chain is therefore re-created here, so the live state is
-- defined by this file instead of by whatever survived the earlier partial runs.
--
-- What changes:
--   1. app.unique_slug() is re-applied and its truncation bug is fixed: substr(v_base, 1, 60) ran
--      AFTER the trim, so a long title could yield a slug ending in '-' (the live row
--      "oetv-s2-bas-tan-20-gecen-verdi-bosluk-100-300-yeniden-" shows exactly that). It now
--      trims again after truncating. Kept `security definer`: slug uniqueness is a global
--      namespace, and an invoker version cannot see other owners' rows through RLS, so it would
--      keep handing out taken slugs and die on the constraint instead.
--   2. create_strategy_from_draft() defaults every IR section once (a JSON null in the IR reads
--      back as SQL NULL, and jsonb_array_elements(NULL) silently produces zero rows), and retries
--      the strategies insert when a concurrent publish wins the slug race.
--   3. submit_strategy() runs create + publish inside ONE request. The app used to make two
--      separate HTTP calls, so a failure in the second left a committed orphan 'imported'
--      strategy behind - and the next attempt then collided with it on strategies_slug_key,
--      which is the error the app is showing now. One function means one transaction: either the
--      strategy is submitted with its version, or nothing happened.
--   4. debug_publish_pipeline() is re-applied with the 0009 defect fixed (a scalar subquery may
--      not contain EXECUTE, so that version failed with 42601 before printing anything). It now
--      exercises the REAL chain under an emulated `authenticated` role and prints the deployed
--      source of every function involved, so drift is visible instead of inferred.
--
-- Not included on purpose: the two orphan 'imported' rows from the failed attempts stay in
-- strategies. They are invisible to discovery until approved, and archiving them from the admin
-- panel is the intended path.

drop function if exists public.debug_publish_pipeline(uuid);
drop function if exists public.debug_publish_pipeline(uuid, jsonb);
drop function if exists public.submit_strategy(jsonb, text, text);

-- ------------------------------------------------------------ 1. slug generation

create or replace function app.unique_slug(p_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text;
  v_candidate text;
  v_attempts integer := 0;
begin
  v_base := lower(coalesce(p_name, ''));
  -- Transliterate before stripping, or "Şöhret" would lose letters instead of becoming "sohret".
  v_base := replace(v_base, 'ç', 'c');
  v_base := replace(v_base, 'Ç', 'c');
  v_base := replace(v_base, 'ğ', 'g');
  v_base := replace(v_base, 'Ğ', 'g');
  v_base := replace(v_base, 'ı', 'i');
  v_base := replace(v_base, 'İ', 'i');
  v_base := replace(v_base, 'ö', 'o');
  v_base := replace(v_base, 'Ö', 'o');
  v_base := replace(v_base, 'ş', 's');
  v_base := replace(v_base, 'Ş', 's');
  v_base := replace(v_base, 'ü', 'u');
  v_base := replace(v_base, 'Ü', 'u');
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  if length(v_base) < 3 then
    v_base := 'strategi';
  end if;
  -- Trim after truncating: a 60-character cut can land on a separator, and two titles that only
  -- differ past character 60 would otherwise fight over the same slug.
  v_base := trim(both '-' from substr(v_base, 1, 60));

  v_candidate := v_base;
  loop
    exit when not exists (select 1 from public.strategies where slug = v_candidate);
    v_attempts := v_attempts + 1;
    if v_attempts > 40 then
      v_candidate := v_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      exit;
    end if;
    v_candidate := v_base || '-' || floor(random() * 9000 + 1000)::text;
  end loop;

  return v_candidate;
end;
$$;

-- ------------------------------------------------------------ 2. draft -> strategy + draft row

create or replace function public.create_strategy_from_draft(
  p_ir jsonb,
  p_source_sha256 text default null,
  p_source_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_meta jsonb;
  v_inventory jsonb;
  v_steps jsonb;
  v_credit jsonb;
  v_creator text;
  v_strategy uuid;
  v_constraint text;
  v_attempt integer := 0;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;

  -- `p_ir -> 'meta'` yields SQL NULL when the key is absent or holds JSON null, and every jsonb
  -- operator below would then propagate NULL. Default each section once, here.
  v_meta := coalesce(p_ir -> 'meta', '{}'::jsonb);
  v_inventory := coalesce(p_ir -> 'inventory', '[]'::jsonb);
  v_steps := coalesce(p_ir -> 'steps', '[]'::jsonb);
  v_credit := coalesce(v_meta -> 'credit', '{}'::jsonb);

  if jsonb_array_length(v_steps) = 0 then
    raise exception 'NO_STEPS: a strategy needs at least one step';
  end if;
  if jsonb_array_length(v_inventory) = 0 then
    raise exception 'NO_INVENTORY: select at least one tower';
  end if;
  if jsonb_array_length(v_inventory) > 5 then
    raise exception 'TOO_MANY_TOWERS: at most 5 towers per strategy';
  end if;

  v_creator := coalesce(v_credit ->> 'creator', '');
  if v_creator = '' then
    raise exception 'NO_CREDIT: the source author is required';
  end if;

  -- app.unique_slug() checks for a free slug, but a concurrent publish can take it between that
  -- check and this insert. Retrying regenerates the slug instead of surfacing 23505 to the user.
  loop
    begin
      insert into public.strategies (
          slug, owner_id, name, subtitle, description, difficulty, game_mode, player_count, map_key,
          is_event_strategy, event_key, wave_from, wave_to, duration_min,
          credit_url, credit_creator, credit_contributors, is_author_own, status
        )
        values (
          app.unique_slug(v_meta ->> 'name'),
          v_user,
          left(nullif(trim(coalesce(v_meta ->> 'name', '')), ''), 140),
          left(coalesce(v_meta ->> 'subtitle', ''), 200),
          left(coalesce(v_meta ->> 'description', ''), 4000),
          coalesce(nullif(v_meta ->> 'difficulty', ''), 'medium'),
          coalesce(nullif(v_meta -> 'gameMode' ->> 'key', ''), 'unknown'),
          coalesce(nullif(v_meta ->> 'playerCount', ''), 'unknown'),
          nullif(v_meta -> 'map' ->> 'key', ''),
          coalesce((v_meta -> 'event' ->> 'isEvent')::boolean, false),
          nullif(v_meta -> 'event' ->> 'eventKey', ''),
          nullif(v_meta -> 'waveRange' ->> 0, '')::integer,
          nullif(v_meta -> 'waveRange' ->> 1, '')::integer,
          nullif(v_meta ->> 'durationMinutes', '')::integer,
          coalesce(nullif(v_credit ->> 'sourceUrl', ''), p_source_url),
          left(v_creator, 120),
          coalesce(array(select jsonb_array_elements_text(coalesce(v_credit -> 'contributors', '[]'::jsonb))), '{}'),
          coalesce((v_credit ->> 'isAuthorOwn')::boolean, false),
          'imported'
        )
      returning id into v_strategy;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'strategies_slug_key' or v_attempt >= 5 then
        raise;
      end if;
      v_attempt := v_attempt + 1;
    end;
  end loop;

  insert into public.strategy_drafts (user_id, strategy_id, ir, report, source_sha256)
    values (v_user, v_strategy, p_ir, '{}'::jsonb, p_source_sha256);

  return v_strategy;
end;
$$;

grant execute on function public.create_strategy_from_draft(jsonb, text, text) to authenticated;

-- ------------------------------------------------------------ 3. draft -> published version

create or replace function public.publish_strategy(p_strategy_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_strategy public.strategies%rowtype;
  v_draft public.strategy_drafts%rowtype;
  v_version_no integer;
  v_version_id uuid;
begin
  select * into v_strategy from public.strategies where id = p_strategy_id;
  if not found or v_strategy.owner_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN: you can only publish your own strategy';
  end if;

  select * into v_draft from public.strategy_drafts
    where user_id = auth.uid() and strategy_id = p_strategy_id
    order by updated_at desc limit 1;
  if not found then
    raise exception 'NO_DRAFT: nothing to publish';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_version_no
    from public.strategy_versions where strategy_id = p_strategy_id;

  insert into public.strategy_versions (strategy_id, version_no, content, created_by)
    values (p_strategy_id, v_version_no, v_draft.ir, auth.uid())
    returning id into v_version_id;

  insert into public.strategy_steps
      (version_id, step_no, wave_from, wave_to, phase, action, tower_key, level, count, spec, note, raw_text, unresolved)
    select v_version_id,
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
    from jsonb_array_elements(v_draft.ir -> 'steps') with ordinality as t(elem, ord);

  insert into public.strategy_inventory (version_id, tower_key, slot, alternatives, notes)
    select v_version_id,
           t.elem ->> 'towerKey',
           (t.ord - 1)::smallint,
           coalesce(array(select jsonb_array_elements_text(coalesce(t.elem -> 'alternatives', '[]'::jsonb))), '{}'),
           t.elem ->> 'notes'
    from jsonb_array_elements(v_draft.ir -> 'inventory') with ordinality as t(elem, ord)
    where t.elem ->> 'towerKey' is not null;

  update public.strategies
    set status = 'submitted', updated_at = now(),
        name = coalesce(nullif(v_draft.ir -> 'meta' ->> 'name', ''), name),
        difficulty = coalesce(nullif(v_draft.ir -> 'meta' ->> 'difficulty', ''), difficulty),
        game_mode = coalesce(nullif(v_draft.ir -> 'meta' -> 'gameMode' ->> 'key', ''), game_mode),
        player_count = coalesce(nullif(v_draft.ir -> 'meta' ->> 'playerCount', ''), player_count),
        is_event_strategy = coalesce((v_draft.ir -> 'meta' -> 'event' ->> 'isEvent')::boolean, is_event_strategy),
        wave_from = coalesce(nullif(v_draft.ir -> 'meta' -> 'waveRange' ->> 0, '')::integer, wave_from),
        wave_to = coalesce(nullif(v_draft.ir -> 'meta' -> 'waveRange' ->> 1, '')::integer, wave_to)
    where id = p_strategy_id;

  return v_version_id;
end;
$$;

grant execute on function public.publish_strategy(uuid) to authenticated;

-- ------------------------------------------------------------ 4. the one call the app makes

create or replace function public.submit_strategy(
  p_ir jsonb,
  p_source_sha256 text default null,
  p_source_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_strategy uuid;
begin
  v_strategy := public.create_strategy_from_draft(p_ir, p_source_sha256, p_source_url);
  perform public.publish_strategy(v_strategy);
  return v_strategy;
end;
$$;

grant execute on function public.submit_strategy(jsonb, text, text) to authenticated;

-- ------------------------------------------------------------ 5. diagnostics (temporary)
--
-- Runs the real chain for a chosen profile under an emulated `authenticated` request, then rolls
-- everything back. Remove together with the app-side call site:
--   drop function if exists public.debug_publish_pipeline(uuid, jsonb);

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
  v_run text;
  v_defs text;
  v_shape text;
  v_role text;
  v_strategy uuid;
begin
  select coalesce(p_user, (select id from public.profiles order by created_at limit 1)) into v_user;
  if v_user is null then
    return 'NO PROFILE ROWS - sign up once, then run this again';
  end if;

  v_ir := coalesce(p_ir, '{
    "meta": {"name": "Debug strat", "difficulty": "medium", "gameMode": {"key": "unknown"},
             "playerCount": "solo", "map": {}, "event": {"isEvent": false}, "waveRange": [1, 40],
             "durationMinutes": 10,
             "credit": {"creator": "@debug", "contributors": ["@a"],
                        "sourceUrl": "https://example.test", "isAuthorOwn": false}},
    "inventory": [{"towerKey": "operator", "rawLabel": "Operator", "alternatives": ["executioner"], "unresolved": false}],
    "steps": [{"stepNo": 1, "waveFrom": 1, "waveTo": 20, "action": "place", "towerKey": "operator",
               "level": 2, "count": 3, "alternatives": [], "spec": "Green Track",
               "raw": "Place 3 Lv 2 Operators", "unresolved": false}]
  }'::jsonb);

  -- The chain is security definer, but auth.uid() still has to resolve, so the gateway's claim
  -- GUCs are emulated. They are transaction-local and this subtransaction is always aborted,
  -- so neither the writes nor the impersonation survive the call.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_user::text, true);
    begin
      execute 'set local role authenticated';
      v_role := 'authenticated';
    exception when others then
      -- A project where postgres is not a member of authenticated: the definer functions still
      -- run as their owner, so the SQL body is exercised either way. Report which case we are in.
      v_role := 'NOT SWITCHED (' || sqlerrm || ')';
    end;

    v_strategy := public.submit_strategy(v_ir, 'debug-0010', null);
    raise exception 'DEBUG_ROLLBACK' using errcode = 'P0001';
  exception when others then
    if sqlerrm like 'DEBUG_ROLLBACK%' then
      v_run := 'OK (rolled back) | strategy=' || coalesce(v_strategy::text, '?');
    else
      v_run := 'FAILED | sqlstate=' || sqlstate
        || ' | message=' || sqlerrm
        || ' | context=' || coalesce(pg_exception_context(), '(none)');
    end if;
  end;

  -- Live shape of the tables in the chain, so column drift shows up next to the source drift.
  select coalesce(string_agg(
           t.table_name || ': ' || c.column_name || ' ' || c.data_type
             || ' null=' || c.is_nullable || ' default=' || coalesce(c.column_default, '-'),
           chr(10) order by t.table_name, c.ordinal_position),
         '(no columns)')
    into v_shape
    from information_schema.columns c
    join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
    where c.table_schema = 'public'
      and c.table_name in ('strategies', 'strategy_drafts')
      and c.column_name in ('slug', 'status', 'owner_id', 'ir', 'strategy_id', 'user_id', 'source_sha256', 'updated_at');

  select coalesce(string_agg(
           '### ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
             || ' definer=' || coalesce(p.prosecdef::text, '?')
             || ' ' || coalesce((select string_agg(s, ' ') from unnest(p.proconfig) as s), '(no config)')
             || chr(10) || left(pg_get_functiondef(p.oid), 1200),
           chr(10) || chr(10) order by n.nspname, p.proname),
         '(none in pg_proc)')
    into v_defs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and p.proname in ('create_strategy_from_draft', 'publish_strategy', 'submit_strategy', 'unique_slug');

  return '== run ==' || chr(10) || v_run || chr(10)
    || 'role used: ' || coalesce(v_role, '?') || chr(10) || chr(10)
    || '== live columns ==' || chr(10) || v_shape || chr(10) || chr(10)
    || '== deployed source ==' || chr(10) || v_defs;
end;
$$;

grant execute on function public.debug_publish_pipeline(uuid, jsonb) to anon, authenticated;
