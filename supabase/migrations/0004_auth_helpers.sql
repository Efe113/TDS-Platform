-- 0004: signup bootstrap, role administration and consent capture
-- Without app.handle_new_user() a signed-up auth user would have no profiles row, and every
-- owner-scoped policy would silently return nothing.

create or replace function app.generate_handle(p_email text, p_seed uuid)
returns text
language sql
stable
as $$
  select coalesce(
    nullif(
      lower(regexp_replace(split_part(coalesce(p_email, ''), '@', 1), '[^a-z0-9_-]', '', 'g')),
      ''
    ) || substr(replace(p_seed::text, '-', ''), 1, 4),
    'player' || substr(replace(p_seed::text, '-', ''), 1, 8)
  );
$$;

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_handle text := app.generate_handle(new.email, new.id);
  v_attempts integer := 0;
begin
  -- First signup wins the plain handle; collisions get a numeric suffix instead of failing.
  while exists (select 1 from public.profiles where handle = v_handle) loop
    v_attempts := v_attempts + 1;
    if v_attempts > 24 then
      v_handle := 'player' || substr(replace(new.id::text, '-', ''), 1, 10);
      exit;
    end if;
    v_handle := substr(v_handle, 1, 26) || floor(random() * 900 + 100)::text;
  end loop;

  insert into public.profiles (id, handle, display_name, locale)
    values (
      new.id,
      v_handle,
      coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)),
      coalesce(new.raw_user_meta_data ->> 'locale', 'tr')
    )
    on conflict (id) do nothing;

  insert into public.stat_user_rollup (user_id) values (new.id) on conflict do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN: only an admin can change roles';
  end if;
  if p_role not in ('user', 'moderator', 'admin') then
    raise exception 'BAD_ROLE';
  end if;

  update auth.users
    set raw_app_meta_data = jsonb_set(coalesce(raw_app_meta_data, '{}'::jsonb), '{role}', to_jsonb(p_role))
    where id = p_user;

  -- Mirror immediately so the client does not wait on the profiles trigger.
  update public.profiles set role = p_role where id = p_user;

  insert into public.admin_audit_log (admin_id, action, entity, entity_id, after_data)
    values (auth.uid(), 'set_role:' || p_role, 'profiles', p_user::text, jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.accept_consent(p_kind text, p_policy_version text, p_client_version text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_kind not in ('tos', 'privacy', 'telemetry') then
    raise exception 'BAD_CONSENT_KIND';
  end if;

  insert into public.app_consents (user_id, kind, policy_version, client_version, locale)
    values (auth.uid(), p_kind, p_policy_version, p_client_version, 'tr')
    on conflict (user_id, kind, policy_version) do nothing;
end;
$$;

create or replace function public.has_consented(p_kind text, p_policy_version text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_consents
    where user_id = auth.uid() and kind = p_kind and policy_version = p_policy_version
  );
$$;

grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.accept_consent(text, text, text) to authenticated;
grant execute on function public.has_consented(text, text) to authenticated;
