-- 0002: strategy domain, versions, import records and the moderation queue
-- Data contract: no enemy roster and no total-cost columns exist anywhere in this schema.

create table if not exists public.strategies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~* '^[a-z0-9][a-z0-9-]{2,79}$'),
  owner_id uuid references public.profiles (id) on delete set null,
  name text not null check (char_length(name) between 2 and 140),
  subtitle text check (subtitle is null or char_length(subtitle) <= 200),
  description text check (description is null or char_length(description) <= 4000),
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard', 'nightmare')),
  game_mode text not null default 'unknown',
  player_count text not null default 'unknown' check (player_count in ('solo', 'duo', 'trio', 'quad', 'unknown')),
  map_key text references public.maps (key),
  is_event_strategy boolean not null default false,
  event_key text references public.events (key),
  wave_from integer check (wave_from between 0 and 999),
  wave_to integer check (wave_to between 0 and 999),
  duration_min integer check (duration_min between 1 and 600),
  credit_url text,
  credit_creator text,
  credit_contributors text[] not null default '{}',
  is_author_own boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'imported', 'submitted', 'needs_changes', 'approved', 'rejected', 'archived', 'featured')),
  current_version_id uuid,
  times_used integer not null default 0,
  rating_avg numeric(3, 2),
  rating_count integer not null default 0,
  boost_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (event_key is null or is_event_strategy)
);

create index if not exists strategies_status_created_idx on public.strategies (status, created_at desc);
create index if not exists strategies_event_idx on public.strategies (event_key) where is_event_strategy;
create index if not exists strategies_owner_idx on public.strategies (owner_id, status);
create index if not exists strategies_search_idx on public.strategies using gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(subtitle, '')));

create table if not exists public.strategy_versions (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  version_no integer not null check (version_no > 0),
  content jsonb not null,
  changelog text,
  created_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  unique (strategy_id, version_no)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'strategies_current_version_fk'
  ) then
    alter table public.strategies
      add constraint strategies_current_version_fk
      foreign key (current_version_id) references public.strategy_versions (id) on delete set null deferrable initially deferred;
  end if;
end;
$$;

create table if not exists public.strategy_steps (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.strategy_versions (id) on delete cascade,
  step_no integer not null check (step_no > 0),
  wave_from integer,
  wave_to integer,
  phase text,
  action text not null check (
    action in ('place', 'upgrade', 'max', 'sell', 'change', 'use', 'skip', 'wait', 'note', 'raw')
  ),
  tower_key text references public.towers (key),
  level integer check (level is null or level between 1 and 9),
  count integer check (count is null or count between 1 and 99),
  spec jsonb not null default '{}'::jsonb,
  target_step_id uuid references public.strategy_steps (id) on delete set null,
  note text,
  raw_text text not null,
  unresolved boolean not null default false,
  unique (version_id, step_no)
);

create index if not exists strategy_steps_version_idx on public.strategy_steps (version_id, step_no);

create table if not exists public.strategy_inventory (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.strategy_versions (id) on delete cascade,
  tower_key text not null references public.towers (key),
  slot smallint not null check (slot >= 0 and slot < 5),
  alternatives text[] not null default '{}',
  notes text,
  unique (version_id, tower_key),
  unique (version_id, slot)
);

create or replace function app.assert_inventory_max_five()
returns trigger
language plpgsql
as $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.strategy_inventory where version_id = new.version_id;
  if v_count >= 5 then
    raise exception 'STRATEGY_INVENTORY_MAX_FIVE: a strategy may list at most 5 towers';
  end if;
  return new;
end;
$$;

drop trigger if exists strategy_inventory_max_five on public.strategy_inventory;
create trigger strategy_inventory_max_five
  before insert on public.strategy_inventory
  for each row execute function app.assert_inventory_max_five();

create table if not exists public.strategy_modifiers (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.strategy_versions (id) on delete cascade,
  mutator_key text references public.mutators (key),
  note text,
  matched_by text not null default 'none' check (matched_by in ('phash', 'manual', 'text', 'none')),
  confidence numeric(3, 2)
);

-- mutator_key stays nullable because imported icons often have no catalog match yet.
create unique index if not exists strategy_modifiers_unique_key
  on public.strategy_modifiers (version_id, mutator_key) where mutator_key is not null;

create table if not exists public.strategy_placements (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.strategy_steps (id) on delete cascade,
  tower_key text references public.towers (key),
  x numeric(6, 5) not null check (x >= 0 and x <= 1),
  y numeric(6, 5) not null check (y >= 0 and y <= 1),
  zone text,
  facing text,
  slot smallint check (slot >= 0 and slot < 5)
);

