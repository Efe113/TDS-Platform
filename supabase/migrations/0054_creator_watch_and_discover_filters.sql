-- 0.3.8 Faz E: follow the authors, and filter the shelf the way people actually search it.
--
-- Two gaps, one file, because both are about finding the next strategy to run:
--
--   1. There was no way to say "this person's runs work for me". The app tracks strategies, favours them
--      and watches them for new versions (0023), but the author behind a good run — the one worth
--      opening again next event — was a dead end: the credit line on the detail page goes nowhere.
--      `creator_watch` follows a person, and the feed answers the only question that matters about them:
--      "what did they publish since I last looked?".
--
--   2. Discover filters were limited to what `search_strategies` accepted: mode, map, difficulty, event,
--      tag. Player count, wave coverage and "is this actually used" are all columns of the same row, and
--      a four-person raid or a 21-40 wave run is how people choose. A client-side pass over the returned
--      page would have disagreed with the count, the paging and the facets, so the function grows the
--      predicates instead — the same drop-and-recreate 0037 and 0040 did for their new columns.
--
-- Safe to run twice. Depends on 0001 (profiles, strategies), 0023 (the watch vocabulary this copies),
-- 0024 (avatar_path) and 0040 (the search_strategies signature being replaced).

-- ------------------------------------------------------------ 1. following an author

create table if not exists public.creator_watch (
  user_id uuid not null references public.profiles (id) on delete cascade,
  creator_id uuid not null references public.profiles (id) on delete cascade,
  -- What the member had seen. `newSinceLastSeen` in the readers is the difference between this and the
  -- strategies on or after it, which is what makes "3 yeni" mean something after a week away.
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, creator_id),
  constraint creator_watch_not_self check (user_id <> creator_id)
);

alter table public.creator_watch enable row level security;

-- Reads answer through the definer functions below: the list is the caller's own, but the feed has to
-- join strategies and profiles, which a member cannot do freely against another person's profile rows.
do $$
begin
  execute 'revoke all on table public.creator_watch from public, anon, authenticated';
end;
$$;

-- ------------------------------------------------------------ 2. the member's side

create or replace function public.toggle_creator_watch(p_creator_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_creator_id = v_uid then
    raise exception 'FORBIDDEN_SELF: kendine bakıyorsun zaten';
  end if;
  if not exists (select 1 from public.profiles where id = p_creator_id) then
    raise exception 'NOT_FOUND';
  end if;

  delete from public.creator_watch
   where user_id = v_uid and creator_id = p_creator_id;
  if found then
    return jsonb_build_object('creatorId', p_creator_id, 'watching', false);
  end if;

  insert into public.creator_watch (user_id, creator_id) values (v_uid, p_creator_id);
  return jsonb_build_object('creatorId', p_creator_id, 'watching', true);
end;
$$;

create or replace function public.mark_creator_seen(p_creator_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.creator_watch
     set last_seen_at = now()
   where user_id = auth.uid() and creator_id = p_creator_id;
  return found;
end;
$$;

-- The shelf of followed authors: who they are, what they have published and what is new since the last
-- look. One row per author, newest follow first.
create or replace function public.creator_watch_list()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'creatorId', c.creator_id,
        'handle', p.handle,
        'displayName', p.display_name,
        'avatarPath', p.avatar_path,
        'verified', coalesce(p.is_verified, false) or coalesce(p.is_corporate, false),
        'strategies', (
          select count(*) from public.strategies s
           where s.owner_id = c.creator_id and s.status in ('approved', 'featured')
        ),
        'newSinceLastSeen', (
          select count(*) from public.strategies s
           where s.owner_id = c.creator_id
             and s.status in ('approved', 'featured')
             and s.created_at > c.last_seen_at
        ),
        'lastSeenAt', c.last_seen_at
      )
      order by c.created_at desc
    ),
    '[]'::jsonb
  )
    from public.creator_watch c
    join public.profiles p on p.id = c.creator_id
   where c.user_id = auth.uid();
$$;

-- Three per author, twelve in total: a feed that lists everything a followed crowd ever published is a
-- second Discover, not a nudge.
create or replace function public.creator_watch_feed(p_limit integer default 12)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with candidates as (
    select s.id,
           s.slug,
           s.name,
           s.map_key,
           s.difficulty,
           s.created_at,
           w.creator_id,
           w.last_seen_at,
           row_number() over (partition by w.creator_id order by s.created_at desc) as per_author,
           row_number() over (order by s.created_at desc) as seq
      from public.creator_watch w
      join public.strategies s on s.owner_id = w.creator_id
     where w.user_id = auth.uid()
       and s.status in ('approved', 'featured')
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'strategyId', f.id,
        'slug', f.slug,
        'name', f.name,
        'mapKey', f.map_key,
        'difficulty', f.difficulty,
        'createdAt', f.created_at,
        'creatorId', f.creator_id,
        'creator', coalesce(p.display_name, p.handle, '—'),
        'avatarPath', p.avatar_path,
        'fresh', f.created_at > f.last_seen_at
      )
      order by f.created_at desc
    ),
    '[]'::jsonb
  )
    from candidates f
    join public.profiles p on p.id = f.creator_id
   where f.per_author <= 3
     and f.seq <= greatest(least(coalesce(p_limit, 12), 30), 1);
