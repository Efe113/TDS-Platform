-- 0041: the money hands an operator keeps needing.
--
-- Three gaps that made the admin console a read-only toy whenever money went wrong:
--
--   * `verify_balance` only compared the cache with the ledger and reported the mismatch. Nothing
--     could fix it, so a drift found in the wallet was a drift kept forever.
--   * `spend_orders.status` had a 'reversed' value that no code ever wrote. A mistaken sale could
--     not be taken back: the coins stayed spent and the product stayed owned.
--   * VIP could be granted but never withdrawn. Turning membership off left the rainbow frame and the
--     gold title equipped, because those came from a receipt the console had no way to reverse.
--
-- Everything here moves through the ledger, so the hash chain and `currency_balance_cache` stay the
-- only truths, and every action leaves an `admin_audit_log` row.
--
-- Depends on 0038 (admin_adjust_balance, ledger notes) and 0040 (corporate entitlements). Safe to run
-- twice.

-- ------------------------------------------------------------ 1. repair the cached balance

-- The cache is a denormalised copy of the ledger, so the ledger wins. This is the one place allowed to
-- write `currency_balance_cache` directly, and it writes exactly what a re-sum would produce.
create or replace function public.admin_reconcile_balance(p_user uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ledger integer;
  v_cached integer;
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user is null then raise exception 'USER_REQUIRED'; end if;

  select coalesce(sum(l.delta), 0)::integer into v_ledger from public.currency_ledger l where l.user_id = p_user;
  select p.currency_balance_cache into v_cached from public.profiles p where p.id = p_user;
  if v_cached is null and not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'NOT_FOUND';
  end if;

  update public.profiles
     set currency_balance_cache = v_ledger, updated_at = now()
   where id = p_user;

  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
    values (v_uid, 'reconcile_balance', 'profile', p_user,
            jsonb_build_object('from', v_cached, 'to', v_ledger,
                               'note', nullif(btrim(coalesce(p_note, '')), '')));

  return jsonb_build_object('userId', p_user, 'from', v_cached, 'balance', v_ledger,
                            'changed', (v_cached is distinct from v_ledger));
end;
$$;

-- The same repair for every account that drifted, so an operator sees one number instead of hunting.
create or replace function public.admin_reconcile_drift(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
  v_count integer := 0;
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;

  -- Measured first, then repaired: a data-modifying CTE would not see its own rows, and the report
  -- has to say what the cache held before the fix.
  select coalesce(jsonb_agg(jsonb_build_object(
             'userId', f.id, 'handle', f.handle, 'from', f.before_value, 'to', f.ledger_value
           ) order by f.handle), '[]'::jsonb),
         count(*)
    into v_rows, v_count
    from (
      select p.id, p.handle, p.currency_balance_cache as before_value,
             coalesce((select sum(l.delta) from public.currency_ledger l where l.user_id = p.id), 0)::integer as ledger_value
        from public.profiles p
       where p.currency_balance_cache is distinct from
             coalesce((select sum(l.delta) from public.currency_ledger l where l.user_id = p.id), 0)::integer
       order by p.updated_at desc
       limit greatest(least(coalesce(p_limit, 200), 500), 1)
    ) f;

  if v_count > 0 then
    update public.profiles p
       set currency_balance_cache =
             coalesce((select sum(l.delta) from public.currency_ledger l where l.user_id = p.id), 0)::integer,
           updated_at = now()
     where p.id in (select (e ->> 'userId')::uuid from jsonb_array_elements(v_rows) e);

    insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
      values (v_uid, 'reconcile_drift', 'profile', null,
              jsonb_build_object('count', v_count, 'rows', v_rows));
  end if;

  return jsonb_build_object('repaired', v_count, 'rows', v_rows, 'actor', v_uid, 'at', now());
end;
$$;

-- ------------------------------------------------------------ 2. take a sale back

-- An order is both a receipt and an entitlement. Refunding therefore has three jobs: give the coins
-- back through the ledger, stop the receipt granting anything, and put the product back on the shelf.
create or replace function public.admin_refund_order(
  p_order uuid,
  p_note text,
  p_reclaim boolean default true,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.spend_orders%rowtype;
  v_item public.spend_catalog%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_key text;
  v_balance integer;
  v_other integer;
  v_claims jsonb := '[]'::jsonb;
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_order is null then raise exception 'ORDER_REQUIRED'; end if;
  if v_note is null then raise exception 'NOTE_REQUIRED'; end if;
  if char_length(v_note) > 300 then raise exception 'NOTE_LONG'; end if;

  select * into v_order from public.spend_orders o where o.id = p_order;
  if v_order.id is null then raise exception 'NOT_FOUND'; end if;
  if v_order.status <> 'filled' then raise exception 'ALREADY_REVERSED: %', v_order.status; end if;

  select * into v_item from public.spend_catalog c where c.sku = v_order.sku;

  -- 1. the coins come back as a normal ledger row, so the chain and the cache stay consistent.
  v_key := coalesce(nullif(btrim(coalesce(p_idempotency_key, '')), ''), 'refund:' || p_order::text);
  v_balance := app.ledger_append(v_order.user_id, v_order.price_paid, 'refund', v_order.sku,
                                 'order', v_order.id::text, v_key, v_uid::text, v_note);

  -- 2. the receipt stops being an entitlement for every reader that asks for status = 'filled'.
  update public.spend_orders set status = 'reversed', grant_note = coalesce(grant_note, '') || ' | refund' where id = p_order;

  if not p_reclaim then
    insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
      values (v_uid, 'refund_order', 'spend_order', p_order,
              jsonb_build_object('sku', v_order.sku, 'refunded', v_order.price_paid,
                                 'reclaim', false, 'note', v_note, 'balance', v_balance));
    return jsonb_build_object('orderId', p_order, 'refunded', v_order.price_paid,
                              'balance', v_balance, 'reclaimed', v_claims);
  end if;

  -- 3. the product itself goes back, but only what this receipt was the last source of.
  if v_item.kind = 'theme' then
    delete from public.user_themes where user_id = v_order.user_id and theme_key = v_item.ref_code;
    update public.profiles
       set theme_key = case when theme_key = v_item.ref_code then 'default' else theme_key end,
           updated_at = now()
     where id = v_order.user_id;
    v_claims := v_claims || jsonb_build_array(jsonb_build_object('kind', 'theme', 'ref', v_item.ref_code));

  elsif v_item.kind in ('frame', 'title') then
    -- A bundle receipt for the same registry key still owns it, so count the remaining filled orders.
    select count(*) into v_other
      from public.spend_orders o
      join public.spend_catalog c on c.sku = o.sku
     where o.user_id = v_order.user_id and o.status = 'filled' and o.id <> p_order
       and c.kind = v_item.kind and c.ref_code = v_item.ref_code;
    if v_other = 0 then
      perform set_config('app.cosmetic_write', 'on', true);
      if v_item.kind = 'frame' then
        update public.profiles
           set frame_key = case when frame_key = v_item.ref_code then null else frame_key end,
               updated_at = now()
         where id = v_order.user_id;
      else
        update public.profiles
           set active_title = case when active_title = v_item.ref_code then null else active_title end,
               updated_at = now()
         where id = v_order.user_id;
      end if;
      perform set_config('app.cosmetic_write', 'off', true);
      v_claims := v_claims || jsonb_build_array(jsonb_build_object('kind', v_item.kind, 'ref', v_item.ref_code));
    end if;

  elsif v_item.kind = 'badge' then
    select count(*) into v_other
      from public.spend_orders o
      join public.spend_catalog c on c.sku = o.sku
     where o.user_id = v_order.user_id and o.status = 'filled' and o.id <> p_order
       and c.kind = 'badge' and c.ref_code = v_item.ref_code;
    if v_other = 0 then
      delete from public.public_badges where user_id = v_order.user_id and code = v_item.ref_code;
      delete from public.user_badges where user_id = v_order.user_id and code = v_item.ref_code
        and awarded_by = 'purchase';
      v_claims := v_claims || jsonb_build_array(jsonb_build_object('kind', 'badge', 'ref', v_item.ref_code));
    end if;

  elsif v_item.kind = 'boost' then
    -- Older boost rows have no order_id, so the pair (buyer, sku) is the fallback link.
    update public.strategy_boosts
       set status = 'reversed'
     where status = 'active'
       and (order_id = p_order or (buyer_id = v_order.user_id and sku = v_order.sku));

    -- The pin is a derived value: whatever is still live decides it, including a boost bought
    -- separately for the same strategy.
    update public.strategies s
       set boost_expires_at = (
         select max(x.ends_at) from public.strategy_boosts x
          where x.strategy_id = s.id and x.status = 'active' and x.ends_at > now()
       )
     where s.id in (
       select b.strategy_id from public.strategy_boosts b
        where b.order_id = p_order
           or (b.buyer_id = v_order.user_id and b.sku = v_order.sku)
     );
    v_claims := v_claims || jsonb_build_array(jsonb_build_object('kind', 'boost', 'ref', v_item.ref_code));

  elsif v_item.kind = 'vip' then
    -- Membership is derived from a filled VIP order, so reversing this receipt already ends it. The
    -- bundle has to follow: the frame came with the tier, and so did the gold title. Reverse the
    -- bundle receipt first, otherwise it still counts as a source when the frame is examined.
    update public.spend_orders
       set status = 'reversed'
     where user_id = v_order.user_id and status = 'filled' and id <> p_order
       and coalesce(grant_note, '') like 'vip:' || p_order::text;

    select count(*) into v_other
      from public.spend_orders o
      join public.spend_catalog c on c.sku = o.sku
     where o.user_id = v_order.user_id and o.status = 'filled'
       and c.kind = 'frame' and c.ref_code = 'rainbow';

    perform set_config('app.cosmetic_write', 'on', true);
    update public.profiles
       set active_title = case
             when active_title = 'vip_rainbow' then
               case when app.corporate_active(v_order.user_id) then 'corporate'
                    when exists (select 1 from public.profiles q
                                  where q.id = v_order.user_id and q.is_verified) then 'verified_green'
                    else null end
             else active_title
           end,
           frame_key = case
             when frame_key = 'rainbow' and v_other = 0 and not app.corporate_active(v_order.user_id) then null
             else frame_key
           end,
           updated_at = now()
     where id = v_order.user_id;
    perform set_config('app.cosmetic_write', 'off', true);
    v_claims := v_claims || jsonb_build_array(jsonb_build_object('kind', 'vip', 'ref', 'membership'));
  end if;

  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
    values (v_uid, 'refund_order', 'spend_order', p_order,
            jsonb_build_object('sku', v_order.sku, 'userId', v_order.user_id,
                               'refunded', v_order.price_paid, 'reclaim', true,
                               'note', v_note, 'balance', v_balance, 'reclaimed', v_claims));

  return jsonb_build_object('orderId', p_order, 'refunded', v_order.price_paid,
                            'balance', v_balance, 'reclaimed', v_claims);
end;
$$;

-- ------------------------------------------------------------ 3. grant and withdraw membership

create or replace function public.admin_set_vip(p_user uuid, p_on boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_sku text;
  v_order uuid;
  v_claims jsonb := '[]'::jsonb;
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user is null then raise exception 'USER_REQUIRED'; end if;
  if p_user = v_uid then raise exception 'SELF_FORBIDDEN'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then raise exception 'NOT_FOUND'; end if;

  if coalesce(p_on, false) then
    if app.vip_active(p_user) then raise exception 'ALREADY_OWNED: already a VIP'; end if;

    select c.sku into v_sku
      from public.spend_catalog c
     where c.kind = 'vip' and c.enabled
     order by c.sort_order, c.price
     limit 1;
    if v_sku is null then raise exception 'NO_VIP_SKU: the catalog has no membership row'; end if;

    insert into public.spend_orders (user_id, sku, price_paid, idempotency_key, grant_note)
      values (p_user, v_sku, 0, null, 'admin_grant:' || v_uid::text)
      returning id into v_order;

    -- The same bundle a paid VIP gets, through the same registry lookup.
    insert into public.spend_orders (user_id, sku, price_paid, idempotency_key, grant_note)
    select p_user, c.sku, 0, null, 'vip:' || v_order::text
      from public.spend_catalog c
     where c.kind = 'frame' and c.ref_code = 'rainbow'
       and not exists (
         select 1 from public.spend_orders o
          where o.user_id = p_user and o.sku = c.sku and o.status = 'filled'
       )
     order by c.enabled desc, c.sort_order
     limit 1;

    perform set_config('app.cosmetic_write', 'on', true);
    update public.profiles p
       set frame_key = coalesce(p.frame_key, 'rainbow'), updated_at = now()
     where p.id = p_user;
    perform set_config('app.cosmetic_write', 'off', true);
    v_claims := v_claims || jsonb_build_array(jsonb_build_object('orderId', v_order, 'sku', v_sku));

  else
    -- Withdrawal is the mirror: the receipts stop counting and the tier's cosmetics leave with them.
    perform set_config('app.cosmetic_write', 'on', true);
    update public.spend_orders
       set status = 'reversed', grant_note = coalesce(grant_note, '') || ' | revoked'
     where user_id = p_user and status = 'filled'
       and sku in (select c.sku from public.spend_catalog c where c.kind = 'vip');
    update public.spend_orders
       set status = 'reversed'
     where user_id = p_user and status = 'filled'
       and coalesce(grant_note, '') like 'vip:%'
       and sku in (select c.sku from public.spend_catalog c where c.kind = 'frame' and c.ref_code = 'rainbow');
    update public.profiles
       set active_title = case
             when active_title = 'vip_rainbow' then
               case when app.corporate_active(p_user) then 'corporate'
                    when exists (select 1 from public.profiles q where q.id = p_user and q.is_verified)
                      then 'verified_green'
                    else null end
             else active_title
           end,
           frame_key = case
             when frame_key = 'rainbow'
               and not exists (
                 select 1 from public.spend_orders o
                 join public.spend_catalog c on c.sku = o.sku
                  where o.user_id = p_user and o.status = 'filled'
                    and c.kind = 'frame' and c.ref_code = 'rainbow'
               )
               and not app.corporate_active(p_user)
             then null
             else frame_key
           end,
           updated_at = now()
     where id = p_user;
    perform set_config('app.cosmetic_write', 'off', true);
  end if;

  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
    values (v_uid, case when coalesce(p_on, false) then 'grant_vip' else 'revoke_vip' end,
            'profile', p_user,
            jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), ''),
                               'vip', app.vip_active(p_user),
                               'ledger', (select coalesce(sum(l.delta), 0)::integer
                                            from public.currency_ledger l where l.user_id = p_user)));

  return jsonb_build_object('userId', p_user, 'vip', app.vip_active(p_user), 'changes', v_claims);
end;
$$;

-- ------------------------------------------------------------ 4. privileges

do $$
declare
  v_sig text;
  v_list text[] := array[
    'public.admin_reconcile_balance(uuid, text)',
    'public.admin_reconcile_drift(integer)',
    'public.admin_refund_order(uuid, text, boolean, text)',
    'public.admin_set_vip(uuid, boolean, text)'
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
end;
$$;

select pg_notify('pgrst', 'reload schema');

do $$
begin
  raise notice '0041: reconcile, refund and VIP withdrawal ready.';
end;
$$;

-- ------------------------------------------------------------ 5. the leaderboard reads tiers on the server

-- The tick and the title used to be stitched in by the client with an extra profile query per
-- board row. Both boards now read the tier from the same place every other surface does, and carry the
-- English title name so an English interface stops painting a Turkish one.
create or replace function public.leaderboard_hub(
  p_board text default 'strategies',
  p_metric text default 'sessions',
  p_window text default 'all_time',
  p_limit integer default 50
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_board text := coalesce(p_board, 'strategies');
  v_metric text := coalesce(p_metric, 'sessions');
  v_window text := coalesce(p_window, 'all_time');
  v_limit integer := greatest(least(coalesce(p_limit, 50), 100), 1);
  v_prev_window text;
  v_start timestamptz;
  v_prev_start timestamptz;
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_board not in ('strategies', 'players') then
    raise exception 'BOARD_INVALID';
  end if;
  if v_metric not in ('sessions', 'steps', 'coins', 'publishes') then
    raise exception 'METRIC_INVALID';
  end if;
  if v_window not in ('all_time', 'weekly', 'daily') then
    raise exception 'WINDOW_INVALID';
  end if;

  v_prev_window := case v_window
    when 'daily' then 'weekly'
    when 'weekly' then 'all_time'
    else null
  end;
  v_start := app.leaderboard_window_start(v_window);
  v_prev_start := case when v_prev_window is null then null else app.leaderboard_window_start(v_prev_window) end;

  if v_board = 'strategies' then
    with cur as (
      select g.rank, g.strategy_id, g.name, g.score, g.is_event_strategy, g.map_key,
             s.owner_id, p.handle, p.display_name, p.avatar_path, p.frame_key,
             t.name_tr as title_name,
             t.name_en as title_name_en,
             p.active_title as title_key,
             app.vip_active(s.owner_id) as vip,
             app.verified_active(s.owner_id) as verified,
             app.corporate_active(s.owner_id) as corporate,
             coalesce(r.sessions_qualified, 0)::integer as sessions,
             coalesce(r.steps_completed, 0)::integer as steps,
             coalesce(r.streak, 0)::integer as streak,
             coalesce(r.active_days, 0)::integer as active_days,
             r.usage_rank_best,
             bd.badges, coalesce(bd.badge_count, 0) as badge_count
        from public.get_leaderboard(v_window, 200) g
        join public.strategies s on s.id = g.strategy_id
        join public.profiles p on p.id = s.owner_id
        left join public.spend_catalog t on t.kind = 'title' and t.ref_code = p.active_title
        left join public.stat_user_rollup r on r.user_id = s.owner_id
        left join lateral (
          select jsonb_agg(
                   jsonb_build_object(
                     'code', b.code,
                     'name', coalesce(b.name_tr, b.name_en, b.code),
                     'tier', b.tier,
                   'iconPath', b.icon_path) order by ub.awarded_at desc
                 ) as badges,
                 count(*) as badge_count
            from public.user_badges ub
            join public.badge_definitions b on b.code = ub.code
           where ub.user_id = s.owner_id
        ) bd on true
    ),
    prev as (
      select g.strategy_id, g.rank
        from public.get_leaderboard(coalesce(v_prev_window, v_window), 200) g
       where v_prev_window is not null
    ),
    shaped as (
      select c.rank, c.owner_id, c.score,
             pr.rank as previous_rank,
             case when pr.rank is null then null else pr.rank - c.rank end as movement,
             jsonb_build_object(
               'entityId', c.strategy_id,
               'kind', 'strategy',
               'rank', c.rank,
               'previousRank', pr.rank,
               'movement', case when pr.rank is null then null else pr.rank - c.rank end,
               'score', c.score,
               'name', c.name,
               'playerId', c.owner_id,
               'handle', c.handle,
               'displayName', c.display_name,
               'avatarPath', c.avatar_path,
               'frameKey', c.frame_key,
               'titleName', c.title_name,
               'titleNameEn', c.title_name_en,
               'titleKey', c.title_key,
               'vip', c.vip,
               'verified', c.verified,
               'corporate', c.corporate,
               'badges', coalesce(c.badges, '[]'::jsonb),
               'badgeCount', c.badge_count,
               'topStrategyId', c.strategy_id,
               'topStrategyName', c.name,
               'mapKey', c.map_key,
               'isEvent', c.is_event_strategy,
               'sessions', c.sessions,
               'steps', c.steps,
               'coins', 0,
               'publishes', 0,
               'streak', c.streak,
               'activeDays', c.active_days,
               'bestRank', c.usage_rank_best
             ) as obj
        from cur c
        left join prev pr on pr.strategy_id = c.strategy_id
    ),
    me_row as (
      select s.* from shaped s where s.owner_id = v_uid order by s.rank limit 1
    ),
    total as (
      select count(*)::integer as n from shaped
    )
    select jsonb_build_object(
      'board', 'strategies',
      'metric', 'sessions',
      'window', v_window,
      'previousWindow', v_prev_window,
      'bucket', app.leaderboard_bucket(v_window),
      'windowStart', case when v_window = 'all_time' then null else v_start end,
      'generatedAt', now(),
      'total', (select n from total),
      'rows', (
        select coalesce(jsonb_agg(obj order by rank), '[]'::jsonb)
          from (select * from shaped order by rank limit v_limit) r
      ),
      'me', (
        select obj || jsonb_build_object(
          'percentile', case
            when (select n from total) > 0
              then greatest(1, round((me_row.rank::numeric / (select n from total)) * 100))::integer
            else null
          end,
          'gapToNext', (select x.score - me_row.score from shaped x where x.rank = me_row.rank - 1)
        )
          from me_row
      ),
      'nearMe', (
        select coalesce(jsonb_agg(obj order by rank), '[]'::jsonb)
          from shaped
         where rank between (select rank from me_row) - 2 and (select rank from me_row) + 2
      ),
      'movers', jsonb_build_object(
        'climbers', (
          select coalesce(jsonb_agg(obj order by movement desc), '[]'::jsonb)
            from (select * from shaped where movement > 0 order by movement desc, rank limit 3) c
        ),
        'fallers', (
          select coalesce(jsonb_agg(obj order by movement asc), '[]'::jsonb)
            from (select * from shaped where movement < 0 order by movement asc, rank limit 3) f
        )
      )
    ) into v_result;

    return v_result;
  end if;

  with users as (
    select p.id, p.handle, p.display_name, p.avatar_path, p.frame_key,
           t.name_tr as title_name,
           t.name_en as title_name_en,
           p.active_title as title_key,
           app.vip_active(p.id) as vip,
           app.verified_active(p.id) as verified,
           app.corporate_active(p.id) as corporate,
           coalesce(r.streak, 0)::integer as streak,
           coalesce(r.active_days, 0)::integer as active_days,
           r.usage_rank_best,
           ts.id as top_strategy_id,
           ts.name as top_strategy_name,
           bd.badges, coalesce(bd.badge_count, 0) as badge_count
      from public.profiles p
      left join public.spend_catalog t on t.kind = 'title' and t.ref_code = p.active_title
      left join public.stat_user_rollup r on r.user_id = p.id
      left join lateral (
        select s.id, s.name
          from public.strategies s
         where s.owner_id = p.id and s.status in ('approved', 'featured')
         order by s.times_used desc, s.name
         limit 1
      ) ts on true
      left join lateral (
        select jsonb_agg(
                 jsonb_build_object(
                   'code', b.code,
                   'name', coalesce(b.name_tr, b.name_en, b.code),
                   'tier', b.tier,
                 'iconPath', b.icon_path) order by ub.awarded_at desc
               ) as badges,
               count(*) as badge_count
          from public.user_badges ub
          join public.badge_definitions b on b.code = ub.code
         where ub.user_id = p.id
      ) bd on true
  ),
  metric_rows as (
    select u.*,
           (
             select count(*)::integer
               from public.overlay_sessions os
              where os.user_id = u.id and os.qualified and os.started_at >= v_start
           ) as sessions,
           (
             select coalesce(sum(os.steps_advanced), 0)::integer
               from public.overlay_sessions os
              where os.user_id = u.id and os.qualified and os.started_at >= v_start
           ) as steps,
           (
             select coalesce(sum(l.delta), 0)::integer
               from public.currency_ledger l
              where l.user_id = u.id and l.delta > 0 and l.created_at >= v_start
           ) as coins,
           (
             select count(*)::integer
               from public.strategies s
              where s.owner_id = u.id and s.status in ('approved', 'featured') and s.created_at >= v_start
           ) as publishes
      from users u
  ),
  scored as (
    select m.*,
           case v_metric
             when 'sessions' then m.sessions
             when 'steps' then m.steps
             when 'coins' then m.coins
             else m.publishes
           end as score
      from metric_rows m
  ),
  ranked as (
    select s.*, row_number() over (order by s.score desc, s.handle asc) as rank
      from scored s
     where s.score > 0
  ),
  prev_scores as (
    select u.id,
           case v_metric
             when 'sessions' then (
               select count(*)::integer from public.overlay_sessions os
                where os.user_id = u.id and os.qualified and os.started_at >= v_prev_start
             )
             when 'steps' then (
               select coalesce(sum(os.steps_advanced), 0)::integer from public.overlay_sessions os
                where os.user_id = u.id and os.qualified and os.started_at >= v_prev_start
             )
             when 'coins' then (
               select coalesce(sum(l.delta), 0)::integer from public.currency_ledger l
                where l.user_id = u.id and l.delta > 0 and l.created_at >= v_prev_start
             )
             else (
               select count(*)::integer from public.strategies s
                where s.owner_id = u.id and s.status in ('approved', 'featured') and s.created_at >= v_prev_start
             )
           end as score
      from users u
     where v_prev_start is not null
  ),
  prev_ranked as (
    select p.id, row_number() over (order by p.score desc, u.handle asc) as rank
      from prev_scores p
      join users u on u.id = p.id
     where p.score > 0
  ),
  shaped as (
    select r.rank, r.id, r.score,
           pr.rank as previous_rank,
           case when pr.rank is null then null else pr.rank - r.rank end as movement,
           jsonb_build_object(
             'entityId', r.id,
             'kind', 'player',
             'rank', r.rank,
             'previousRank', pr.rank,
             'movement', case when pr.rank is null then null else pr.rank - r.rank end,
             'score', r.score,
             'name', coalesce(r.display_name, r.handle),
             'playerId', r.id,
             'handle', r.handle,
             'displayName', r.display_name,
             'avatarPath', r.avatar_path,
             'frameKey', r.frame_key,
             'titleName', r.title_name,
             'titleNameEn', r.title_name_en,
             'titleKey', r.title_key,
             'vip', r.vip,
             'verified', r.verified,
             'corporate', r.corporate,
             'badges', coalesce(r.badges, '[]'::jsonb),
             'badgeCount', r.badge_count,
             'topStrategyId', r.top_strategy_id,
             'topStrategyName', r.top_strategy_name,
             'mapKey', null,
             'isEvent', false,
             'sessions', r.sessions,
             'steps', r.steps,
             'coins', r.coins,
             'publishes', r.publishes,
             'streak', r.streak,
             'activeDays', r.active_days,
             'bestRank', r.usage_rank_best
           ) as obj
      from ranked r
      left join prev_ranked pr on pr.id = r.id
  ),
  me_row as (
    select s.* from shaped s where s.id = v_uid order by s.rank limit 1
  ),
  total as (
    select count(*)::integer as n from shaped
  )
  select jsonb_build_object(
    'board', 'players',
    'metric', v_metric,
    'window', v_window,
    'previousWindow', v_prev_window,
    'bucket', app.leaderboard_bucket(v_window),
    'windowStart', case when v_window = 'all_time' then null else v_start end,
    'generatedAt', now(),
    'total', (select n from total),
    'rows', (
      select coalesce(jsonb_agg(obj order by rank), '[]'::jsonb)
        from (select * from shaped order by rank limit v_limit) r
    ),
    'me', (
      select obj || jsonb_build_object(
        'percentile', case
          when (select n from total) > 0
            then greatest(1, round((me_row.rank::numeric / (select n from total)) * 100))::integer
          else null
        end,
        'gapToNext', (select x.score - me_row.score from shaped x where x.rank = me_row.rank - 1)
      )
        from me_row
    ),
    'nearMe', (
      select coalesce(jsonb_agg(obj order by rank), '[]'::jsonb)
        from shaped
       where rank between (select rank from me_row) - 2 and (select rank from me_row) + 2
    ),
    'movers', jsonb_build_object(
      'climbers', (
        select coalesce(jsonb_agg(obj order by movement desc), '[]'::jsonb)
          from (select * from shaped where movement > 0 order by movement desc, rank limit 3) c
      ),
      'fallers', (
        select coalesce(jsonb_agg(obj order by movement asc), '[]'::jsonb)
          from (select * from shaped where movement < 0 order by movement asc, rank limit 3) f
      )
    )
  ) into v_result;

  return v_result;
end;
$$;

