-- 0026: the rest of the console - members, platform health, bulk review, flags, ledger and audit
-- search - plus two new product kinds (titles and avatar frames).
--
-- Design rule for this file: every number an operator needs must be one call. A dashboard made of six
-- client-side queries is a dashboard that disagrees with itself after a moderation action.
--
-- New product kinds:
--   * `title`  - a short label shown next to the display name (profiles.active_title).
--   * `frame`  - a ring around the avatar (profiles.frame_key).
-- Both are cosmetic, owned through spend_orders like every other non-theme item, and equipped by the
-- user. Nothing here grants power, so a purchase can never change gameplay.

-- ------------------------------------------------------------ 1. new kinds and columns

alter table public.spend_catalog drop constraint if exists spend_catalog_kind_check;
alter table public.spend_catalog add constraint spend_catalog_kind_check
  check (kind in ('badge', 'theme', 'boost', 'cosmetic', 'title', 'frame'));

alter table public.profiles add column if not exists active_title text;
alter table public.profiles add column if not exists frame_key text;

insert into public.spend_catalog (sku, kind, price, ref_code, enabled, sort_order, name_tr, name_en, desc_tr, desc_en, perks)
values
  ('title_founder', 'title', 900, 'founder', true, 410,
   'Kurucu', 'Founder',
   'Profilinde adının yanında görünen kalıcı unvan.',
   'A permanent title shown next to your name.',
   '["Ad yanında görünür","Kalıcı","Tüm profillerde"]'::jsonb),
  ('title_nightowl', 'title', 450, 'nightowl', true, 420,
   'Gece Kuşu', 'Night Owl',
   'Gece koşuları yapanlar için unvan.',
   'A title for the players who run at night.',
   '["Ad yanında görünür","Kalıcı","Tüm profillerde"]'::jsonb),
  ('frame_ember', 'frame', 320, 'ember', true, 510,
   'Kor çerçevesi', 'Ember frame',
   'Avatarının çevresinde sıcak bir halka.',
   'A warm ring around your avatar.',
   '["Avatar halkası","Tüm profillerde","Tema ile uyumlu"]'::jsonb),
  ('frame_void', 'frame', 480, 'void', true, 520,
   'Boşluk çerçevesi', 'Void frame',
   'Avatarının çevresinde derin, soğuk bir halka.',
   'A deep, cold ring around your avatar.',
   '["Avatar halkası","Tüm profillerde","Koyu temalarla uyumlu"]'::jsonb)
on conflict (sku) do update set
  kind = excluded.kind, price = excluded.price, ref_code = excluded.ref_code,
  enabled = excluded.enabled, sort_order = excluded.sort_order,
  name_tr = excluded.name_tr, name_en = excluded.name_en,
  desc_tr = excluded.desc_tr, desc_en = excluded.desc_en, perks = excluded.perks;

-- Equipping is ownership-checked exactly like themes: the client cannot write these columns directly.

create or replace function app.guard_cosmetic_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only the RPC below may touch these columns: it sets a transaction-local flag that the client
  -- cannot forge, because PostgREST only lets HTTP clients set request.* GUCs (same lesson as 0017).
  if coalesce(current_setting('app.cosmetic_write', true), '') <> 'on' then
    new.active_title := old.active_title;
    new.frame_key := old.frame_key;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_cosmetics on public.profiles;
create trigger profiles_guard_cosmetics
  before update on public.profiles
  for each row execute function app.guard_cosmetic_columns();