$$;

-- ------------------------------------------------------------ 3. deeper discover filters

-- The return type is untouched, so only the argument list changes; the 0040 signature goes first so
-- PostgREST never has two overloads of the same name to choose between.
drop function if exists public.search_strategies(
  text, text, text, text, boolean, text, text, integer, integer, boolean, boolean, boolean
);

create or replace function public.search_strategies(
  p_query text default null,
  p_mode text default null,
  p_map text default null,
  p_difficulty text default null,
  p_event boolean default null,
  p_tag text default null,
  p_sort text default 'new',
  p_limit integer default 24,
  p_offset integer default 0,
  p_favorites_only boolean default false,
  p_watch_only boolean default false,
  p_verified_only boolean default false,
  p_player_count text default null,
  p_wave_from integer default null,
  p_wave_to integer default null,
  p_min_uses integer default null
)
returns table (
  id uuid,
  slug text,
  name text,
  subtitle text,
  difficulty text,
  game_mode text,
  player_count text,
  map_key text,
  is_event_strategy boolean,
  event_key text,
  wave_from integer,
  wave_to integer,
  times_used integer,
  rating_avg numeric,
  rating_count integer,
  credit_creator text,
  owner_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  is_pinned boolean,
  is_favorited boolean,
  is_watched boolean,
  trend_7d bigint,
  rows_total bigint,
  author_verified boolean,
  author_corporate boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with trend as (
    select strategy_id, coalesce(sum(uses), 0) as uses_7d
      from public.strategy_usage_daily
     where day > now()::date - 7
     group by strategy_id
  ),
  base as (
    select s.*,
      (s.boost_expires_at is not null and s.boost_expires_at > now()) as boosted_now,
      exists (
        select 1 from public.favorites f
        where f.strategy_id = s.id and f.user_id = auth.uid()
      ) as favorited,
      exists (
        select 1 from public.strategy_watch w
        where w.strategy_id = s.id and w.user_id = auth.uid()
      ) as watched,
      coalesce(tr.uses_7d, 0) as uses_7d,
      exists (
        select 1 from public.profiles pv
        where pv.id = s.owner_id and (pv.is_verified or pv.is_corporate)
      ) as author_verified,
      exists (
        select 1 from public.profiles pc
        where pc.id = s.owner_id and pc.is_corporate
      ) as author_corporate
      from public.strategies s
      left join trend tr on tr.strategy_id = s.id
      where s.status in ('approved', 'featured')
        and s.current_version_id is not null
        and (p_query is null or trim(p_query) = ''
             or s.name ilike '%' || trim(p_query) || '%'
             or coalesce(s.subtitle, '') ilike '%' || trim(p_query) || '%'
             or coalesce(s.description, '') ilike '%' || trim(p_query) || '%')
        and (p_mode is null or s.game_mode = p_mode)
        and (p_map is null or s.map_key = p_map)
        and (p_difficulty is null or s.difficulty = p_difficulty)
        and (p_event is null or s.is_event_strategy = p_event)
        and (p_tag is null or exists (
          select 1 from public.strategy_tags st where st.strategy_id = s.id and st.tag_key = p_tag))
        and (not p_favorites_only or exists (
          select 1 from public.favorites f2
          where f2.strategy_id = s.id and f2.user_id = auth.uid()))
        and (not p_watch_only or exists (
          select 1 from public.strategy_watch w2
          where w2.strategy_id = s.id and w2.user_id = auth.uid()))
        and (not p_verified_only or exists (
          select 1 from public.profiles pv2
          where pv2.id = s.owner_id and (pv2.is_verified or pv2.is_corporate)))
        -- The three new ones are plain column predicates: a strategy either covers the waves you asked
        -- for or it does not, and a row without a wave range cannot claim it does.
        and (p_player_count is null or s.player_count = p_player_count)
        and (p_wave_from is null or coalesce(s.wave_to, s.wave_from) >= p_wave_from)
        and (p_wave_to is null or coalesce(s.wave_from, s.wave_to) <= p_wave_to)
        and (p_min_uses is null or s.times_used >= p_min_uses)
  ),
  pinned as (
    select b.id, row_number() over (order by b.boost_expires_at desc) as rn
      from base b
      where b.boosted_now
  ),
  chosen as (
    select b.*, count(*) over () as total, coalesce(p.rn <= 3, false) as pin_first
      from base b
      left join pinned p on p.id = b.id
      order by coalesce(p.rn <= 3, false) desc nulls last,
        -- An organisation outranks a verified person, which outranks everyone else. Both sit under the
        -- same tick, so the order is the only place the difference is visible.
        b.author_corporate desc nulls last,
        b.author_verified desc nulls last,
        case when p_sort = 'used' then b.times_used end desc nulls last,
        case when p_sort = 'rating' then b.rating_avg end desc nulls last,
        case when p_sort = 'trending' then b.uses_7d end desc nulls last,
        case when p_sort = 'new' then b.created_at end desc nulls last,
        b.created_at desc
      limit greatest(least(p_limit, 60), 1)
      offset greatest(p_offset, 0)
  )
  select c.id, c.slug, c.name, c.subtitle, c.difficulty, c.game_mode, c.player_count,
         c.map_key, c.is_event_strategy, c.event_key, c.wave_from, c.wave_to,
         c.times_used, c.rating_avg, c.rating_count, c.credit_creator, c.owner_id,
         c.created_at, c.updated_at,
         c.pin_first,
         c.favorited,
         c.watched,
         c.uses_7d,
         c.total,
         c.author_verified,
         c.author_corporate
    from chosen c;
$$;

-- ------------------------------------------------------------ 4. privileges

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.toggle_creator_watch(uuid)',
    'public.mark_creator_seen(uuid)',
    'public.creator_watch_list()',
    'public.creator_watch_feed(integer)'
  ] loop
    if to_regprocedure(v_sig) is null then
      raise exception '0054 failed: % was not created', v_sig;
    end if;
    execute format('revoke execute on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;

  -- Search stays open: a visitor filtering Discover is looking at approved rows, not at anybody's account.
  if to_regprocedure('public.search_strategies(text, text, text, text, boolean, text, text, integer, integer, boolean, boolean, boolean, text, integer, integer, integer)') is null then
    raise exception '0054 failed: the deep filters did not reach search_strategies';
  end if;
  execute 'grant execute on function public.search_strategies(text, text, text, text, boolean, text, text, integer, integer, boolean, boolean, boolean, text, integer, integer, integer) to anon, authenticated';
end;
$$;

-- ------------------------------------------------------------ 5. prove it landed

do $$
declare
  v_rows jsonb;
  v_found integer;
begin
  if to_regclass('public.creator_watch') is null then
    raise exception '0054 failed: creator_watch is missing';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'creator_watch_not_self' and conrelid = 'public.creator_watch'::regclass
  ) then
    raise exception '0054 failed: a member can still follow themselves';
  end if;

  v_rows := public.creator_watch_list();
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception '0054 failed: creator_watch_list() must answer an array, got %', jsonb_typeof(v_rows);
  end if;

  v_rows := public.creator_watch_feed(5);
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception '0054 failed: creator_watch_feed() must answer an array';
  end if;

  -- The new predicates are wired, not merely accepted: a filter nobody can pass is the same as no filter.
  if pg_get_functiondef('public.search_strategies(text, text, text, text, boolean, text, text, integer, integer, boolean, boolean, boolean, text, integer, integer, integer)'::regprocedure)
     not like '%p_min_uses%' then
    raise exception '0054 failed: search_strategies lost p_min_uses';
  end if;

  select count(*) into v_found
    from public.search_strategies(
      p_query => null, p_mode => null, p_map => null, p_difficulty => null, p_event => null,
      p_tag => null, p_sort => 'new', p_limit => 1, p_offset => 0,
      p_favorites_only => false, p_watch_only => false, p_verified_only => false,
      p_player_count => null, p_wave_from => null, p_wave_to => null, p_min_uses => 999999
    );
  if v_found <> 0 then
    raise exception '0054 failed: p_min_uses accepted an impossible number of runs';
  end if;

  select count(*) into v_found
    from public.search_strategies(
      p_query => null, p_mode => null, p_map => null, p_difficulty => null, p_event => null,
      p_tag => null, p_sort => 'new', p_limit => 60, p_offset => 0,
      p_favorites_only => false, p_watch_only => false, p_verified_only => false,
      p_player_count => null, p_wave_from => null, p_wave_to => null, p_min_uses => null
    );
  if v_found > 60 then
    raise exception '0054 failed: the rewritten search stopped paging at % rows', v_found;
  end if;

  raise notice '0054 ok: yazar takibi ve derin keşif filtreleri (oyuncu sayısı, dalga aralığı, kullanımda) hazır.';
end;
$$;

select pg_notify('pgrst', 'reload schema');
