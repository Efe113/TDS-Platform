-- 0029: the console can create and delete, not only edit - plus maintenance mode and a richer board.
--
-- Why RPCs instead of the direct table writes the panel used: 0003 revoked insert/update/delete on
-- `currency_rules` and `badge_definitions` from authenticated and never granted an admin policy, so
-- every save from that screen failed at the database. Writes now go through security-definer
-- functions that check `app.is_admin()` themselves.
--
-- Also here:
--   * earning rules get corporate copy (name/description) instead of only a code,
--   * a maintenance flag that blocks user writes with a real error, not a hidden button,
--   * a leaderboard read that carries the previous window's rank, so a movement arrow is data.

-- ------------------------------------------------------------ 1. rule copy

alter table public.currency_rules add column if not exists name_tr text;
alter table public.currency_rules add column if not exists name_en text;
alter table public.currency_rules add column if not exists desc_tr text;
alter table public.currency_rules add column if not exists desc_en text;
alter table public.currency_rules add column if not exists icon text;

update public.currency_rules set name_tr = coalesce(name_tr, 'Nitelikli koşu'), name_en = coalesce(name_en, 'Qualified run')
 where code = 'usage_session';
update public.currency_rules set name_tr = coalesce(name_tr, 'Sürüm ödülü'), name_en = coalesce(name_en, 'Version reward')
 where code = 'publish_bonus';
update public.currency_rules set name_tr = coalesce(name_tr, 'İlk onay ödülü'), name_en = coalesce(name_en, 'First approval')
 where code = 'approval_bonus';
update public.currency_rules set name_tr = coalesce(name_tr, 'Rozet ödülü'), name_en = coalesce(name_en, 'Badge reward')
 where code = 'badge_reward';

-- ------------------------------------------------------------ 2. rule admin

