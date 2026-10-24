-- 0024: the profile becomes a real identity surface - avatar, banner (coin-unlocked), editable name,
-- handle and bio, plus the profile's own theme for visitors.
--
-- Why the banner is a purchase and the avatar is not: an avatar is how you recognise someone in a
-- comment list, so paywalling it would break the discussion; a banner is decoration on a page only
-- visitors see, which is exactly the shape of a cosmetic. Ownership is derived from spend_orders
-- (the existing audited purchase path), never from a boolean the client could set.
--
-- Storage: the existing public `strategy-media` bucket grows two per-user prefixes. The policies below
-- only allow a signed-in user to write inside `avatars/<their id>/` and `banners/<their id>/`, so one
-- account cannot overwrite another's file even though the bucket is public-read.

-- ------------------------------------------------------------ 1. columns

alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists banner_path text;

-- ------------------------------------------------------------ 2. catalog row

insert into public.spend_catalog (sku, kind, price, ref_code, enabled)
values ('cosmetic_banner', 'cosmetic', 250, 'profile_banner', true)
on conflict (sku) do update set price = excluded.price, kind = excluded.kind, ref_code = excluded.ref_code;

-- ------------------------------------------------------------ 3. helpers

create or replace function app.banner_unlocked(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.spend_orders o
     where o.user_id = p_user and o.sku = 'cosmetic_banner' and o.status = 'filled'
  );
$$;

-- ------------------------------------------------------------ 4. reads

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
             'code', b.code,
             'name', coalesce(b.name_tr, b.name_en, b.code),
             'nameEn', coalesce(b.name_en, b.name_tr, b.code),
             'desc', b.desc_tr,
             'tier', b.tier,
             'awardedAt', ub.awarded_at,
             'publicSlot', pb.slot
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
    'isSelf', v_caller = p_user,
    'metrics', coalesce(v_metrics, '{}'::jsonb),
    'badges', v_badges,
    'showcase', v_showcase,
    'strategies', v_strategies
  );
end;
$$;

-- ------------------------------------------------------------ 5. writes

create or replace function public.update_profile(
  p_display_name text default null,
  p_handle text default null,
  p_bio text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_handle text := nullif(btrim(coalesce(p_handle, '')), '');
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_bio text := nullif(btrim(coalesce(p_bio, '')), '');
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if v_name is not null and char_length(v_name) > 32 then
    raise exception 'NAME_TOO_LONG';
  end if;
  if v_bio is not null and char_length(v_bio) > 600 then
    raise exception 'BIO_TOO_LONG';
  end if;
  if v_handle is not null then
    if char_length(v_handle) < 3 or char_length(v_handle) > 32 then
      raise exception 'HANDLE_INVALID';
    end if;
    if v_handle !~ '^[a-z0-9_.]+$' then
      raise exception 'HANDLE_INVALID';
    end if;
    if exists (select 1 from public.profiles p where p.handle = v_handle and p.id <> v_uid) then
      raise exception 'HANDLE_TAKEN';
    end if;
  end if;

  update public.profiles p
     set display_name = v_name,
         handle = coalesce(v_handle, p.handle),
         bio = v_bio,
         updated_at = now()
   where p.id = v_uid;

  return public.profile_showcase(v_uid);
end;
$$;

create or replace function public.set_profile_media(p_kind text, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
  v_prefix text;
  v_column text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_kind not in ('avatar', 'banner') then
    raise exception 'KIND_INVALID';
  end if;

  v_prefix := case when p_kind = 'avatar' then 'avatars' else 'banners' end;
  v_column := case when p_kind = 'avatar' then 'avatar_path' else 'banner_path' end;

  if v_path is not null then
    -- The file must live under this user's own prefix; anything else is a path traversal attempt.
    if v_path !~ ('^' || v_prefix || '/' || v_uid::text || '/[A-Za-z0-9._-]+$') then
      raise exception 'PATH_INVALID';
    end if;
    if p_kind = 'banner' and not app.banner_unlocked(v_uid) then
      raise exception 'BANNER_LOCKED';
    end if;
  end if;

  if v_column = 'avatar_path' then
    update public.profiles set avatar_path = v_path, updated_at = now() where id = v_uid;
  else
    update public.profiles set banner_path = v_path, updated_at = now() where id = v_uid;
  end if;

  return public.profile_showcase(v_uid);
end;
$$;

-- ------------------------------------------------------------ 6. storage policies

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'objects') then
    execute 'drop policy if exists tds_media_insert_own on storage.objects';
    execute 'drop policy if exists tds_media_update_own on storage.objects';
    execute 'drop policy if exists tds_media_delete_own on storage.objects';

    execute $p$
      create policy tds_media_insert_own on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'strategy-media'
          and (
            name like ('avatars/' || auth.uid()::text || '/%')
            or name like ('banners/' || auth.uid()::text || '/%')
          )
        )
    $p$;

    execute $p$
      create policy tds_media_update_own on storage.objects
        for update to authenticated
        using (
          bucket_id = 'strategy-media'
          and (
            name like ('avatars/' || auth.uid()::text || '/%')
            or name like ('banners/' || auth.uid()::text || '/%')
          )
        )
    $p$;

    execute $p$
      create policy tds_media_delete_own on storage.objects
        for delete to authenticated
        using (
          bucket_id = 'strategy-media'
          and (
            name like ('avatars/' || auth.uid()::text || '/%')
            or name like ('banners/' || auth.uid()::text || '/%')
          )
        )
    $p$;
  else
    raise notice '0024: storage schema not found, media policies skipped.';
  end if;
end;
$$;

-- ------------------------------------------------------------ 7. privileges

do $$
declare
  v_sig text;
  v_list text[] := array[
    'public.profile_showcase(uuid)',
    'public.update_profile(text, text, text)',
    'public.set_profile_media(text, text)',
    'app.banner_unlocked(uuid)'
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

  -- A profile is public; its showcase is what everyone reads.
  v_sig := 'public.profile_showcase(uuid)';
  if to_regprocedure(v_sig) is not null then
    execute format('grant execute on function %s to anon', v_sig);
  end if;
end;
$$;

do $$
begin
  raise notice '0024: profiles carry avatar/banner paths, banner unlock is derived from spend_orders.';
  raise notice '0024: enable the strategy-media bucket policies by running this file as the project owner.';
end;
$$;
