-- 0013: publish the whole IR, not only the steps.
--
-- The loop now works end to end - publish, approve, discovery, detail - and reading the approved
-- row back with the app's own queries showed exactly one problem left: the live version has
-- steps=14 and inventory=5, and NOTHING else. requirements, modifiers, proofs, hall of fame,
-- wave-skip rules and troubleshooting were all parsed into the IR by the importer, are all part
-- of the detail page contract, and were never inserted, because publish_strategy only wrote
-- strategy_steps and strategy_inventory. The full IR does survive in strategy_versions.content,
-- so no data is lost, but the normalized child tables are what discovery and the detail page read
-- - and what the admin/matching tooling will later query.
--
-- Design notes for the inserts below:
--   * Every section is read through app.ir_array(), so a missing key or a non-array value yields
--     an empty set instead of "cannot call jsonb_array_elements on a scalar".
--   * Enum columns carry CHECK constraints, so each value is matched against the allowed list
--     inside the statement: an oddball draft can only drop that row, never abort a publish.
--   * mutator_key is a foreign key, and imported modifier labels often have no catalog match yet:
--     unmatched rows are kept with mutator_key NULL and their raw text in `note`, which is what
--     the moderation "gaps" view is for. Duplicate keys in one document are absorbed by the
--     partial unique index via ON CONFLICT DO NOTHING.
--   * Media rows are only written for references that already have a storage_path and a kind the
--     CHECK allows; document-embedded images stay in the IR until something uploads them.
--   * strategy_placements (per-step x/y) is still not filled: the canvas editor that produces it
--     is M9.
--
-- Timestamps: proof/hall-of-fame times are "mm:ss" strings in the IR and integer seconds in the
-- schema, converted by app.ir_time_to_sec() with a regex guard so malformed text becomes NULL.

create or replace function app.ir_array(p_ir jsonb, p_key text)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when jsonb_typeof(p_ir -> p_key) = 'array' then p_ir -> p_key else '[]'::jsonb end;
$$;

