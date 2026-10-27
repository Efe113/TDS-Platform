-- 0.3.6 Faz E: announcements — what the app tells the member before they ask.
--
-- The platform had one voice: maintenance (0046). It fires only when something is broken, it can only
-- say "writing is frozen", and it owns the one band position the shell has. Everything else — a
-- balance repair, a new moderation rule, a moderation delay, the fact that an event opens on Friday —
-- had nowhere to live, so it lived in nobody.
--
-- This file adds that voice and keeps it separate from campaigns. A campaign changes what the ledger
-- pays; a notice changes what the member knows. Merging them would mean a "bilgi" note could carry an
-- earning rule, and an operator typing prose into a money table is how accidental economics happen.
--
--   * severity  — info | warn | critical. The band colours itself by it, and `critical` is the one
--                 level that may require an explicit "Anladım" instead of a corner cross.
--   * surface   — banner (short line + type, opens on click) or modal (image + long body). Exactly the
--                 two choices the shell already renders, so the operator is picking an attention budget,
--                 not a layout.
--   * window    — starts_at / ends_at, same shape as campaigns. A notice past its end stops showing by
--                 itself; no cron, no cleanup task.
--   * reads     — announcement_reads holds one row per member per notice: 'read' (they saw the detail)
--                 or 'dismissed' (they closed the band). That is what makes "kapat" mean something after
--                 a reinstall, and it is why the reader answers `dismissed` per caller instead of the
--                 client keeping a private list.
--
-- Priority is decided in the shell, not here: maintenance, then the newest critical notice, then warn,
-- then info, then a campaign band. Only one modal may be open at a time for the same reason a console
-- has one prompt.
--
-- Safe to run twice. Depends on 0001 (app_flags, the storage bucket era), 0046 (the band position and
-- its house style), 0051 (the window vocabulary this file copies on purpose).

-- ------------------------------------------------------------ 1. the table and the read ledger

create table if not exists public.announcements (
  key text primary key,
  severity text not null check (severity in ('info', 'warn', 'critical')),
  surface text not null check (surface in ('banner', 'modal')),
  title_tr text not null check (length(trim(title_tr)) > 0),
  title_en text not null check (length(trim(title_en)) > 0),
  -- The band's line: short by construction, because a band that needs two sentences is a modal.
  short_tr text not null check (length(trim(short_tr)) > 0),
  short_en text not null check (length(trim(short_en)) > 0),
  -- The modal's story. Nullable so a banner notice does not have to be double-entered.
  body_tr text,
  body_en text,
  image_path text,
  action_label_tr text,
  action_label_en text,
  action_url text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- A critical notice that must be acknowledged: the modal offers "Anladım" and no corner cross, so an
  -- operator can be sure the member actually saw the thing rather than clicked past it.
  ack_required boolean not null default false,
  enabled boolean not null default true,
  created_by text not null default coalesce(auth.uid()::text, 'system'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_window_check check (ends_at > starts_at),
  constraint announcements_action_check check (action_url is null or action_url ~ '^(https://|tdsapp://)')
);

create table if not exists public.announcement_reads (
  announcement_key text not null references public.announcements (key) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  state text not null check (state in ('read', 'dismissed')),
  updated_at timestamptz not null default now(),
  primary key (announcement_key, user_id)
);

alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;

-- Members never read these tables directly: `active_announcements()` answers with the caller's own read
-- state folded in, which is a question only a definer function can answer without opening the ledger to
-- everyone.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['announcements', 'announcement_reads'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
  end loop;
end;
$$;

-- updated_at is the dismissal stamp: an edited notice is a different notice, and the client compares
-- this value against what it dismissed.
create or replace function app.touch_announcements()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists announcements_touch on public.announcements;
create trigger announcements_touch before update on public.announcements
  for each row execute function app.touch_announcements();

-- ------------------------------------------------------------ 2. the state, in one place

create or replace function app.announcement_state(p_key text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when a.key is null then 'off'
    when not a.enabled then 'off'
    when a.starts_at > now() then 'upcoming'
    when a.ends_at <= now() then 'ended'
    else 'live'
  end
  from public.announcements a
  where a.key = p_key;
$$;

-- ------------------------------------------------------------ 3. the reader the shell polls

create or replace function public.active_announcements()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', a.key,
        'severity', a.severity,
        'surface', a.surface,
        'titleTr', a.title_tr,
        'titleEn', a.title_en,
        'shortTr', a.short_tr,
        'shortEn', a.short_en,
        'bodyTr', a.body_tr,
        'bodyEn', a.body_en,
        'imagePath', a.image_path,
        'actionLabelTr', a.action_label_tr,
        'actionLabelEn', a.action_label_en,
        'actionUrl', a.action_url,
        'startsAt', a.starts_at,
        'endsAt', a.ends_at,
        'updatedAt', a.updated_at,
        'ackRequired', a.ack_required,
        'state', case when a.starts_at > now() then 'upcoming' else 'live' end,
        'dismissed', exists (
          select 1 from public.announcement_reads r
           where r.announcement_key = a.key
             and r.user_id = coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
             and r.state = 'dismissed'
        ),
        'readAt', (
          select r.updated_at from public.announcement_reads r
           where r.announcement_key = a.key
             and r.user_id = coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
             and r.state = 'read'
           limit 1
        )
      )
      -- Newest weight first: a critical notice is the one the shell gets to show, and an edit
      -- outranks an older announcement of the same weight.
      order by case a.severity when 'critical' then 0 when 'warn' then 1 else 2 end,
               a.updated_at desc,
               a.key
    ),
    '[]'::jsonb
  )
  from public.announcements a
  where a.enabled
    and a.starts_at <= now() + interval '2 days'
    and a.ends_at > now();
