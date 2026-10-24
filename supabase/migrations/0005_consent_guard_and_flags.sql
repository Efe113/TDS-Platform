-- 0005: harden the consent RPC and seed the safety flags
-- Found by live probing: calling accept_consent while signed out raised a NOT NULL violation
-- (null user_id) instead of a clean error, and app_flags had no rows for the kill switch.

create or replace function public.accept_consent(p_kind text, p_policy_version text, p_client_version text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;
  if p_kind not in ('tos', 'privacy', 'telemetry') then
    raise exception 'BAD_CONSENT_KIND';
  end if;
  if p_policy_version is null or length(trim(p_policy_version)) = 0 then
    raise exception 'BAD_POLICY_VERSION';
  end if;

  insert into public.app_consents (user_id, kind, policy_version, client_version, locale)
    values (auth.uid(), p_kind, trim(p_policy_version), p_client_version, 'tr')
    on conflict (user_id, kind, policy_version) do nothing;
end;
$$;

-- Read-only for clients (RLS: app_flags select is public, writes are admin-only by policy).
insert into public.app_flags (key, value)
values
  ('hotkeys_enabled', 'true'::jsonb),
  ('overlay_enabled', 'true'::jsonb),
  ('updater_flags', '{"allowUpdate": true, "rolloutPercent": 100}'::jsonb),
  ('minimum_client_version', '"0.1.0"'::jsonb)
on conflict (key) do nothing;

-- The admin panel must be able to flip the kill switch without a service-role key in the client.
drop policy if exists flags_admin_write on public.app_flags;
create policy flags_admin_write on public.app_flags
  for all
  using (app.is_admin())
  with check (app.is_admin());