create or replace function public.equip_cosmetic(p_kind text, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
  v_sku text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_kind not in ('title', 'frame') then raise exception 'KIND_INVALID'; end if;

  if v_ref is not null then
    select c.sku into v_sku
      from public.spend_catalog c
     where c.kind = p_kind and c.ref_code = v_ref and c.enabled;
    if v_sku is null then raise exception 'NOT_FOUND'; end if;
    if not exists (
      select 1 from public.spend_orders o
       where o.user_id = v_uid and o.sku = v_sku and o.status = 'filled'
    ) then
      raise exception 'NOT_OWNED';
    end if;
  end if;

  perform set_config('app.cosmetic_write', 'on', true);
  if p_kind = 'title' then
    update public.profiles set active_title = v_ref, updated_at = now() where id = v_uid;
  else
    update public.profiles set frame_key = v_ref, updated_at = now() where id = v_uid;
  end if;
  perform set_config('app.cosmetic_write', 'off', true);

  return jsonb_build_object('kind', p_kind, 'ref', v_ref);
end;
$$;

-- ------------------------------------------------------------ 2. profile showcase exposes the cosmetics

create or replace function public.profile_showcase(p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_badges jsonb;
  v_showcase jsonb;
  v_metrics jsonb;
  v_strategies jsonb;
begin
  select * into v_profile from public.profiles p where p.id = p_user;
  if v_profile.id is null then
    raise exception 'NOT_FOUND: no such profile';
  end if;

  if v_caller = p_user or app.is_moderator() then
    v_metrics := app.refresh_user_rollup(p_user);
  else
    select to_jsonb(r) - 'user_id' - 'updated_at' into v_metrics
      from public.stat_user_rollup r where r.user_id = p_user;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
             'code', b.code, 'name', coalesce(b.name_tr, b.name_en, b.code),
             'nameEn', coalesce(b.name_en, b.name_tr, b.code), 'desc', b.desc_tr,
             'tier', b.tier, 'awardedAt', ub.awarded_at, 'publicSlot', pb.slot
           ) order by ub.awarded_at desc), '[]'::jsonb)
    into v_badges
    from public.user_badges ub
    join public.badge_definitions b on b.code = ub.code
    left join public.public_badges pb on pb.user_id = ub.user_id and pb.code = ub.code
    where ub.user_id = p_user;

  select coalesce(jsonb_agg(jsonb_build_object('code', pb.code, 'slot', pb.slot) order by pb.slot), '[]'::jsonb)
    into v_showcase
    from public.public_badges pb where pb.user_id = p_user;

  select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'slug', s.slug, 'name', s.name, 'timesUsed', s.times_used,
             'status', s.status, 'isEventStrategy', s.is_event_strategy) order by s.times_used desc, s.name), '[]'::jsonb)
    into v_strategies
    from (
      select s.id, s.slug, s.name, s.times_used, s.status, s.is_event_strategy
        from public.strategies s
        where s.owner_id = p_user and s.status in ('approved', 'featured')
        order by s.times_used desc, s.name
        limit 5
    ) s;

  return jsonb_build_object(
    'userId', p_user,
    'handle', v_profile.handle,
    'displayName', v_profile.display_name,
    'bio', v_profile.bio,
    'joinedAt', v_profile.created_at,
    'themeKey', v_profile.theme_key,
    'themeName', (select t.name_tr from public.profile_themes t where t.key = v_profile.theme_key),
    'themeAccent', (select t.css ->> 'accent' from public.profile_themes t where t.key = v_profile.theme_key),
    'avatarPath', v_profile.avatar_path,
    'bannerPath', v_profile.banner_path,
    'bannerUnlocked', app.banner_unlocked(p_user),
    'titleKey', v_profile.active_title,
    'titleName', (select c.name_tr from public.spend_catalog c where c.kind = 'title' and c.ref_code = v_profile.active_title),
    'frameKey', v_profile.frame_key,
    'isSelf', v_caller = p_user,
    'metrics', coalesce(v_metrics, '{}'::jsonb),
    'badges', v_badges,
    'showcase', v_showcase,
    'strategies', v_strategies
  );
end;
$$;

-- ------------------------------------------------------------ 3. console reads

create or replace function public.admin_health()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'queueDepth', (select count(*) from public.strategies s where s.status in ('submitted', 'needs_changes')),
    'openReports', (select count(*) from public.reports r where r.status = 'open'),
    'unmatchedLabels', (select count(*) from public.import_unmatched u where u.created_at > now() - interval '7 days'),
    'members', (select count(*) from public.profiles p),
    'bannedMembers', (select count(*) from public.profiles p where p.is_banned),
    'newMembers7d', (select count(*) from public.profiles p where p.created_at > now() - interval '7 days'),
    'sales24h', (select count(*) from public.spend_orders o where o.status = 'filled' and o.created_at > now() - interval '24 hours'),
    'revenue24h', (select coalesce(sum(o.price_paid), 0) from public.spend_orders o where o.status = 'filled' and o.created_at > now() - interval '24 hours'),
    'earned24h', (select coalesce(sum(l.delta), 0) from public.currency_ledger l where l.delta > 0 and l.created_at > now() - interval '24 hours'),
    'runs24h', (select count(*) from public.overlay_sessions s where s.started_at > now() - interval '24 hours'),
    'qualified7d', (select count(*) from public.overlay_sessions s where s.qualified and s.started_at > now() - interval '7 days'),
    'lastImportAt', (select max(j.created_at) from public.import_jobs j),
    'lastPublishedAt', (select max(v.published_at) from public.strategy_versions v),
    'activeFlags', (select coalesce(jsonb_agg(jsonb_build_object('key', f.key, 'value', f.value)), '[]'::jsonb)
                      from public.app_flags f)
  );
$$;

create or replace function public.admin_user_search(p_query text default null, p_limit integer default 25)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select p.id, p.handle, p.display_name, p.role, p.is_banned, p.created_at,
           p.currency_balance_cache as balance,
           (select count(*) from public.strategies s where s.owner_id = p.id and s.status in ('approved', 'featured')) as published,
           (select count(*) from public.overlay_sessions o where o.user_id = p.id) as runs
      from public.profiles p
     where (p_query is null or trim(p_query) = ''
            or p.handle ilike '%' || trim(p_query) || '%'
            or coalesce(p.display_name, '') ilike '%' || trim(p_query) || '%')
     order by p.created_at desc
     limit greatest(least(p_limit, 100), 1)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', b.id, 'handle', b.handle, 'displayName', b.display_name,
           'role', b.role, 'banned', b.is_banned, 'joinedAt', b.created_at,
           'balance', b.balance, 'published', b.published, 'runs', b.runs
         ) order by b.created_at desc), '[]'::jsonb)
    from base b;
