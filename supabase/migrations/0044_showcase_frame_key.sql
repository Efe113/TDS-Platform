-- 0044: profile_showcase ships `frameKey` again.
--
-- 0038 returned `frameKey`. 0040 re-declared this function to add the corporate fields and copied a
-- shape that had already lost it, and 0043 re-declared it again from 0040's text — so for every build
-- since 0040 the server has simply never sent the equipped frame.
--
-- The write side was fine all along: `equip_cosmetic` sets `profiles.frame_key` and the row does hold
-- the value (measured live: `frame_key = 'void'` while the payload had no `frameKey` key at all).
-- The client schema declares the field `optional().default(null)`, so the missing key degraded
-- silently: no ring on the avatar, no "equipped" mark on the frame row, and every click looked like a
-- failed equip. That is the whole of "çerçeve kuşanmıyor".
--
-- This file is the canonical `profile_showcase` from now on: 0043's body plus the frame field, and
-- nothing else changes. Safe to run twice. Depends on 0043.

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
  v_vip boolean := app.vip_active(p_user);
  v_verified boolean := app.verified_active(p_user);
  v_corporate boolean := app.corporate_active(p_user);
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
             'iconPath', b.icon_path, 'awardedBy', ub.awarded_by,
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
    'pronouns', v_profile.pronouns,
    'joinedAt', v_profile.created_at,
    'themeKey', v_profile.theme_key,
    'themeName', (select t.name_tr from public.profile_themes t where t.key = v_profile.theme_key),
    'themeAccent', (select t.css ->> 'accent' from public.profile_themes t where t.key = v_profile.theme_key),
    'avatarPath', v_profile.avatar_path,
    'bannerPath', v_profile.banner_path,
    'bannerUnlocked', app.banner_unlocked(p_user),
    -- The frame lives on the profile row, not in a receipt: whatever equip_cosmetic wrote is what
    -- every surface must paint. 0040 lost this line and the frame became invisible.
    'frameKey', v_profile.frame_key,
    'vip', v_vip,
    'verified', v_verified,
    'corporate', v_corporate,
    'verifiedBoostCredits', case when v_caller = p_user or app.is_admin()
                                 then app.verified_boost_credits(p_user) + app.corporate_boost_credits(p_user)
                                 else null end,
    'customBackgroundPath', case when app.brand_background_unlocked(p_user)
                                 then v_profile.custom_background_path else null end,
    'profileTheme', v_profile.profile_theme_key,
    'profileThemeName', (select c.name_tr from public.spend_catalog c where c.kind = 'cosmetic' and c.ref_code = v_profile.profile_theme_key),
    'profileThemeNameEn', (select c.name_en from public.spend_catalog c where c.kind = 'cosmetic' and c.ref_code = v_profile.profile_theme_key),
    'titleKey', v_profile.active_title,
    'titleName', (select c.name_tr from public.spend_catalog c where c.kind = 'title' and c.ref_code = v_profile.active_title),
    'titleNameEn', (select c.name_en from public.spend_catalog c where c.kind = 'title' and c.ref_code = v_profile.active_title),
    'isSelf', v_caller = p_user,
    'metrics', coalesce(v_metrics, '{}'::jsonb),
    'badges', v_badges,
    'showcase', v_showcase,
    'strategies', v_strategies
  );
end;
$$;

-- Public profiles are read by signed-out visitors and by the hover card, so the read path stays open.
do $$
begin
  if to_regprocedure('public.profile_showcase(uuid)') is not null then
    execute 'grant execute on function public.profile_showcase(uuid) to anon, authenticated';
  end if;
end;
$$;

-- Prove the fix in the file itself: the dashboard prints this, so an accidental re-run of an older
-- file after it cannot pass unnoticed.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'profile_showcase'
   limit 1;
  if v_def is null or v_def not like '%frameKey%' then
    raise exception '0044 failed: profile_showcase still does not emit frameKey';
  end if;
  raise notice '0044 ok: profile_showcase emits frameKey';
end;
$$;

select pg_notify('pgrst', 'reload schema');
