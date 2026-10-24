-- 0030: a signed-in user without a profile row repairs itself.
--
-- The reset script deletes the profile (and cascades its data) while the JWT stays valid, so every
-- profile_showcase call answered 400 "NOT_FOUND: no such profile" until the next sign-in recreated it
-- through the signup trigger. This function is the same repair the trigger performs, exposed so the
-- app can run it once at boot.

create or replace function public.ensure_profile()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_handle text;
  v_suffix text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if exists (select 1 from public.profiles p where p.id = v_uid) then
    return jsonb_build_object('created', false, 'userId', v_uid);
  end if;

  select lower(coalesce(email, '')) into v_email from auth.users where id = v_uid;

  -- Handle rules are the same as the table's: 3..32 of [a-z0-9_.]. Email local parts contain dots and
  -- dashes rarely, so strip anything else and add a short suffix when the base is already taken.
  v_handle := regexp_replace(split_part(coalesce(v_email, ''), '@', 1), '[^a-z0-9_.]', '', 'g');
  if char_length(v_handle) < 3 then
    v_handle := 'player';
  end if;
  v_handle := left(v_handle, 24);
  v_suffix := substr(replace(v_uid::text, '-', ''), 1, 4);

  if exists (select 1 from public.profiles p where p.handle = v_handle) then
    v_handle := left(v_handle, 27) || '_' || v_suffix;
  end if;

  insert into public.profiles (id, handle, display_name)
  values (v_uid, v_handle, null)
  on conflict (id) do nothing;

  return jsonb_build_object('created', true, 'userId', v_uid, 'handle', v_handle);
end;
$$;

do $$
begin
  revoke execute on function public.ensure_profile() from public, anon;
  grant execute on function public.ensure_profile() to authenticated;
  raise notice '0030: ensure_profile repairs a missing profile row for the current session.';
end;
$$;