create or replace function app.ir_time_to_sec(p_value text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_value ~ '^\s*[0-9]{1,2}:[0-9]{1,2}\s*$' then
      split_part(trim(both ' ' from p_value), ':', 1)::integer * 60
      + split_part(trim(both ' ' from p_value), ':', 2)::integer
    when p_value ~ '^\s*[0-9]{1,4}\s*[sS]\s*$' then
      (regexp_replace(p_value, '[^0-9]', '', 'g'))::integer
    else null
  end;
$$;

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
  v_name text;
  v_event_key text;
  v_strategy uuid;
  v_constraint text;
  v_attempt integer := 0;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;

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

  -- The same guards as publish_strategy: name has a length CHECK, difficulty/player_count are
  -- enums, map_key and event_key are foreign keys, and wave/duration numbers have ranges. A
  -- foreign key miss must become NULL, not a failed publish - the gaps view exists for that.
  v_name := left(trim(coalesce(nullif(v_meta ->> 'name', ''), '')), 140);
  if char_length(v_name) < 2 then
    v_name := 'strategi';
  end if;
  if (v_meta -> 'event' ->> 'isEvent') = 'true' then
    v_event_key := case when exists (select 1 from public.events e where e.key = v_meta -> 'event' ->> 'eventKey')
                        then v_meta -> 'event' ->> 'eventKey' end;
  else
    v_event_key := null;
  end if;

  loop
    begin
      insert into public.strategies (
          slug, owner_id, name, subtitle, description, difficulty, game_mode, player_count, map_key,
          is_event_strategy, event_key, wave_from, wave_to, duration_min,
          credit_url, credit_creator, credit_contributors, is_author_own, status
        )
        values (
          app.unique_slug(v_name),
          v_user,
          v_name,
          nullif(left(coalesce(v_meta ->> 'subtitle', ''), 200), ''),
          nullif(left(coalesce(v_meta ->> 'description', ''), 4000), ''),
          case when (v_meta ->> 'difficulty') in ('easy', 'medium', 'hard', 'nightmare')
               then v_meta ->> 'difficulty' else 'medium' end,
          left(coalesce(nullif(v_meta -> 'gameMode' ->> 'key', ''), 'unknown'), 60),
          case when (v_meta ->> 'playerCount') in ('solo', 'duo', 'trio', 'quad', 'unknown')
               then v_meta ->> 'playerCount' else 'unknown' end,
          case when exists (select 1 from public.maps mp where mp.key = v_meta -> 'map' ->> 'key')
               then v_meta -> 'map' ->> 'key' end,
          v_event_key is not null
            or case when (v_meta -> 'event' ->> 'isEvent') in ('true', 'false')
                    then (v_meta -> 'event' ->> 'isEvent')::boolean else false end,
          v_event_key,
          case when (v_meta -> 'waveRange' ->> 0) ~ '^[0-9]{1,3}$' then (v_meta -> 'waveRange' ->> 0)::integer end,
          case when (v_meta -> 'waveRange' ->> 1) ~ '^[0-9]{1,3}$' then (v_meta -> 'waveRange' ->> 1)::integer end,
          case when (v_meta ->> 'durationMinutes') ~ '^[0-9]{1,3}$'
                 and (v_meta ->> 'durationMinutes')::integer between 1 and 600
               then (v_meta ->> 'durationMinutes')::integer end,
          coalesce(nullif(v_credit ->> 'sourceUrl', ''), p_source_url),
          left(v_creator, 120),
          coalesce(array(select jsonb_array_elements_text(coalesce(v_credit -> 'contributors', '[]'::jsonb))), '{}'),
          case when (v_credit ->> 'isAuthorOwn') in ('true', 'false') then (v_credit ->> 'isAuthorOwn')::boolean else false end,
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

  -- Every value is guarded against its own CHECK constraint or foreign key: one odd field in one
  -- step may cost that step its value, never cost the whole publish.
  insert into public.strategy_steps
      (version_id, step_no, wave_from, wave_to, phase, action, tower_key, level, count, spec, note, raw_text, unresolved)
    select v_version_id,
           (t.elem ->> 'stepNo')::integer,
           case when (t.elem ->> 'waveFrom') ~ '^-?[0-9]{1,3}$' then (t.elem ->> 'waveFrom')::integer end,
           case when (t.elem ->> 'waveTo') ~ '^-?[0-9]{1,3}$' then (t.elem ->> 'waveTo')::integer end,
           t.elem ->> 'phase',
           case when t.elem ->> 'action' in
                  ('place', 'upgrade', 'max', 'sell', 'change', 'use', 'skip', 'wait', 'note', 'raw')
                then t.elem ->> 'action' else 'raw' end,
           case when exists (select 1 from public.towers tw where tw.key = t.elem ->> 'towerKey')
                then t.elem ->> 'towerKey' end,
           case when (t.elem ->> 'level') ~ '^[0-9]{1,2}$' and (t.elem ->> 'level')::integer between 1 and 9
                then (t.elem ->> 'level')::integer end,
           case when (t.elem ->> 'count') ~ '^[0-9]{1,2}$' and (t.elem ->> 'count')::integer between 1 and 99
                then (t.elem ->> 'count')::integer end,
           jsonb_build_object(
             'alternatives', coalesce(t.elem -> 'alternatives', '[]'::jsonb),
             'spec', t.elem -> 'spec'
           ),
           t.elem ->> 'note',
           coalesce(t.elem ->> 'raw', ''),
           case when (t.elem ->> 'unresolved') in ('true', 'false') then (t.elem ->> 'unresolved')::boolean else false end
    from jsonb_array_elements(app.ir_array(v_draft.ir, 'steps')) with ordinality as t(elem, ord)
    where (t.elem ->> 'stepNo') ~ '^[0-9]{1,4}$'
      and (t.elem ->> 'stepNo')::integer > 0
    -- unique (version_id, step_no): a repeated step number keeps its first row.
    on conflict (version_id, step_no) do nothing;

  insert into public.strategy_inventory (version_id, tower_key, slot, alternatives, notes)
    select v_version_id,
           t.elem ->> 'towerKey',
           (t.ord - 1)::smallint,
           coalesce(array(select jsonb_array_elements_text(coalesce(t.elem -> 'alternatives', '[]'::jsonb))), '{}'),
           t.elem ->> 'notes'
    from jsonb_array_elements(app.ir_array(v_draft.ir, 'inventory')) with ordinality as t(elem, ord)
    where coalesce(t.elem ->> 'towerKey', '') <> ''
      and exists (select 1 from public.towers tw where tw.key = t.elem ->> 'towerKey')
    -- unique (version_id, tower_key): the same tower listed twice in a document is one row.
    on conflict (version_id, tower_key) do nothing;

  insert into public.strategy_requirements (version_id, kind, value, detail)
    select v_version_id,
           t.elem ->> 'kind',
           coalesce(t.elem ->> 'value', ''),
           nullif(t.elem ->> 'detail', '')
    from jsonb_array_elements(app.ir_array(v_draft.ir, 'requirements')) with ordinality as t(elem, ord)
    where t.elem ->> 'kind' in ('skill-tree', 'timescale', 'group', 'consumable', 'tower-xp')
      and coalesce(t.elem ->> 'value', '') <> '';

  -- One row per declared modifier, even when nothing about it is known yet: the importer finds
  -- modifier ICONS in the document's table and leaves catalog matching to pHash/manual work, so
  -- the row count is itself the information the gaps view needs. A row with mutator_key NULL,
  -- matched_by 'none' and no note is a real, honest state - not something to filter away.
  insert into public.strategy_modifiers (version_id, mutator_key, note, matched_by, confidence)
    select v_version_id,
           case when exists (select 1 from public.mutators m where m.key = t.elem ->> 'key')
                then t.elem ->> 'key' end,
           -- Modifiers are "****"-type leftovers when the doc only shows icons; stars and
           -- whitespace around the note are markdown noise, not content. `raw` is the fallback for
           -- text-detected modifiers, where the label lives there.
           nullif(btrim(coalesce(nullif(t.elem ->> 'note', ''), t.elem ->> 'raw', ''), ' *'), ''),
           case when t.elem ->> 'matchedBy' in ('phash', 'manual', 'text', 'none')
                then t.elem ->> 'matchedBy' else 'none' end,
           case when t.elem ->> 'confidence' ~ '^(0|1|0?\.[0-9]{1,2})$'
                then (t.elem ->> 'confidence')::numeric(3, 2) end
    from jsonb_array_elements(app.ir_array(v_draft.ir, 'mutators')) with ordinality as t(elem, ord)
    on conflict (version_id, mutator_key) where mutator_key is not null do nothing;

  insert into public.strategy_wave_skip_rules (version_id, kind, waves, condition, raw_text)
    select v_version_id,
           case when t.elem ->> 'kind' in ('skip-until', 'conditional', 'never')
                then t.elem ->> 'kind' else 'conditional' end,
           nullif(t.elem ->> 'waves', ''),
           nullif(t.elem ->> 'condition', ''),
           coalesce(t.elem ->> 'raw', '')
    from jsonb_array_elements(app.ir_array(v_draft.ir, 'waveSkip')) with ordinality as t(elem, ord);

  insert into public.strategy_troubleshooting (version_id, waves, reasons)
    select v_version_id,
           coalesce(t.elem ->> 'waves', ''),
           coalesce(case when jsonb_typeof(t.elem -> 'reasons') = 'array' then t.elem -> 'reasons' else '[]'::jsonb end, '[]'::jsonb)
    from jsonb_array_elements(app.ir_array(v_draft.ir, 'troubleshooting')) with ordinality as t(elem, ord);

  insert into public.strategy_proofs (version_id, label, setup, best_time_sec, coins_per_hour, xp_per_hour)
    select v_version_id,
           coalesce(t.elem ->> 'label', ''),
           coalesce(case when jsonb_typeof(t.elem -> 'setup') = 'array' then t.elem -> 'setup' else '[]'::jsonb end, '[]'::jsonb),
           app.ir_time_to_sec(nullif(t.elem ->> 'bestTime', '')),
           nullif(t.elem ->> 'coinsPerHour', ''),
           nullif(t.elem ->> 'xpPerHour', '')
    from jsonb_array_elements(app.ir_array(v_draft.ir, 'proofs')) with ordinality as t(elem, ord);

  insert into public.strategy_hof (version_id, comp, best_time_sec, notes)
    select v_version_id,
           coalesce(array(select jsonb_array_elements_text(
             case when jsonb_typeof(t.elem -> 'comp') = 'array' then t.elem -> 'comp' else '[]'::jsonb end)), '{}'),
           app.ir_time_to_sec(nullif(t.elem ->> 'bestTime', '')),
           nullif(t.elem ->> 'notes', '')
    from jsonb_array_elements(app.ir_array(v_draft.ir, 'hallOfFame')) with ordinality as t(elem, ord);

  insert into public.strategy_media (version_id, kind, storage_path, width, height, sha256, phash)
    select v_version_id,
           t.elem ->> 'kind',
           t.elem ->> 'storagePath',
           case when t.elem ->> 'width' ~ '^[0-9]{1,5}$' then (t.elem ->> 'width')::integer end,
           case when t.elem ->> 'height' ~ '^[0-9]{1,5}$' then (t.elem ->> 'height')::integer end,
           nullif(t.elem ->> 'sha256', ''),
           nullif(t.elem ->> 'phash', '')
    from jsonb_array_elements(app.ir_array(v_draft.ir, 'media')) with ordinality as t(elem, ord)
    where coalesce(t.elem ->> 'storagePath', '') <> ''
      and t.elem ->> 'kind' in ('map', 'thumb', 'card', 'proof', 'modifier');

  -- Tags live on the strategy, not the version, and only catalog keys are accepted.
  insert into public.strategy_tags (strategy_id, tag_key)
    select p_strategy_id, t.val
    from jsonb_array_elements_text(app.ir_array(v_draft.ir -> 'meta', 'tags')) with ordinality as t(val, ord)
    where exists (select 1 from public.tags tg where tg.key = t.val)
    on conflict (strategy_id, tag_key) do nothing;

  update public.strategies
    set status = 'submitted', updated_at = now(),
        name = case when char_length(coalesce(nullif(v_draft.ir -> 'meta' ->> 'name', ''), '')) between 2 and 140
                    then v_draft.ir -> 'meta' ->> 'name' else name end,
        difficulty = case when (v_draft.ir -> 'meta' ->> 'difficulty') in ('easy', 'medium', 'hard', 'nightmare')
                    then v_draft.ir -> 'meta' ->> 'difficulty' else difficulty end,
        game_mode = coalesce(nullif(v_draft.ir -> 'meta' -> 'gameMode' ->> 'key', ''), game_mode),
        player_count = case when (v_draft.ir -> 'meta' ->> 'playerCount') in ('solo', 'duo', 'trio', 'quad', 'unknown')
                    then v_draft.ir -> 'meta' ->> 'playerCount' else player_count end,
        duration_min = case when (v_draft.ir -> 'meta' ->> 'durationMinutes') ~ '^[0-9]{1,3}$'
                      and (v_draft.ir -> 'meta' ->> 'durationMinutes')::integer between 1 and 600
                    then (v_draft.ir -> 'meta' ->> 'durationMinutes')::integer else duration_min end,
        is_event_strategy = case when (v_draft.ir -> 'meta' -> 'event' ->> 'isEvent') in ('true', 'false')
                    then (v_draft.ir -> 'meta' -> 'event' ->> 'isEvent')::boolean else is_event_strategy end,
        wave_from = case when (v_draft.ir -> 'meta' -> 'waveRange' ->> 0) ~ '^[0-9]{1,3}$'
                    then (v_draft.ir -> 'meta' -> 'waveRange' ->> 0)::integer else wave_from end,
        wave_to = case when (v_draft.ir -> 'meta' -> 'waveRange' ->> 1) ~ '^[0-9]{1,3}$'
                    then (v_draft.ir -> 'meta' -> 'waveRange' ->> 1)::integer else wave_to end
    where id = p_strategy_id;

  return v_version_id;
end;
$$;

grant execute on function public.publish_strategy(uuid) to authenticated;

-- ------------------------------------------------------------ diagnostics, with counts
--
-- Reads back the row counts the publish just produced, inside the same subtransaction that is
-- always rolled back - so the mapping can be verified over REST without creating rows.
-- Remove with: drop function if exists public.debug_publish_pipeline(uuid, jsonb);

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
  v_strategy uuid;
  v_version uuid;
  v_run text;
  v_state text;
  v_msg text;
  v_detail text;
  v_ctx text;
  v_steps integer;
  v_inventory integer;
  v_requirements integer;
  v_modifiers integer;
  v_unmatched integer;
  v_skip integer;
  v_trouble integer;
  v_proofs integer;
  v_hof integer;
  v_media integer;
  v_tags integer;
begin
  select coalesce(p_user, (select id from public.profiles order by created_at limit 1)) into v_user;
  if v_user is null then
    return 'NO PROFILE ROWS - sign up once, then run this again';
  end if;

  v_ir := p_ir;
  if v_ir is null then
    return 'PASS THE IR: debug_publish_pipeline(p_ir => the app payload)';
  end if;

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);

    v_strategy := public.submit_strategy(v_ir, 'debug-0013', null);

    select id into v_version from public.strategy_versions
      where strategy_id = v_strategy order by version_no desc limit 1;

    select count(*) into v_steps from public.strategy_steps where version_id = v_version;
    select count(*) into v_inventory from public.strategy_inventory where version_id = v_version;
    select count(*) into v_requirements from public.strategy_requirements where version_id = v_version;
    select count(*) into v_modifiers from public.strategy_modifiers where version_id = v_version;
    select count(*) into v_unmatched from public.strategy_modifiers where version_id = v_version and mutator_key is null;
    select count(*) into v_skip from public.strategy_wave_skip_rules where version_id = v_version;
    select count(*) into v_trouble from public.strategy_troubleshooting where version_id = v_version;
    select count(*) into v_proofs from public.strategy_proofs where version_id = v_version;
    select count(*) into v_hof from public.strategy_hof where version_id = v_version;
    select count(*) into v_media from public.strategy_media where version_id = v_version;
    select count(*) into v_tags from public.strategy_tags where strategy_id = v_strategy;

    v_run := 'MAPPED | strategy=' || v_strategy::text
      || ' steps=' || v_steps || ' inventory=' || v_inventory
      || ' requirements=' || v_requirements
      || ' modifiers=' || v_modifiers || ' (unmatched=' || v_unmatched || ')'
      || ' waveSkip=' || v_skip || ' troubleshooting=' || v_trouble
      || ' proofs=' || v_proofs || ' hof=' || v_hof
      || ' media=' || v_media || ' tags=' || v_tags;

    raise exception 'DEBUG_ROLLBACK' using errcode = 'P0001';
  exception when others then
    -- The subtransaction is already undone; on the sentinel the counts collected above stand.
    if sqlerrm like 'DEBUG_ROLLBACK%' then
      null;
    else
      get stacked diagnostics v_state = returned_sqlstate,
                              v_msg = message_text,
                              v_detail = pg_exception_detail,
                              v_ctx = pg_exception_context;
      v_run := 'FAILED | sqlstate=' || coalesce(v_state, '?')
        || ' | message=' || coalesce(v_msg, sqlerrm)
        || ' | detail=' || coalesce(nullif(v_detail, ''), '(none)')
        || ' | context=' || coalesce(nullif(v_ctx, ''), '(none)');
    end if;
  end;

  return v_run;
end;
$$;

grant execute on function public.debug_publish_pipeline(uuid, jsonb) to anon, authenticated;