create or replace function public.admin_upsert_rule(
  p_code text,
  p_kind text,
  p_amount integer,
  p_unit text,
  p_daily_cap integer default null,
  p_weekly_cap integer default null,
  p_min_seconds integer default null,
  p_min_steps integer default null,
  p_enabled boolean default true,
  p_name_tr text default null,
  p_name_en text default null,
  p_desc_tr text default null,
  p_desc_en text default null,
  p_params jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  if v_code !~ '^[a-z0-9_]{3,40}$' then raise exception 'CODE_INVALID'; end if;
  if p_kind not in ('usage', 'publish', 'approval', 'badge', 'grant') then raise exception 'KIND_INVALID'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'AMOUNT_INVALID'; end if;
  if p_daily_cap is not null and p_daily_cap < p_amount then raise exception 'CAP_BELOW_AMOUNT'; end if;
  if p_weekly_cap is not null and p_daily_cap is not null and p_weekly_cap < p_daily_cap then
    raise exception 'WEEKLY_BELOW_DAILY';
  end if;

  insert into public.currency_rules as r (
    code, kind, amount, unit, daily_cap, weekly_cap, min_qualifying_seconds, min_steps, enabled,
    name_tr, name_en, desc_tr, desc_en, params
  )
  values (
    v_code, p_kind, p_amount, coalesce(p_unit, 'per_event'), p_daily_cap, p_weekly_cap,
    p_min_seconds, p_min_steps, coalesce(p_enabled, true),
    nullif(btrim(coalesce(p_name_tr, '')), ''), nullif(btrim(coalesce(p_name_en, '')), ''),
    nullif(btrim(coalesce(p_desc_tr, '')), ''), nullif(btrim(coalesce(p_desc_en, '')), ''),
    coalesce(p_params, '{}'::jsonb)
  )
  on conflict (code) do update set
    kind = excluded.kind, amount = excluded.amount, unit = excluded.unit,
    daily_cap = excluded.daily_cap, weekly_cap = excluded.weekly_cap,
    min_qualifying_seconds = excluded.min_qualifying_seconds, min_steps = excluded.min_steps,
    enabled = excluded.enabled, name_tr = excluded.name_tr, name_en = excluded.name_en,
    desc_tr = excluded.desc_tr, desc_en = excluded.desc_en, params = excluded.params;

  return jsonb_build_object('code', v_code);
end;
$$;

create or replace function public.admin_delete_rule(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  -- The ledger keeps its history by rule_code string; deleting the rule only stops future payouts.
  delete from public.currency_rules where code = p_code;
  return found;
end;
$$;

-- ------------------------------------------------------------ 3. badge admin

create or replace function public.admin_upsert_badge(
  p_code text,
  p_name_tr text,
  p_name_en text default null,
  p_desc_tr text default null,
  p_tier text default 'bronze',
  p_award_mode text default 'auto',
  p_currency_reward integer default 0,
  p_conditions jsonb default '{}'::jsonb,
  p_active boolean default true,
  p_icon_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  if v_code !~ '^[a-z0-9_]{2,40}$' then raise exception 'CODE_INVALID'; end if;
  if char_length(btrim(coalesce(p_name_tr, ''))) < 2 then raise exception 'NAME_REQUIRED'; end if;
  if p_tier not in ('bronze', 'silver', 'gold', 'special') then raise exception 'TIER_INVALID'; end if;
  if p_award_mode not in ('auto', 'manual') then raise exception 'MODE_INVALID'; end if;
  if p_currency_reward is null or p_currency_reward < 0 then raise exception 'REWARD_INVALID'; end if;

  insert into public.badge_definitions as b (
    code, name_tr, name_en, desc_tr, icon_path, tier, conditions, award_mode, currency_reward, active
  )
  values (
    v_code, btrim(p_name_tr), nullif(btrim(coalesce(p_name_en, '')), ''),
    nullif(btrim(coalesce(p_desc_tr, '')), ''), nullif(btrim(coalesce(p_icon_path, '')), ''),
    p_tier, coalesce(p_conditions, '{}'::jsonb), p_award_mode, p_currency_reward, coalesce(p_active, true)
  )
  on conflict (code) do update set
    name_tr = excluded.name_tr, name_en = excluded.name_en, desc_tr = excluded.desc_tr,
    icon_path = excluded.icon_path, tier = excluded.tier, conditions = excluded.conditions,
    award_mode = excluded.award_mode, currency_reward = excluded.currency_reward, active = excluded.active;

  return jsonb_build_object('code', v_code);
end;
$$;

create or replace function public.admin_delete_badge(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  -- user_badges and spend_catalog reference this row; the catalogue item stays but stops granting.
  delete from public.badge_definitions where code = p_code;
  update public.spend_catalog set enabled = false, tag = 'soon'
   where kind = 'badge' and ref_code = p_code;
  return found;
end;
$$;

-- ------------------------------------------------------------ 4. maintenance

insert into public.app_flags (key, value)
values ('maintenance_mode', '{"enabled": false, "note": null}'::jsonb)
on conflict (key) do nothing;

create or replace function app.maintenance_on()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select (f.value ->> 'enabled')::boolean from public.app_flags f where f.key = 'maintenance_mode'), false);
$$;

create or replace function public.admin_set_maintenance(p_on boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  update public.app_flags
     set value = jsonb_build_object('enabled', coalesce(p_on, false), 'note', nullif(btrim(coalesce(p_note, '')), '')),
         updated_at = now()
   where key = 'maintenance_mode';
  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
  values (v_uid, 'set_maintenance', 'app_flag', null, jsonb_build_object('enabled', coalesce(p_on, false), 'note', p_note));
  return jsonb_build_object('enabled', coalesce(p_on, false));
end;
$$;

-- One guard, attached to the tables users write to, instead of trusting every call site to remember.
create or replace function app.guard_maintenance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if app.maintenance_on() and not app.is_moderator() then
    raise exception 'MAINTENANCE: the platform is read-only right now';
  end if;
  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['spend_orders', 'comments', 'ratings', 'favorites'] loop
    execute format('drop trigger if exists %I_guard_maintenance on public.%I', v_table, v_table);
    execute format(
      'create trigger %I_guard_maintenance before insert on public.%I for each row execute function app.guard_maintenance()',
      v_table, v_table
    );
  end loop;
end;
$$;

-- ------------------------------------------------------------ 5. leaderboard read with movement

create or replace function public.leaderboard_overview(p_window text default 'all_time', p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_window text := coalesce(p_window, 'all_time');
  v_prev_window text;
  v_rows jsonb;
  v_prev jsonb;
  v_me jsonb;
  v_total integer;
begin
  if v_window not in ('all_time', 'weekly', 'daily') then
    raise exception 'WINDOW_INVALID';
  end if;

  v_prev_window := case v_window when 'daily' then 'weekly' when 'weekly' then 'all_time' else null end;

  select coalesce(jsonb_agg(to_jsonb(g) order by g.rank), '[]'::jsonb)
    into v_rows
    from public.get_leaderboard(v_window, greatest(least(p_limit, 100), 1)) g;

  if v_prev_window is null then
    v_prev := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(jsonb_build_object('strategyId', g.strategy_id, 'rank', g.rank)), '[]'::jsonb)
      into v_prev
      from public.get_leaderboard(v_prev_window, 200) g;
  end if;

  select count(*) into v_total from public.get_leaderboard(v_window, 200);

  select jsonb_build_object('rank', g.rank, 'score', g.score, 'name', g.name, 'strategyId', g.strategy_id)
    into v_me
    from public.get_leaderboard(v_window, 200) g
    join public.strategies s on s.id = g.strategy_id
   where s.owner_id = auth.uid()
   order by g.rank
   limit 1;

  return jsonb_build_object(
    'window', v_window,
    'rows', v_rows,
    'previous', v_prev,
    'previousWindow', v_prev_window,
    'total', v_total,
    'me', v_me
  );
end;
$$;

-- ------------------------------------------------------------ 6. wallet rules carry their copy

create or replace function public.wallet_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_balance integer := 0;
  v_cached integer;
  v_rules jsonb;
  v_entries jsonb;
  v_catalog jsonb;
  v_boosts jsonb;
begin
  if v_user is null then raise exception 'ANONYMOUS: sign in first'; end if;

  select coalesce(sum(l.delta), 0)::integer into v_balance from public.currency_ledger l where l.user_id = v_user;
  select p.currency_balance_cache into v_cached from public.profiles p where p.id = v_user;

  select coalesce(jsonb_agg(jsonb_build_object(
             'code', r.code, 'kind', r.kind, 'amount', r.amount,
             'unit', r.unit,
             'name', r.name_tr, 'nameEn', r.name_en, 'desc', r.desc_tr, 'descEn', r.desc_en,
             'dailyCap', r.daily_cap, 'weeklyCap', r.weekly_cap,
             'earnedToday', coalesce(t.today, 0), 'earnedWeek', coalesce(t.week, 0)
           ) order by r.code), '[]'::jsonb)
    into v_rules
    from public.currency_rules r
    left join lateral (
      select coalesce(sum(l.delta) filter (where l.created_at >= date_trunc('day', now())), 0)::integer as today,
             coalesce(sum(l.delta) filter (where l.created_at >= date_trunc('week', now())), 0)::integer as week
        from public.currency_ledger l
        where l.user_id = v_user and l.rule_code = r.code and l.delta > 0
    ) t on true
    where r.enabled;

  select coalesce(jsonb_agg(jsonb_build_object(
             'delta', e.delta, 'kind', e.kind, 'ruleCode', e.rule_code, 'refType', e.ref_type, 'at', e.created_at
           ) order by e.id desc), '[]'::jsonb)
    into v_entries
    from (
      select l.id, l.delta, l.kind, l.rule_code, l.ref_type, l.created_at
        from public.currency_ledger l
        where l.user_id = v_user
        order by l.id desc
        limit 15
    ) e;

  select coalesce(jsonb_agg(jsonb_build_object(
             'sku', c.sku, 'kind', c.kind, 'price', c.price,
             'finalPrice', app.effective_price(c),
             'discountPercent', case when app.discount_active(c) then c.discount_percent else 0 end,
             'discountEndsAt', case when app.discount_active(c) then c.discount_ends_at else null end,
             'tag', c.tag, 'refCode', c.ref_code, 'durationHours', c.duration_hours,
             'name', c.name_tr, 'nameEn', c.name_en, 'desc', c.desc_tr, 'descEn', c.desc_en,
             'perks', c.perks, 'sortOrder', c.sort_order,
             'owned', case c.kind
               when 'theme' then (c.price = 0 or exists (
                 select 1 from public.user_themes ut where ut.user_id = v_user and ut.theme_key = c.ref_code))
               else exists (
                 select 1 from public.spend_orders o where o.user_id = v_user and o.sku = c.sku and o.status = 'filled')
             end
           ) order by c.sort_order, c.price, c.sku), '[]'::jsonb)
    into v_catalog
    from public.spend_catalog c
    where c.enabled;

  select coalesce(jsonb_agg(jsonb_build_object(
             'strategyId', b.strategy_id, 'strategyName', s.name, 'sku', b.sku, 'endsAt', b.ends_at
           ) order by b.ends_at), '[]'::jsonb)
    into v_boosts
    from public.strategy_boosts b
    join public.strategies s on s.id = b.strategy_id
    where b.buyer_id = v_user and b.status = 'active' and b.ends_at > now();

  return jsonb_build_object(
    'balance', v_balance, 'cached', v_cached,
    'reconciled', (v_cached is null or v_cached = v_balance),
    'theme', (select p.theme_key from public.profiles p where p.id = v_user),
    'themeAccent', (select t.css ->> 'accent' from public.profiles p join public.profile_themes t on t.key = p.theme_key where p.id = v_user),
    'rules', v_rules, 'entries', v_entries, 'catalog', v_catalog, 'boosts', v_boosts,
    'maintenance', app.maintenance_on()
  );
end;
$$;

-- ------------------------------------------------------------ 7. privileges

do $$
declare
  v_sig text;
  v_list text[] := array[
    'public.admin_upsert_rule(text, text, integer, text, integer, integer, integer, integer, boolean, text, text, text, text, jsonb)',
    'public.admin_delete_rule(text)',
    'public.admin_upsert_badge(text, text, text, text, text, text, integer, jsonb, boolean, text)',
    'public.admin_delete_badge(text)',
    'public.admin_set_maintenance(boolean, text)',
    'public.leaderboard_overview(text, integer)',
    'public.wallet_summary()',
    'app.maintenance_on()'
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

  v_sig := 'public.leaderboard_overview(text, integer)';
  if to_regprocedure(v_sig) is not null then
    execute format('grant execute on function %s to anon', v_sig);
  end if;
end;
$$;

do $$
begin
  raise notice '0029: rules and badges can be created/deleted, maintenance blocks user writes, leaderboard carries movement.';
end;
$$;