create table if not exists public.strategy_media (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.strategy_versions (id) on delete cascade,
  kind text not null check (kind in ('map', 'thumb', 'card', 'proof', 'modifier')),
  storage_path text not null,
  width integer,
  height integer,
  sha256 text,
  phash text,
  created_at timestamptz not null default now()
);

create index if not exists strategy_media_version_idx on public.strategy_media (version_id, kind);

create table if not exists public.strategy_requirements (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.strategy_versions (id) on delete cascade,
  kind text not null check (kind in ('skill-tree', 'timescale', 'group', 'consumable', 'tower-xp')),
  value text not null,
  detail text
);

create table if not exists public.strategy_wave_skip_rules (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.strategy_versions (id) on delete cascade,
  kind text not null check (kind in ('skip-until', 'conditional', 'never')),
  waves text,
  condition text,
  raw_text text
);

create table if not exists public.strategy_troubleshooting (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.strategy_versions (id) on delete cascade,
  waves text not null,
  reasons jsonb not null default '[]'::jsonb
);

create table if not exists public.strategy_proofs (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.strategy_versions (id) on delete cascade,
  label text not null default '',
  setup jsonb not null default '[]'::jsonb,
  best_time_sec integer,
  coins_per_hour text,
  xp_per_hour text
);

create table if not exists public.strategy_hof (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.strategy_versions (id) on delete cascade,
  comp text[] not null default '{}',
  best_time_sec integer,
  notes text
);

create table if not exists public.strategy_tags (
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  tag_key text not null references public.tags (key),
  primary key (strategy_id, tag_key)
);

create table if not exists public.strategy_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  strategy_id uuid references public.strategies (id) on delete cascade,
  ir jsonb not null,
  report jsonb not null default '{}'::jsonb,
  source_sha256 text,
  updated_at timestamptz not null default now()
);

