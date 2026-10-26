-- 0046: maintenance becomes a scheduled, two-mode operation instead of a light switch.
--
-- Today the flag is `{enabled, note}`: one boolean, no window, and a guard attached to four tables on
-- INSERT only. So an operator had no way to announce maintenance before it starts, no way to say how
-- long it will take, no way to actually close the app, and a member could still edit their own comment
-- while the platform was supposedly frozen.
--
-- This file makes the flag row the whole record — `{enabled, mode, title, note, startsAt, endsAt}` —
-- and puts the window arithmetic in one place, `app.maintenance_state()`, with `maintenance_on()`
-- reading through it. The client evaluates the *same* rule in shared/`maintenance.ts` against the same
-- row it already reads (app_flags is public-select), so nobody has to trust a second source.
--
--   * read_only — the app stays usable; writes are refused server-side with the operator's reason.
--   * locked    — same server rule, plus a full-screen gate: the member is told before they hit a
--                 wall of refusals. Reads, the overlay and local play tracking keep working either way,
--                 because the companion is useful while the platform is being repaired.
--
-- A window that has already passed stops blocking on its own; nothing here needs a cron job.
--
-- Safe to run twice. Depends on 0029 (the flag row, the guard) and 0037 (account_requests guard).

-- ------------------------------------------------------------ 1. the state, in one place

create or replace function app.maintenance_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_value jsonb;
  v_enabled boolean;
  v_mode text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_started boolean;
  v_before_end boolean;
  v_on boolean;
begin
  select f.value into v_value from public.app_flags f where f.key = 'maintenance_mode';
  v_value := coalesce(v_value, '{}'::jsonb);
  v_enabled := coalesce((v_value ->> 'enabled')::boolean, false);
  v_mode := case when v_value ->> 'mode' in ('read_only', 'locked') then v_value ->> 'mode' else 'read_only' end;

  -- Only a well-formed timestamp is cast: a hand-edited row must degrade to "open ended", not throw
  -- inside a trigger that runs on every purchase.
  v_starts := case
    when coalesce(v_value ->> 'startsAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (v_value ->> 'startsAt')::timestamptz
    else null end;
  v_ends := case
    when coalesce(v_value ->> 'endsAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (v_value ->> 'endsAt')::timestamptz
    else null end;

  v_started := v_starts is null or v_starts <= now();
  v_before_end := v_ends is null or v_ends > now();
  v_on := v_enabled and v_started and v_before_end;

  return jsonb_build_object(
    'on', v_on,
    'enabled', v_enabled,
    'scheduled', v_enabled and not v_started,
    'expired', v_enabled and v_started and not v_before_end,
    'mode', v_mode,
    'title', v_value ->> 'title',
    'note', v_value ->> 'note',
    'startsAt', case when v_starts is null then null else to_char(v_starts, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'endsAt', case when v_ends is null then null else to_char(v_ends, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'startsIn', case when v_starts is null or v_started then null else greatest(0, floor(extract(epoch from (v_starts - now()))))::integer end,
    'endsIn', case when not v_on or v_ends is null then null else greatest(0, floor(extract(epoch from (v_ends - now()))))::integer end
  );
end;
$$;

-- The boolean every existing caller already uses; now it respects the window instead of the switch.
create or replace function app.maintenance_on()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((app.maintenance_state() ->> 'on')::boolean, false);
$$;

-- ------------------------------------------------------------ 2. the operator's hand

-- The old two-argument shape is dropped, not overloaded: with both alive, a `{p_on, p_note}` call from
-- an installed client would resolve to "function is not unique".
drop function if exists public.admin_set_maintenance(boolean, text);

create or replace function public.admin_set_maintenance(
  p_on boolean,
  p_mode text default 'read_only',
  p_title text default null,
  p_note text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_on boolean := coalesce(p_on, false);
  v_mode text := coalesce(nullif(btrim(coalesce(p_mode, '')), ''), 'read_only');
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_value jsonb;
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  if v_mode not in ('read_only', 'locked') then raise exception 'MODE_INVALID'; end if;
  if v_title is not null and char_length(v_title) > 80 then raise exception 'TITLE_TOO_LONG'; end if;
  if v_note is not null and char_length(v_note) > 400 then raise exception 'NOTE_TOO_LONG'; end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'WINDOW_INVALID';
  end if;
  -- A window in the past would look like a switch that does nothing; say so instead.
  if p_ends_at is not null and p_ends_at <= now() then raise exception 'WINDOW_PASSED'; end if;

  if not v_on then
    v_value := jsonb_build_object('enabled', false, 'mode', 'read_only');
  else
    v_value := jsonb_build_object(
      'enabled', true,
      'mode', v_mode,
      'title', v_title,
      'note', v_note,
      'startsAt', case when p_starts_at is null then null else to_char(p_starts_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'endsAt', case when p_ends_at is null then null else to_char(p_ends_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
    );
  end if;

  update public.app_flags
     set value = v_value, updated_at = now()
   where key = 'maintenance_mode';

  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
  values (v_uid, 'set_maintenance', 'app_flag', null, v_value);

  perform pg_notify('pgrst', 'reload schema');
  return app.maintenance_state();
end;
$$;

-- ------------------------------------------------------------ 3. the guard, on every write

create or replace function app.guard_maintenance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state jsonb;
  v_reason text;
begin
  if not app.maintenance_on() or app.is_moderator() then
    -- A BEFORE DELETE trigger must return OLD: returning NEW on a delete returns NULL, which silently
    -- skips the row instead of allowing it.
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_state := app.maintenance_state();
  v_reason := coalesce(nullif(v_state ->> 'title', ''), nullif(v_state ->> 'note', ''), 'the platform is read-only right now');
  raise exception 'MAINTENANCE: %', v_reason;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'spend_orders', 'user_themes', 'strategy_boosts', 'comments', 'ratings', 'favorites',
    'account_requests', 'reports'
  ] loop
    execute format('drop trigger if exists %I_guard_maintenance on public.%I', v_table, v_table);
    execute format(
      'create trigger %I_guard_maintenance before insert or update or delete on public.%I for each row execute function app.guard_maintenance()',
      v_table, v_table
    );
  end loop;
end;
$$;

-- ------------------------------------------------------------ 4. privileges

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'app.maintenance_state()',
    'app.maintenance_on()'
  ] loop
    if to_regprocedure(v_sig) is not null then
      -- These two answer "are we frozen" from inside the server; a member reads the flag row instead,
      -- so they do not need to be callable over HTTP. revoke ... from public is what actually closes
      -- the default EXECUTE grant Postgres gives PUBLIC.
      execute format('revoke execute on function %s from public, anon, authenticated', v_sig);
    end if;
  end loop;

  if to_regprocedure('public.admin_set_maintenance(boolean, text, text, text, timestamptz, timestamptz)') is not null then
    execute 'grant execute on function public.admin_set_maintenance(boolean, text, text, text, timestamptz, timestamptz) to authenticated';
  end if;
end;
$$;

-- ------------------------------------------------------------ 5. prove it landed

do $$
declare
  v_state jsonb;
begin
  v_state := app.maintenance_state();
  if (v_state ->> 'on') is null or (v_state ->> 'mode') is null then
    raise exception '0046 failed: maintenance_state() is missing on/mode';
  end if;
  if to_regprocedure('public.admin_set_maintenance(boolean, text)') is not null then
    raise exception '0046 failed: the old two-argument setter is still callable';
  end if;
  raise notice '0046 ok: maintenance is scheduled, two-mode, and covers updates and deletes.';
end;
$$;

select pg_notify('pgrst', 'reload schema');
