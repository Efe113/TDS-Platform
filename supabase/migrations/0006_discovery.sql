-- 0006: discovery (favorites + server-side search)
-- Discover must work while signed out, so search_strategies is executable by anon; it only ever
-- reads approved/featured rows joined to their live version.

create table if not exists public.favorites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, strategy_id)
);

create index if not exists favorites_strategy_idx on public.favorites (strategy_id);

alter table public.favorites enable row level security;

drop policy if exists favorites_own on public.favorites;
create policy favorites_own on public.favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists favorites_public_read on public.favorites;
create policy favorites_public_read on public.favorites
  for select using (app.strategy_is_public(strategy_id));

create or replace function public.toggle_favorite(p_strategy_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_found boolean;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;
  if not exists (
    select 1 from public.strategies s
    where s.id = p_strategy_id and s.status in ('approved', 'featured')
  ) then
    raise exception 'NOT_PUBLISHED';
  end if;

  delete from public.favorites where user_id = v_user and strategy_id = p_strategy_id;
  GET DIAGNOSTICS v_found = ROW_COUNT;

  if v_found then
    return false;
  end if;

  insert into public.favorites (user_id, strategy_id) values (v_user, p_strategy_id);
  return true;
end;
$$;

create or replace function public.search_strategies(
  p_query text default null,
  p_mode text default null,
  p_map text default null,
  p_difficulty text default null,
  p_event boolean default null,
  p_tag text default null,
  p_sort text default 'new',
  p_limit integer default 24,
  p_offset integer default 0
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
  is_favorited boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select s.*,
      (s.boost_expires_at is not null and s.boost_expires_at > now()) as boosted_now,
      exists (
        select 1 from public.favorites f
        where f.strategy_id = s.id and f.user_id = auth.uid()
      ) as favorited
      from public.strategies s
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
          select 1 from public.strategy_tags st where st.strategy_id = s.id and st.tag_key = p_tag
        ))
  ),
  pinned as (
    select b.id, row_number() over (order by b.boost_expires_at desc) as rn
      from base b
      where b.boosted_now
  )
  select b.id, b.slug, b.name, b.subtitle, b.difficulty, b.game_mode, b.player_count,
         b.map_key, b.is_event_strategy, b.event_key, b.wave_from, b.wave_to,
         b.times_used, b.rating_avg, b.rating_count, b.credit_creator, b.owner_id,
         b.created_at, b.updated_at,
         coalesce(p.rn <= 3, false) as is_pinned,
         b.favorited as is_favorited
    from base b
    left join pinned p on p.id = b.id
    order by coalesce(p.rn <= 3, false) desc nulls last,
      case when p_sort = 'used' then b.times_used end desc nulls last,
      case when p_sort = 'rating' then b.rating_avg end desc nulls last,
      b.created_at desc
    limit least(greatest(coalesce(p_limit, 24), 1), 60)
    offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.toggle_favorite(uuid) to authenticated;
grant execute on function public.search_strategies(text, text, text, text, boolean, text, text, integer, integer) to anon, authenticated;
