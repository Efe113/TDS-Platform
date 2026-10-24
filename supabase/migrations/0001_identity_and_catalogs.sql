-- 0001: identity, catalogs, legal and flags
-- Target: Supabase Postgres 15+. Requires the built-in `auth` schema and `anon`/`authenticated` roles.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists app;

-- ---------------------------------------------------------------- role helpers

create or replace function app.auth_role(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Roles live in app_metadata (only `admin_set_role` can write it), so a user can never
  -- escalate through their own profile row. Reading auth.users needs definer rights.
  select coalesce(
    (select u.raw_app_meta_data ->> 'role' from auth.users u where u.id = p_user_id),
    'user'
  );
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(app.auth_role(auth.uid()), 'user') = 'admin';
$$;

create or replace function app.is_moderator()
returns boolean
language sql
stable
as $$
  select app.auth_role(auth.uid()) in ('admin', 'moderator');
$$;

-- ---------------------------------------------------------------- identity

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique check (char_length(handle) between 3 and 32),
  display_name text,
  bio text check (bio is null or char_length(bio) <= 600),
  locale text not null default 'tr' check (locale in ('tr', 'en')),
  role text not null default 'user' check (role in ('user', 'moderator', 'admin')),
  currency_balance_cache integer not null default 0,
  xp integer not null default 0,
  theme_key text,
  is_banned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function app.mirror_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.role := app.auth_role(new.id);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_mirror_role on public.profiles;
create trigger profiles_mirror_role
  before insert or update of role on public.profiles
  for each row execute function app.mirror_role();

create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  overlay jsonb not null default '{}'::jsonb,
  hotkeys jsonb not null default '{}'::jsonb,
  telemetry_opt_in boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('tos', 'privacy', 'telemetry')),
  policy_version text not null,
  accepted_at timestamptz not null default now(),
  client_version text,
  locale text,
  unique (user_id, kind, policy_version)
);

create table if not exists public.device_installs (
  install_id uuid primary key,
  user_id uuid references public.profiles (id) on delete set null,
  app_version text not null,
  os_build text,
  hook_backend text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.legal_documents (
  kind text not null check (kind in ('about', 'privacy', 'terms')),
  version text not null,
  body_md text not null,
  effective_at timestamptz not null default now(),
  primary key (kind, version)
);

create table if not exists public.app_flags (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- catalogs

create table if not exists public.maps (
  key text primary key,
  name_en text not null,
  name_tr text not null,
  image_path text,
  image_width integer,
  image_height integer,
  play_bounds jsonb,
  grid_size integer,
  is_event boolean not null default false,
  icon_phash text[] not null default '{}'
);

create table if not exists public.towers (
  key text primary key,
  name_en text not null,
  name_tr text not null,
  alias jsonb not null default '[]'::jsonb,
  icon_path text,
  category text,
  rarity text,
  icon_phash text[] not null default '{}'
);

create table if not exists public.mutators (
  key text primary key,
  name_en text not null,
  name_tr text not null,
  alias jsonb not null default '[]'::jsonb,
  grp text,
  icon_path text,
  icon_phash text[] not null default '{}'
);

create table if not exists public.events (
  key text primary key,
  name_tr text not null,
  name_en text,
  starts_at timestamptz,
  ends_at timestamptz
);

create table if not exists public.classes (
  key text primary key,
  name_en text not null,
  name_tr text not null,
  icon_path text
);

create table if not exists public.tags (
  key text primary key,
  kind text not null check (kind in ('mode', 'map', 'style', 'difficulty', 'event', 'grind')),
  name_tr text not null,
  name_en text not null
);

-- ---------------------------------------------------------------- row level security

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.app_consents enable row level security;
alter table public.device_installs enable row level security;
alter table public.legal_documents enable row level security;
alter table public.app_flags enable row level security;
alter table public.maps enable row level security;
alter table public.towers enable row level security;
alter table public.mutators enable row level security;
alter table public.events enable row level security;
alter table public.classes enable row level security;
alter table public.tags enable row level security;

create or replace function app.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Wallet counters are written only by the ledger RPCs; RLS cannot compare OLD vs NEW,
  -- so a trigger pins the server-owned columns for every non-admin update.
  if not app.is_admin() then
    new.currency_balance_cache := old.currency_balance_cache;
    new.xp := old.xp;
    new.role := old.role;
    new.is_banned := old.is_banned;
  end if;
  new.role := app.auth_role(new.id);
  return new;
end;
$$;

drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function app.guard_profile_columns();

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);

drop policy if exists profiles_write_own on public.profiles;
create policy profiles_write_own on public.profiles
  for update
  using (id = auth.uid() and is_banned = false)
  with check (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (id = auth.uid() and role = 'user');

drop policy if exists user_settings_own on public.user_settings;
create policy user_settings_own on public.user_settings
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists consents_insert_own on public.app_consents;
create policy consents_insert_own on public.app_consents
  for insert with check (user_id = auth.uid());

drop policy if exists consents_read_own on public.app_consents;
create policy consents_read_own on public.app_consents
  for select using (user_id = auth.uid() or app.is_admin());

drop policy if exists installs_write on public.device_installs;
create policy installs_write on public.device_installs
  for insert with check (true);

drop policy if exists installs_read_admin on public.device_installs;
create policy installs_read_admin on public.device_installs
  for select using (app.is_admin());

drop policy if exists legal_read on public.legal_documents;
create policy legal_read on public.legal_documents for select using (true);

drop policy if exists flags_read on public.app_flags;
create policy flags_read on public.app_flags for select using (true);

drop policy if exists catalogs_read on public.maps;
create policy catalogs_read on public.maps for select using (true);
drop policy if exists catalogs_read on public.towers;
create policy catalogs_read on public.towers for select using (true);
drop policy if exists catalogs_read on public.mutators;
create policy catalogs_read on public.mutators for select using (true);
drop policy if exists catalogs_read on public.events;
create policy catalogs_read on public.events for select using (true);
drop policy if exists catalogs_read on public.classes;
create policy catalogs_read on public.classes for select using (true);
drop policy if exists catalogs_read on public.tags;
create policy catalogs_read on public.tags for select using (true);

drop policy if exists catalogs_admin_write on public.maps;
create policy catalogs_admin_write on public.maps for all using (app.is_admin()) with check (app.is_admin());
drop policy if exists catalogs_admin_write on public.towers;
create policy catalogs_admin_write on public.towers for all using (app.is_admin()) with check (app.is_admin());
drop policy if exists catalogs_admin_write on public.mutators;
create policy catalogs_admin_write on public.mutators for all using (app.is_admin()) with check (app.is_admin());
drop policy if exists catalogs_admin_write on public.events;
create policy catalogs_admin_write on public.events for all using (app.is_admin()) with check (app.is_admin());
drop policy if exists catalogs_admin_write on public.classes;
create policy catalogs_admin_write on public.classes for all using (app.is_admin()) with check (app.is_admin());
drop policy if exists catalogs_admin_write on public.tags;
create policy catalogs_admin_write on public.tags for all using (app.is_admin()) with check (app.is_admin());

-- Functions are callable by PUBLIC by default in Postgres; trigger functions must stay
-- executable or profile/role triggers fail for every signup. We grant, never revoke.
grant execute on function app.is_admin() to anon, authenticated;
grant execute on function app.is_moderator() to anon, authenticated;
grant execute on function app.auth_role(uuid) to anon, authenticated;
grant usage on schema app to anon, authenticated;