$$;

-- ------------------------------------------------------------ 4. the member answers for themselves

create or replace function public.mark_announcement(p_key text, p_state text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    -- No account to attribute the click to. The client falls back to a local dismissal for this case,
    -- so an anonymous visitor is not forced to re-read the band on every poll.
    return jsonb_build_object('key', p_key, 'recorded', false);
  end if;

  if p_state not in ('read', 'dismissed') then
    raise exception 'INVALID_STATE: use read or dismissed';
  end if;

  if not exists (select 1 from public.announcements where key = p_key) then
    raise exception 'UNKNOWN_ANNOUNCEMENT: %', p_key;
  end if;

  insert into public.announcement_reads (announcement_key, user_id, state, updated_at)
  values (p_key, v_user, p_state, now())
  on conflict (announcement_key, user_id) do update set
    state = excluded.state,
    updated_at = now();

  return jsonb_build_object('key', p_key, 'state', p_state, 'recorded', true);
end;
$$;

-- ------------------------------------------------------------ 5. the operator's arms

create or replace function public.admin_list_announcements()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_out jsonb;
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN: admin only';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', a.key,
        'severity', a.severity,
        'surface', a.surface,
        'titleTr', a.title_tr,
        'titleEn', a.title_en,
        'shortTr', a.short_tr,
        'shortEn', a.short_en,
        'bodyTr', a.body_tr,
        'bodyEn', a.body_en,
        'imagePath', a.image_path,
        'actionLabelTr', a.action_label_tr,
        'actionLabelEn', a.action_label_en,
        'actionUrl', a.action_url,
        'startsAt', a.starts_at,
        'endsAt', a.ends_at,
        'updatedAt', a.updated_at,
        'ackRequired', a.ack_required,
        'enabled', a.enabled,
        'state', app.announcement_state(a.key),
        'readCount', (select count(*) from public.announcement_reads r where r.announcement_key = a.key and r.state = 'read'),
        'dismissCount', (select count(*) from public.announcement_reads r where r.announcement_key = a.key and r.state = 'dismissed')
      )
      order by a.starts_at desc, a.key
    ),
    '[]'::jsonb
  )
  into v_out
  from public.announcements a;

  return v_out;
end;
$$;