$$;

create or replace function public.admin_set_user_ban(p_user uuid, p_banned boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user = v_uid then raise exception 'SELF_FORBIDDEN'; end if;
  update public.profiles set is_banned = coalesce(p_banned, false), updated_at = now() where id = p_user;
  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
  values (v_uid, case when p_banned then 'ban_member' else 'unban_member' end, 'profile', p_user,
          jsonb_build_object('banned', coalesce(p_banned, false)));
  return jsonb_build_object('userId', p_user, 'banned', coalesce(p_banned, false));
end;
$$;

create or replace function public.admin_set_user_role(p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_role not in ('user', 'moderator', 'admin') then raise exception 'ROLE_INVALID'; end if;
  if p_user = v_uid then raise exception 'SELF_FORBIDDEN'; end if;
  update public.profiles set role = p_role, updated_at = now() where id = p_user;
  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
  values (v_uid, 'set_role', 'profile', p_user, jsonb_build_object('role', p_role));
  return jsonb_build_object('userId', p_user, 'role', p_role);
end;
$$;

create or replace function public.admin_ledger_search(p_query text default null, p_kind text default null, p_limit integer default 40)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'handle', p.handle, 'userId', l.user_id, 'delta', l.delta,
           'kind', l.kind, 'ruleCode', l.rule_code, 'refType', l.ref_type, 'at', l.created_at
         ) order by l.id desc), '[]'::jsonb)
    from (
      select l.*
        from public.currency_ledger l
        join public.profiles p on p.id = l.user_id
       where (p_kind is null or p_kind = '' or l.kind = p_kind)
         and (p_query is null or trim(p_query) = ''
              or p.handle ilike '%' || trim(p_query) || '%'
              or coalesce(l.rule_code, '') ilike '%' || trim(p_query) || '%')
       order by l.id desc
       limit greatest(least(p_limit, 200), 1)
    ) l
    join public.profiles p on p.id = l.user_id;
$$;

create or replace function public.admin_set_flag(p_key text, p_enabled boolean, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not app.is_admin() then raise exception 'FORBIDDEN'; end if;
  update public.app_flags
     set value = jsonb_build_object('enabled', coalesce(p_enabled, true), 'note', nullif(btrim(coalesce(p_note, '')), '')),
         updated_at = now()
   where key = p_key;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
  values (v_uid, 'set_flag', 'app_flag', null, jsonb_build_object('key', p_key, 'enabled', p_enabled));
  return true;
end;
$$;

create or replace function public.admin_queue_bulk(p_ids uuid[], p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_done integer := 0;
begin
  if not app.is_moderator() then raise exception 'FORBIDDEN'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'DECISION_INVALID'; end if;
  foreach v_id in array coalesce(p_ids, array[]::uuid[]) loop
    perform public.admin_review_strategy(v_id, p_decision, p_note);
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('processed', v_done, 'decision', p_decision);
end;
$$;

create or replace function public.admin_audit_search(p_query text default null, p_action text default null, p_limit integer default 60)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'action', a.action, 'entity', a.entity, 'entityId', a.entity_id,
           'adminHandle', p.handle, 'at', a.created_at,
           'before', a.before_data, 'after', a.after_data
         ) order by a.id desc), '[]'::jsonb)
    from (
      select a.*
        from public.admin_audit_log a
       where (p_action is null or p_action = '' or a.action = p_action)
         and (p_query is null or trim(p_query) = ''
              or coalesce(a.entity, '') ilike '%' || trim(p_query) || '%'
              or coalesce(a.action, '') ilike '%' || trim(p_query) || '%')
       order by a.id desc
       limit greatest(least(p_limit, 200), 1)
    ) a
    left join public.profiles p on p.id = a.admin_id;
$$;

-- ------------------------------------------------------------ 4. privileges

do $$
declare
  v_sig text;
  v_list text[] := array[
    'public.equip_cosmetic(text, text)',
    'public.admin_health()',
    'public.admin_user_search(text, integer)',
    'public.admin_set_user_ban(uuid, boolean)',
    'public.admin_set_user_role(uuid, text)',
    'public.admin_ledger_search(text, text, integer)',
    'public.admin_set_flag(text, boolean, text)',
    'public.admin_queue_bulk(uuid[], text, text)',
    'public.admin_audit_search(text, text, integer)'
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

do $$
begin
  raise notice '0026: titles and frames are purchasable, the console has health, members, ledger, flags, bulk review and audit search.';
end;
$$;
