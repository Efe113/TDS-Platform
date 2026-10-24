-- 0012: fix publish_strategy, and add a read-only shape inspector.
--
-- Root cause of the publish failure. The diagnostic named the statement
-- ("publish_strategy(uuid) line 56", the update on public.strategies) and the detail said the
-- parsed JSON text was EMPTY, independent of which IR was sent. That combination points at a
-- constant, not at data:
--
--   player_count = coalesce(nullif(v_draft.ir -> 'meta' -> 'playerCount', ''), player_count)
--                                          -- ^ ^ jsonb, so nullif's second argument '' is
--                                            coerced to jsonb at plan time: ''::jsonb
--
-- nullif is nullif(anyelement, anyelement); with a jsonb first argument the empty-string literal
-- becomes ''::jsonb, which Postgres folds while planning the statement - so the UPDATE raised
-- 22P02 "invalid input syntax for type json / The input string ended unexpectedly." on every
-- publish, whatever the client sent. The fix is the text-extracting operator ->>, the same one
-- every other line in the function already uses. 0002 and 0010 are corrected in the repository as
-- well, so a fresh install does not reintroduce it.
--
-- debug_describe(text) is added because this bug took several rounds to locate: it is read-only,
-- returns the live columns/constraints/triggers/policies/indexes of any relation, and is callable
-- with the anon key, so schema drift can be inspected without another migration. Remove both at
-- the end of the debugging:
--   drop function if exists public.debug_describe(text);

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

  -- Every jsonb read here uses ->> (text). With -> the value stays jsonb and the nullif guard
  -- would have to coerce its '' argument into jsonb, which fails before the row is ever touched.
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

-- ------------------------------------------------------------ read-only inspector

create or replace function public.debug_describe(p_table text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rel regclass := to_regclass(p_table);
  v_head text;
  v_part text;
begin
  if v_rel is null then
    return 'NO SUCH RELATION: ' || coalesce(p_table, '(null)');
  end if;

  select 'rls=' || c.relrowsecurity::text || ' force=' || c.relforcerowsecurity::text
      || ' owner=' || pg_get_userbyid(c.relowner)
    into v_head
    from pg_class c
    where c.oid = v_rel;

  select string_agg(
           '  ' || a.attnum || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
             || ' notnull=' || a.attnotnull::text
             || ' gen=' || case a.attgenerated when 's' then 'stored' when 'v' then 'virtual' else 'no' end
             || ' expr=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'),
           chr(10) order by a.attnum)
    into v_part
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = v_rel and a.attnum > 0 and not a.attisdropped;

  v_head := v_head || chr(10) || '== columns ==' || chr(10) || coalesce(v_part, '  (none)');

  select string_agg('  ' || con.conname || ' [' || con.contype::text || '] ' || pg_get_constraintdef(con.oid),
           chr(10) order by con.conname)
    into v_part
    from pg_constraint con
    where con.conrelid = v_rel;

  v_head := v_head || chr(10) || '== constraints ==' || chr(10) || coalesce(v_part, '  (none)');

  -- Trigger bodies too: a legacy trigger can fail an UPDATE as easily as the statement itself.
  select string_agg(
           '  ' || t.tgname || ' :: ' || pg_get_triggerdef(t.oid)
             || chr(10) || '  body: ' || left(pg_get_functiondef(p.oid), 700),
           chr(10) order by t.tgname)
    into v_part
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = v_rel and not t.tgisinternal;

  v_head := v_head || chr(10) || '== triggers ==' || chr(10) || coalesce(v_part, '  (none)');

  select string_agg(
           '  ' || pol.polname || ' [' || pol.polcmd::text || ']'
             || ' using=' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '-')
             || ' check=' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '-'),
           chr(10) order by pol.polname)
    into v_part
    from pg_policy pol
    where pol.polrelid = v_rel;

  v_head := v_head || chr(10) || '== policies ==' || chr(10) || coalesce(v_part, '  (none)');

  select string_agg('  ' || i.indexname || ' :: ' || i.indexdef, chr(10) order by i.indexname)
    into v_part
    from pg_indexes i
    where i.tablename = (select k.relname from pg_class k where k.oid = v_rel)
      and i.schemaname = (select n.nspname from pg_class k
                          join pg_namespace n on n.oid = k.relnamespace
                          where k.oid = v_rel);

  return v_head || chr(10) || '== indexes ==' || chr(10) || coalesce(v_part, '  (none)');
end;
$$;

grant execute on function public.debug_describe(text) to anon, authenticated;