create or replace function public.admin_upsert_announcement(
  p_key text,
  p_severity text,
  p_surface text,
  p_title_tr text,
  p_title_en text,
  p_short_tr text,
  p_short_en text,
  p_body_tr text default null,
  p_body_en text default null,
  p_image_path text default null,
  p_action_label_tr text default null,
  p_action_label_en text default null,
  p_action_url text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_ack_required boolean default false,
  p_enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN: admin only';
  end if;

  v_key := lower(btrim(coalesce(p_key, '')));
  if v_key !~ '^[a-z0-9][a-z0-9-]{1,47}$' then
    raise exception 'INVALID_KEY: use 2-48 characters of a-z, 0-9 and dash';
  end if;
  if p_severity not in ('info', 'warn', 'critical') then
    raise exception 'INVALID_SEVERITY: use info, warn or critical';
  end if;
  if p_surface not in ('banner', 'modal') then
    raise exception 'INVALID_SURFACE: use banner or modal';
  end if;
  if nullif(btrim(coalesce(p_title_tr, '')), '') is null or nullif(btrim(coalesce(p_title_en, '')), '') is null then
    raise exception 'INVALID_TITLE: both languages are required';
  end if;
  if nullif(btrim(coalesce(p_short_tr, '')), '') is null or nullif(btrim(coalesce(p_short_en, '')), '') is null then
    raise exception 'INVALID_SHORT: the band line is required in both languages';
  end if;
  -- A modal is the surface that carries the story; without one it is a band that interrupts.
  if p_surface = 'modal'
     and nullif(btrim(coalesce(p_body_tr, '')), '') is null
     and nullif(btrim(coalesce(p_body_en, '')), '') is null
     and nullif(coalesce(p_image_path, ''), '') is null then
    raise exception 'INVALID_MODAL: a modal needs a long text or an image; use the banner otherwise';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'INVALID_WINDOW: the notice must end after it starts';
  end if;
  if p_ends_at <= now() then
    raise exception 'INVALID_WINDOW: this notice is already over — change the dates';
  end if;

  insert into public.announcements (
    key, severity, surface, title_tr, title_en, short_tr, short_en, body_tr, body_en,
    image_path, action_label_tr, action_label_en, action_url,
    starts_at, ends_at, ack_required, enabled, created_by
  )
  values (
    v_key, p_severity, p_surface, btrim(p_title_tr), btrim(p_title_en), btrim(p_short_tr), btrim(p_short_en),
    nullif(btrim(coalesce(p_body_tr, '')), ''), nullif(btrim(coalesce(p_body_en, '')), ''),
    nullif(btrim(coalesce(p_image_path, '')), ''),
    nullif(btrim(coalesce(p_action_label_tr, '')), ''), nullif(btrim(coalesce(p_action_label_en, '')), ''),
    nullif(btrim(coalesce(p_action_url, '')), ''),
    p_starts_at, p_ends_at, coalesce(p_ack_required, false), coalesce(p_enabled, true),
    coalesce(auth.uid()::text, 'system')
  )
  on conflict (key) do update set
    severity = excluded.severity,
    surface = excluded.surface,
    title_tr = excluded.title_tr,
    title_en = excluded.title_en,
    short_tr = excluded.short_tr,
    short_en = excluded.short_en,
    body_tr = excluded.body_tr,
    body_en = excluded.body_en,
    image_path = excluded.image_path,
    action_label_tr = excluded.action_label_tr,
    action_label_en = excluded.action_label_en,
    action_url = excluded.action_url,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    ack_required = excluded.ack_required,
    enabled = excluded.enabled;

  return jsonb_build_object('key', v_key, 'state', app.announcement_state(v_key));
end;
$$;

create or replace function public.admin_delete_announcement(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN: admin only';
  end if;

  delete from public.announcements where key = p_key;
  if not found then
    raise exception 'UNKNOWN_ANNOUNCEMENT: %', p_key;
  end if;

  return jsonb_build_object('key', p_key, 'deleted', true);
end;
$$;

-- ------------------------------------------------------------ 6. privileges

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.active_announcements()',
    'public.mark_announcement(text, text)'
  ] loop
    if to_regprocedure(v_sig) is not null then
      execute format('grant execute on function %s to authenticated', v_sig);
    end if;
  end loop;

  -- Visitors read notices too: the app shows them before sign-in, and a repair notice is exactly the
  -- kind of thing a member needs to decide to sign in.
  if to_regprocedure('public.active_announcements()') is not null then
    execute 'grant execute on function public.active_announcements() to anon';
  end if;

  foreach v_sig in array array[
    'public.admin_list_announcements()',
    'public.admin_upsert_announcement(text, text, text, text, text, text, text, text, text, text, text, text, text, timestamptz, timestamptz, boolean, boolean)',
    'public.admin_delete_announcement(text)'
  ] loop
    if to_regprocedure(v_sig) is not null then
      execute format('grant execute on function %s to authenticated', v_sig);
    else
      raise warning '0052: % was not created', v_sig;
    end if;
  end loop;

  -- The state helper answers from inside the server; a member never calls it over HTTP. The touch
  -- trigger is left with its default privileges: it fires while the editing user's own UPDATE runs,
  -- and a revoked EXECUTE on a trigger function is the kind of break that only shows up on first save.
  if to_regprocedure('app.announcement_state(text)') is not null then
    execute 'revoke execute on function app.announcement_state(text) from public, anon, authenticated';
  end if;
end;
$$;

-- ------------------------------------------------------------ 7. prove it landed

do $$
declare
  v_rows jsonb;
begin
  if to_regclass('public.announcements') is null or to_regclass('public.announcement_reads') is null then
    raise exception '0052 failed: the announcement tables are missing';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'announcements_window_check' and conrelid = 'public.announcements'::regclass
  ) then
    raise exception '0052 failed: a notice can still end before it starts';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'announcements_action_check' and conrelid = 'public.announcements'::regclass
  ) then
    raise exception '0052 failed: a notice link is still unrestricted';
  end if;

  -- The severity vocabulary is the one the band colours itself by, and nothing else.
  if not exists (
    select 1 from pg_constraint
     where conname = 'announcements_severity_check' and conrelid = 'public.announcements'::regclass
  ) then
    raise exception '0052 failed: severity is not restricted to info, warn and critical';
  end if;

  v_rows := public.active_announcements();
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception '0052 failed: active_announcements() must answer an array, got %', jsonb_typeof(v_rows);
  end if;

  if app.announcement_state('definitely-not-a-notice') is distinct from null then
    raise exception '0052 failed: an unknown notice should read as no state at all';
  end if;

  -- The reader ships the fields the shell cannot draw without: state, dismissal and the ack flag.
  if pg_get_functiondef('public.active_announcements()'::regprocedure) not like '%dismissed%' then
    raise exception '0052 failed: the reader lost the caller''s dismissal state';
  end if;
  if pg_get_functiondef('public.active_announcements()'::regprocedure) not like '%ackRequired%' then
    raise exception '0052 failed: the reader lost ack_required';
  end if;

  raise notice '0052 ok: duyuru sistemi hazır — bant ya da modal, bilgi/uyarı/kritik, kapatma hesapta tutuluyor.';
end;
$$;

select pg_notify('pgrst', 'reload schema');
