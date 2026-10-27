-- 0.3.8 Faz A: the badge catalogue, readable by the member it belongs to.
--
-- The badge engine (0003/0019) and the admin console (0038) have existed for a long time; what never
-- existed was the member's own view. `/badges` was a "coming soon" stub while the data it needs was
-- already in the database, and the only reader that answers "do I hold this badge?" was
-- `admin_user_badges(uuid)` — admin-only, and it takes another user's id.
--
-- This file adds the read the app was missing. It deliberately does not add a table: `badge_definitions`
-- and `user_badges` are the truth, and a second copy of either would be a second thing to keep in sync.
--
--   * active definitions only. A retired badge is not something a member can work toward, and showing it
--     with no explanation reads as a bug.
--   * the caller's own holdings. `auth.uid()` is read inside the function, so the client cannot ask about
--     somebody else and a signed-out visitor simply sees the catalogue with nothing held.
--   * the same metrics the engine awards from. `app.evaluate_badges()` compares criteria against
--     `to_jsonb(stat_user_rollup) - user_id - updated_at`, so this returns exactly that object. If the
--     page showed a different number than the engine reads, the "you are at 7/10" line would be a lie
--     about a rule nobody wrote down twice.
--
-- Safe to run twice. Depends on 0003 (badge_definitions, user_badges, stat_user_rollup) and 0019 (the
-- criterion vocabulary this mirrors).

-- ------------------------------------------------------------ 1. the member's read

create or replace function public.badge_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_metrics jsonb;
  v_badges jsonb;
  v_owned integer := 0;
  v_total integer := 0;
  v_out jsonb;
begin
  -- The identical projection the award engine evaluates against.
  select to_jsonb(r) - 'user_id' - 'updated_at' into v_metrics
    from public.stat_user_rollup r
   where r.user_id = v_user;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'code', s.code,
        'name', s.name_tr,
        'nameEn', s.name_en,
        'desc', s.desc_tr,
        'tier', s.tier,
        'awardMode', s.award_mode,
        'reward', s.currency_reward,
        'iconPath', s.icon_path,
        'conditions', s.conditions,
        'awarded', s.held,
        'awardedAt', s.awarded_at
      )
      -- The ladder first, then the code: bronze before gold reads as progress, alphabetical does not.
      order by s.tier_rank, s.code
    ),
    '[]'::jsonb
  )
  into v_badges
  from (
    select b.code,
           b.name_tr,
           b.name_en,
           b.desc_tr,
           b.tier,
           b.award_mode,
           b.currency_reward,
           b.icon_path,
           b.conditions,
           -- `is not null` is already boolean, so a signed-out read gives false rather than null.
           (ub.user_id is not null) as held,
           ub.awarded_at,
           case b.tier when 'bronze' then 0 when 'silver' then 1 when 'gold' then 2 else 3 end as tier_rank
      from public.badge_definitions b
      left join public.user_badges ub on ub.code = b.code and ub.user_id = v_user
     where b.active
  ) s;

  select count(*) into v_owned
    from public.user_badges ub
    join public.badge_definitions d on d.code = ub.code
   where d.active
     and ub.user_id = v_user;

  select count(*) into v_total
    from public.badge_definitions b
   where b.active;

  v_out := jsonb_build_object(
    'badges', v_badges,
    'metrics', coalesce(v_metrics, '{}'::jsonb),
    'owned', v_owned,
    'total', v_total
  );

  return v_out;
end;
$$;

-- ------------------------------------------------------------ 2. privileges

do $$
begin
  if to_regprocedure('public.badge_catalog()') is null then
    raise exception '0053 failed: badge_catalog() was not created';
  end if;

  revoke execute on function public.badge_catalog() from public;
  grant execute on function public.badge_catalog() to authenticated;

  -- A visitor browsing the app sees the same shelf as a member: nothing held, everything earnable.
  grant execute on function public.badge_catalog() to anon;
end;
$$;

-- ------------------------------------------------------------ 3. prove it landed

do $$
declare
  v_out jsonb;
  v_row jsonb;
  v_active integer;
begin
  v_out := public.badge_catalog();

  if jsonb_typeof(v_out) <> 'object' then
    raise exception '0053 failed: badge_catalog() must answer an object, got %', jsonb_typeof(v_out);
  end if;

  if jsonb_typeof(v_out -> 'badges') <> 'array' then
    raise exception '0053 failed: badge_catalog() lost the badge array';
  end if;

  if jsonb_typeof(v_out -> 'metrics') is null
     or jsonb_typeof(v_out -> 'owned') is null
     or jsonb_typeof(v_out -> 'total') is null then
    raise exception '0053 failed: badge_catalog() must answer metrics, owned and total';
  end if;

  select count(*) into v_active from public.badge_definitions where active;
  if jsonb_array_length(v_out -> 'badges') <> v_active then
    raise exception '0053 failed: the reader returned % rows for % active definitions',
      jsonb_array_length(v_out -> 'badges'), v_active;
  end if;

  -- The criteria ride along, or the page can only ever say the name and not how the badge is earned.
  if exists (
    select 1 from jsonb_array_elements(v_out -> 'badges') e
     where coalesce(jsonb_typeof(e -> 'conditions'), 'null') = 'null'
  ) then
    raise exception '0053 failed: a badge reached the catalogue without its conditions';
  end if;

  -- Without a session there is nobody to hold a badge, and `owned` must still be a number, not null:
  -- this is exactly the three-valued read that broke 0051's payload.
  if auth.uid() is null then
    if coalesce((v_out ->> 'owned')::int, -1) <> 0 then
      raise exception '0053 failed: a signed-out read must report zero badges held';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_out -> 'badges') e
       where coalesce((e ->> 'awarded')::boolean, false)
    ) then
      raise exception '0053 failed: a signed-out read reported a held badge';
    end if;
  end if;

  raise notice '0053 ok: rozet kataloğu üye için okunabilir — kazanma ölçütleri ve kendi ilerlemen birlikte.';
end;
$$;

select pg_notify('pgrst', 'reload schema');
