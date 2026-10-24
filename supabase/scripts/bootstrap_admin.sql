-- Run AFTER migrations 0001-0004, and AFTER you have signed up once in the app.
-- This is the bootstrap path for the very first admin: admin_set_role() itself requires
-- an admin, so the first promotion must be direct SQL in the dashboard.

-- 1) Promote by email (edit the email, then run).
update auth.users
  set raw_app_meta_data = jsonb_set(
    coalesce(raw_app_meta_data, '{}'::jsonb),
    '{role}',
    '"admin"'::jsonb
  )
  where email = 'SENIN-EPPOSTA@ornek.com';

update public.profiles
  set role = 'admin'
  where id = (select id from auth.users where email = 'SENIN-EPPOSTA@ornek.com');

-- 2) Verify. Expect exactly one row with role = admin.
select u.email, p.handle, p.role, u.raw_app_meta_data ->> 'role' as jwt_role
  from auth.users u
  join public.profiles p on p.id = u.id
  where p.role = 'admin';

-- 3) Optional: confirm the economy counters start clean.
select
  (select count(*) from public.strategies) as strategies,
  (select count(*) from public.currency_ledger) as ledger_rows,
  (select count(*) from public.towers) as towers,
  (select count(*) from public.badge_definitions) as badges;
