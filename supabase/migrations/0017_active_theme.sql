-- 0017: an owned theme has to change something, and "owned" has to mean something.
--
-- Why this exists. spend_currency writes user_themes rows, and nothing ever read them: buying a
-- theme produced a receipt and no visible effect. This adds the missing piece - the profile's active
-- theme - plus the rule that decides who may set it.
--
-- Why a definer RPC instead of a direct update. profiles is owner-updatable under RLS
-- (profiles_write_own), and the guard trigger only pins currency/xp/role/is_banned. A client could
-- therefore have written theme_key = 'toxic' without paying for it, which turns the M8 profile
-- showcase into a free premium item. So:
--   * the guard now pins theme_key for ordinary writes too, and
--   * select_theme() validates ownership in user_themes (free themes always allowed) and is the only
--     way to change it.
-- The guard cannot simply trust "we are inside a definer function" - app.is_admin() reads the
-- caller's claims, so the RPC's own write would look like a normal user's and be reverted. Instead
-- select_theme raises a transaction-local flag the guard checks. PostgREST only lets clients set
-- request.* GUCs, so app.theme_write cannot be forged from HTTP.

alter table public.profiles add column if not exists theme_key text references public.profile_themes (key);

-- "Varsayılan" must mean the app's own token, otherwise selecting it would quietly change the accent
-- from #4c8dff to whatever the seed row happened to carry.
update public.profile_themes
  set css = jsonb_set(coalesce(css, '{}'::jsonb), '{accent}', '"#4c8dff"'::jsonb)
  where key = 'default' and coalesce(css ->> 'accent', '') <> '#4c8dff';

-- The catalog is shown in both UI languages, and profile_themes only had a Turkish name.
alter table public.profile_themes add column if not exists name_en text;

update public.profile_themes set name_en = case key
  when 'default' then 'Default'
  when 'ember' then 'Ember'
  when 'toxic' then 'Toxic'
  else name_tr end where name_en is null;

create or replace function app.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Wallet counters are written only by the ledger RPCs; RLS cannot compare OLD vs NEW,
  -- so a trigger pins the server-owned columns for every non-admin update.
  if not app.is_admin() then
    new.currency_balance_cache := old.currency_balance_cache;
    new.xp := old.xp;
    new.role := old.role;
    new.is_banned := old.is_banned;
    -- Only select_theme() may move this, and it says so with a transaction-local flag.
    if coalesce(current_setting('app.theme_write', true), '') <> '1' then
      new.theme_key := old.theme_key;
    end if;
  end if;
  new.role := app.auth_role(new.id);
  return new;
end;
$$;

create or replace function public.select_theme(p_key text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_theme public.profile_themes%rowtype;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;

  select * into v_theme from public.profile_themes t where t.key = p_key;
  if v_theme.key is null then
    raise exception 'UNKNOWN_THEME: %', p_key;
  end if;

  if v_theme.price > 0 and not exists (
    select 1 from public.user_themes ut
      where ut.user_id = v_user and ut.theme_key = p_key
  ) then
    raise exception 'NOT_OWNED: buy this theme first';
  end if;

  perform set_config('app.theme_write', '1', true);

  update public.profiles set theme_key = p_key where id = v_user;

  return p_key;
end;
$$;

grant execute on function public.select_theme(text) to authenticated;

-- ------------------------------------------------------------ wallet: names, accent, active theme

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
  v_theme text;
  v_theme_accent text;
  v_rules jsonb;
  v_entries jsonb;
  v_catalog jsonb;
  v_boosts jsonb;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;

  select coalesce(sum(l.delta), 0)::integer into v_balance
    from public.currency_ledger l where l.user_id = v_user;

  select p.currency_balance_cache, p.theme_key into v_cached, v_theme
    from public.profiles p where p.id = v_user;

  select pt.css ->> 'accent' into v_theme_accent
    from public.profile_themes pt where pt.key = v_theme;

  select coalesce(jsonb_agg(jsonb_build_object(
             'code', r.code,
             'kind', r.kind,
             'amount', r.amount,
             'dailyCap', r.daily_cap,
             'weeklyCap', r.weekly_cap,
             'earnedToday', coalesce(t.today, 0),
             'earnedWeek', coalesce(t.week, 0)
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
             'delta', e.delta,
             'kind', e.kind,
             'ruleCode', e.rule_code,
             'refType', e.ref_type,
             'at', e.created_at
           ) order by e.id desc), '[]'::jsonb)
    into v_entries
    from (
      select l.id, l.delta, l.kind, l.rule_code, l.ref_type, l.created_at
        from public.currency_ledger l
        where l.user_id = v_user
        order by l.id desc
        limit 15
    ) e;

  -- Theme rows carry their display name and accent so the wallet page never shows a raw sku and so
  -- the language switch in M8 has something to translate.
  select coalesce(jsonb_agg(jsonb_build_object(
             'sku', c.sku,
             'kind', c.kind,
             'price', c.price,
             'refCode', c.ref_code,
             'durationHours', c.duration_hours,
             'name', coalesce(pt.name_tr, c.ref_code, c.sku),
             'nameEn', coalesce(pt.name_en, pt.name_tr, c.ref_code, c.sku),
             'accent', pt.css ->> 'accent',
             'owned', (c.kind = 'theme' and (c.price = 0 or (c.ref_code is not null and exists (
                select 1 from public.user_themes ut
                  where ut.user_id = v_user and ut.theme_key = c.ref_code
             ))))
           ) order by c.kind, c.price), '[]'::jsonb)
    into v_catalog
    from public.spend_catalog c
    left join public.profile_themes pt on pt.key = c.ref_code
    where c.enabled;

  select coalesce(jsonb_agg(jsonb_build_object(
             'strategyId', b.strategy_id,
             'strategyName', b.strategy_name,
             'sku', b.sku,
             'endsAt', b.ends_at
           ) order by b.ends_at desc), '[]'::jsonb)
    into v_boosts
    from (
      select sb.strategy_id, sb.sku, sb.ends_at, s.name as strategy_name
        from public.strategy_boosts sb
        join public.strategies s on s.id = sb.strategy_id
        where sb.buyer_id = v_user and sb.status = 'active' and sb.ends_at > now()
        order by sb.ends_at desc
        limit 20
    ) b;

  return jsonb_build_object(
    'balance', v_balance,
    'cached', v_cached,
    'reconciled', coalesce(v_cached, 0) = v_balance,
    'theme', v_theme,
    'themeAccent', v_theme_accent,
    'rules', v_rules,
    'entries', v_entries,
    'catalog', v_catalog,
    'boosts', v_boosts
  );
end;
$$;

grant execute on function public.wallet_summary() to authenticated;