create index if not exists strategy_drafts_user_idx on public.strategy_drafts (user_id, updated_at desc);

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('gdocs_link', 'file', 'paste')),
  source_url text,
  doc_id text,
  source_sha256 text,
  format text,
  status text not null default 'done' check (status in ('pending', 'done', 'failed')),
  error_code text,
  report jsonb not null default '{}'::jsonb,
  media jsonb not null default '[]'::jsonb,
  raw_storage_path text,
  created_strategy_id uuid references public.strategies (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.import_unmatched (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.import_jobs (id) on delete cascade,
  kind text not null check (kind in ('icon', 'tower', 'mutator', 'map', 'section')),
  sample jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists import_unmatched_open_idx on public.import_unmatched (kind, created_at desc);

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  entity text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS

alter table public.strategies enable row level security;
alter table public.strategy_versions enable row level security;
alter table public.strategy_steps enable row level security;
alter table public.strategy_inventory enable row level security;
alter table public.strategy_modifiers enable row level security;
alter table public.strategy_placements enable row level security;
alter table public.strategy_media enable row level security;
alter table public.strategy_requirements enable row level security;
alter table public.strategy_wave_skip_rules enable row level security;
alter table public.strategy_troubleshooting enable row level security;
alter table public.strategy_proofs enable row level security;
alter table public.strategy_hof enable row level security;
alter table public.strategy_tags enable row level security;
alter table public.strategy_drafts enable row level security;
alter table public.import_jobs enable row level security;
alter table public.import_unmatched enable row level security;
alter table public.admin_audit_log enable row level security;

create or replace function app.strategy_is_public(p_strategy_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.strategies s
    where s.id = p_strategy_id
      and s.status in ('approved', 'featured')
      and s.current_version_id is not null
  );
$$;

create or replace function app.strategy_is_owner(p_strategy_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.strategies s
    where s.id = p_strategy_id and s.owner_id = auth.uid()
  );
$$;

create or replace function app.version_visible(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.strategy_versions v
    where v.id = p_version_id and (app.strategy_is_public(v.strategy_id) or app.strategy_is_owner(v.strategy_id) or app.is_moderator())
  );
$$;

create or replace function app.placement_visible(p_step_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.strategy_steps s where s.id = p_step_id and app.version_visible(s.version_id)
  );
$$;

drop policy if exists strategies_public_read on public.strategies;
create policy strategies_public_read on public.strategies
  for select using (status in ('approved', 'featured') or owner_id = auth.uid() or app.is_moderator());

drop policy if exists strategies_owner_insert on public.strategies;
create policy strategies_owner_insert on public.strategies
  for insert
  with check (owner_id = auth.uid() and status in ('draft', 'imported'));

drop policy if exists strategies_owner_update on public.strategies;
create policy strategies_owner_update on public.strategies
  for update
  using (owner_id = auth.uid() and status in ('draft', 'imported', 'needs_changes'))
  with check (owner_id = auth.uid() and status in ('draft', 'imported', 'submitted'));

drop policy if exists strategies_admin_write on public.strategies;
create policy strategies_admin_write on public.strategies
  for all
  using (app.is_moderator())
  with check (app.is_moderator());

drop policy if exists versions_read on public.strategy_versions;
create policy versions_read on public.strategy_versions
  for select using (app.strategy_is_public(strategy_id) or app.strategy_is_owner(strategy_id) or app.is_moderator());

drop policy if exists versions_owner_write on public.strategy_versions;
create policy versions_owner_write on public.strategy_versions
  for insert with check (app.strategy_is_owner(strategy_id));

drop policy if exists versions_admin_write on public.strategy_versions;
create policy versions_admin_write on public.strategy_versions
  for all using (app.is_moderator()) with check (app.is_moderator());

-- Detail tables follow their version's visibility, and the parent strategy must be owned
-- and unmoderated for a client to write them.
drop policy if exists steps_read on public.strategy_steps;
create policy steps_read on public.strategy_steps
  for select using (
    exists (select 1 from public.strategy_versions v where v.id = version_id and (
      app.strategy_is_public(v.strategy_id) or app.strategy_is_owner(v.strategy_id) or app.is_moderator()
    ))
  );

drop policy if exists steps_write on public.strategy_steps;
create policy steps_write on public.strategy_steps
  for all using (
    exists (
      select 1 from public.strategy_versions v
      join public.strategies s on s.id = v.strategy_id
      where v.id = strategy_steps.version_id and s.owner_id = auth.uid() and s.status in ('draft', 'imported', 'needs_changes')
    )
  ) with check (
    exists (
      select 1 from public.strategy_versions v
      join public.strategies s on s.id = v.strategy_id
      where v.id = strategy_steps.version_id and s.owner_id = auth.uid() and s.status in ('draft', 'imported', 'needs_changes')
    )
  );

drop policy if exists child_read on public.strategy_inventory;
create policy child_read on public.strategy_inventory for select using (app.version_visible(version_id));
drop policy if exists child_read on public.strategy_modifiers;
create policy child_read on public.strategy_modifiers for select using (app.version_visible(version_id));
drop policy if exists child_read on public.strategy_placements;
create policy child_read on public.strategy_placements for select using (app.placement_visible(step_id));
drop policy if exists child_read on public.strategy_media;
create policy child_read on public.strategy_media for select using (app.version_visible(version_id));
drop policy if exists child_read on public.strategy_requirements;
create policy child_read on public.strategy_requirements for select using (app.version_visible(version_id));
drop policy if exists child_read on public.strategy_wave_skip_rules;
create policy child_read on public.strategy_wave_skip_rules for select using (app.version_visible(version_id));
drop policy if exists child_read on public.strategy_troubleshooting;
create policy child_read on public.strategy_troubleshooting for select using (app.version_visible(version_id));
drop policy if exists child_read on public.strategy_proofs;
create policy child_read on public.strategy_proofs for select using (app.version_visible(version_id));
drop policy if exists child_read on public.strategy_hof;
create policy child_read on public.strategy_hof for select using (app.version_visible(version_id));
drop policy if exists child_read on public.strategy_tags;
create policy child_read on public.strategy_tags for select using (app.strategy_is_public(strategy_id) or app.strategy_is_owner(strategy_id) or app.is_moderator());

drop policy if exists drafts_own on public.strategy_drafts;
create policy drafts_own on public.strategy_drafts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists jobs_own on public.import_jobs;
create policy jobs_own on public.import_jobs
  for insert with check (user_id = auth.uid() or user_id is null);
drop policy if exists jobs_read on public.import_jobs;
create policy jobs_read on public.import_jobs
  for select using (user_id = auth.uid() or app.is_moderator());

drop policy if exists unmatched_read on public.import_unmatched;
create policy unmatched_read on public.import_unmatched for select using (app.is_moderator());
drop policy if exists unmatched_write on public.import_unmatched;
create policy unmatched_write on public.import_unmatched for insert with check (true);

drop policy if exists audit_read on public.admin_audit_log;
create policy audit_read on public.admin_audit_log for select using (app.is_admin());

-- ---------------------------------------------------------------- publish and review

create or replace function public.publish_strategy(p_strategy_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_strategy public.strategies%rowtype;
  v_draft public.strategy_drafts%rowtype;
  v_version_no integer;
  v_version_id uuid;
begin
  select * into v_strategy from public.strategies where id = p_strategy_id;
  if not found or v_strategy.owner_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN: you can only publish your own strategy';
  end if;

  select * into v_draft from public.strategy_drafts
    where user_id = auth.uid() and strategy_id = p_strategy_id
    order by updated_at desc limit 1;
  if not found then
    raise exception 'NO_DRAFT: nothing to publish';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_version_no
    from public.strategy_versions where strategy_id = p_strategy_id;

  insert into public.strategy_versions (strategy_id, version_no, content, created_by)
    values (p_strategy_id, v_version_no, v_draft.ir, auth.uid())
    returning id into v_version_id;

  insert into public.strategy_steps
      (version_id, step_no, wave_from, wave_to, phase, action, tower_key, level, count, spec, note, raw_text, unresolved)
    select v_version_id,
           (t.elem ->> 'stepNo')::integer,
           nullif(t.elem ->> 'waveFrom', '')::integer,
           nullif(t.elem ->> 'waveTo', '')::integer,
           t.elem ->> 'phase',
           coalesce(t.elem ->> 'action', 'raw'),
           nullif(t.elem ->> 'towerKey', ''),
           nullif(t.elem ->> 'level', '')::integer,
           nullif(t.elem ->> 'count', '')::integer,
           jsonb_build_object(
             'alternatives', coalesce(t.elem -> 'alternatives', '[]'::jsonb),
             'spec', t.elem -> 'spec'
           ),
           t.elem ->> 'note',
           coalesce(t.elem ->> 'raw', ''),
           coalesce((t.elem ->> 'unresolved')::boolean, false)
    from jsonb_array_elements(v_draft.ir -> 'steps') with ordinality as t(elem, ord);

  insert into public.strategy_inventory (version_id, tower_key, slot, alternatives, notes)
    select v_version_id,
           t.elem ->> 'towerKey',
           (t.ord - 1)::smallint,
           coalesce(array(select jsonb_array_elements_text(coalesce(t.elem -> 'alternatives', '[]'::jsonb))), '{}'),
           t.elem ->> 'notes'
    from jsonb_array_elements(v_draft.ir -> 'inventory') with ordinality as t(elem, ord)
    where t.elem ->> 'towerKey' is not null;

  update public.strategies
    set status = 'submitted', updated_at = now(),
        name = coalesce(nullif(v_draft.ir -> 'meta' ->> 'name', ''), name),
        difficulty = coalesce(nullif(v_draft.ir -> 'meta' ->> 'difficulty', ''), difficulty),
        game_mode = coalesce(nullif(v_draft.ir -> 'meta' -> 'gameMode' ->> 'key', ''), game_mode),
        player_count = coalesce(nullif(v_draft.ir -> 'meta' ->> 'playerCount', ''), player_count),
        is_event_strategy = coalesce((v_draft.ir -> 'meta' -> 'event' ->> 'isEvent')::boolean, is_event_strategy),
        wave_from = coalesce(nullif(v_draft.ir -> 'meta' -> 'waveRange' ->> 0, '')::integer, wave_from),
        wave_to = coalesce(nullif(v_draft.ir -> 'meta' -> 'waveRange' ->> 1, '')::integer, wave_to)
    where id = p_strategy_id;

  return v_version_id;
end;
$$;

create or replace function public.admin_review_strategy(p_strategy_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.strategies%rowtype;
begin
  if not app.is_moderator() then
    raise exception 'FORBIDDEN: moderator role required';
  end if;
  if p_decision not in ('approve', 'needs_changes', 'reject', 'archive', 'feature') then
    raise exception 'BAD_DECISION';
  end if;

  select * into v_before from public.strategies where id = p_strategy_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  update public.strategies s
    set status = case p_decision
                   when 'approve' then 'approved'
                   when 'feature' then 'featured'
                   when 'needs_changes' then 'needs_changes'
                   when 'reject' then 'rejected'
                   else 'archived'
                 end,
        current_version_id = case
          when p_decision in ('approve', 'feature') then (
            select v.id from public.strategy_versions v
            where v.strategy_id = s.id order by v.version_no desc limit 1
          )
          else s.current_version_id
        end,
        updated_at = now()
    where s.id = p_strategy_id;

  insert into public.admin_audit_log (admin_id, action, entity, entity_id, before_data, after_data)
    values (auth.uid(), 'review:' || p_decision, 'strategies', p_strategy_id::text,
            to_jsonb(v_before),
            (select to_jsonb(s) from public.strategies s where s.id = p_strategy_id));
end;
$$;

grant execute on function public.publish_strategy(uuid) to authenticated;
grant execute on function public.admin_review_strategy(uuid, text, text) to authenticated;
