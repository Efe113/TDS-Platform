-- 0007: publish pipeline entry point + storage authoring rights
-- Slug uniqueness and owner binding must be server-side: a client-computed slug would race,
-- and owner_id must never be settable by the caller.

create or replace function app.unique_slug(p_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text;
  v_candidate text;
  v_attempts integer := 0;
begin
  v_base := lower(coalesce(p_name, ''));
  -- Transliterate before stripping, or "Şöhret" would lose letters instead of becoming "sohret".
  v_base := replace(v_base, 'ç', 'c');
  v_base := replace(v_base, 'Ç', 'c');
  v_base := replace(v_base, 'ğ', 'g');
  v_base := replace(v_base, 'Ğ', 'g');
  v_base := replace(v_base, 'ı', 'i');
  v_base := replace(v_base, 'İ', 'i');
  v_base := replace(v_base, 'ö', 'o');
  v_base := replace(v_base, 'Ö', 'o');
  v_base := replace(v_base, 'ş', 's');
  v_base := replace(v_base, 'Ş', 's');
  v_base := replace(v_base, 'ü', 'u');
  v_base := replace(v_base, 'Ü', 'u');
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  if length(v_base) < 3 then
    v_base := 'strategi';
  end if;
  v_base := substr(v_base, 1, 60);
  v_candidate := v_base;

  loop
    exit when not exists (select 1 from public.strategies where slug = v_candidate);
    v_attempts := v_attempts + 1;
    if v_attempts > 40 then
      v_candidate := v_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      exit;
    end if;
    v_candidate := v_base || '-' || floor(random() * 9000 + 1000)::text;
  end loop;

  return v_candidate;
end;
$$;

create or replace function public.create_strategy_from_draft(
  p_ir jsonb,
  p_source_sha256 text default null,
  p_source_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_meta jsonb := coalesce(p_ir -> 'meta', '{}'::jsonb);
  v_strategy uuid;
  v_inventory_count integer;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;
  if jsonb_array_length(coalesce(p_ir -> 'steps', '[]'::jsonb)) = 0 then
    raise exception 'NO_STEPS: a strategy needs at least one step';
  end if;

  v_inventory_count := jsonb_array_length(coalesce(p_ir -> 'inventory', '[]'::jsonb));
  if v_inventory_count = 0 then
    raise exception 'NO_INVENTORY: select at least one tower';
  end if;
  if v_inventory_count > 5 then
    raise exception 'TOO_MANY_TOWERS: at most 5 towers per strategy';
  end if;
  if coalesce(v_meta -> 'credit' ->> 'creator', '') = '' then
    raise exception 'NO_CREDIT: the source author is required';
  end if;

  insert into public.strategies (
      slug, owner_id, name, subtitle, description, difficulty, game_mode, player_count, map_key,
      is_event_strategy, event_key, wave_from, wave_to, duration_min,
      credit_url, credit_creator, credit_contributors, is_author_own, status
    )
    values (
      app.unique_slug(v_meta ->> 'name'),
      v_user,
      left(nullif(trim(coalesce(v_meta ->> 'name', '')), ''), 140),
      left(coalesce(v_meta ->> 'subtitle', ''), 200),
      left(coalesce(v_meta ->> 'description', ''), 4000),
      coalesce(nullif(v_meta ->> 'difficulty', ''), 'medium'),
      coalesce(nullif(v_meta -> 'gameMode' ->> 'key', ''), 'unknown'),
      coalesce(nullif(v_meta ->> 'playerCount', ''), 'unknown'),
      nullif(v_meta -> 'map' ->> 'key', ''),
      coalesce((v_meta -> 'event' ->> 'isEvent')::boolean, false),
      nullif(v_meta -> 'event' ->> 'eventKey', ''),
      nullif(v_meta -> 'waveRange' ->> 0, '')::integer,
      nullif(v_meta -> 'waveRange' ->> 1, '')::integer,
      nullif(v_meta ->> 'durationMinutes', '')::integer,
      coalesce(nullif(v_meta -> 'credit' ->> 'sourceUrl', ''), p_source_url),
      left(v_meta -> 'credit' ->> 'creator', 120),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_meta -> 'credit' -> 'contributors', '[]'::jsonb))), '{}'),
      coalesce((v_meta -> 'credit' ->> 'isAuthorOwn')::boolean, false),
      'imported'
    )
    returning id into v_strategy;

  insert into public.strategy_drafts (user_id, strategy_id, ir, report, source_sha256)
    values (v_user, v_strategy, p_ir, '{}'::jsonb, p_source_sha256);

  return v_strategy;
end;
$$;

-- Storage: the admin panel uploads catalog and strategy artwork with the anon key under RLS,
-- so the bucket needs explicit policies. Reads stay public; writes are admin-only.
insert into storage.buckets (id, name, public)
values ('strategy-media', 'strategy-media', true)
on conflict (id) do update set public = true;

drop policy if exists media_public_read on storage.objects;
create policy media_public_read on storage.objects
  for select using (bucket_id = 'strategy-media');

drop policy if exists media_admin_write on storage.objects;
create policy media_admin_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'strategy-media' and app.is_admin());

drop policy if exists media_admin_update on storage.objects;
create policy media_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'strategy-media' and app.is_admin())
  with check (bucket_id = 'strategy-media' and app.is_admin());

drop policy if exists media_admin_delete on storage.objects;
create policy media_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'strategy-media' and app.is_admin());

grant execute on function public.create_strategy_from_draft(jsonb, text, text) to authenticated;
