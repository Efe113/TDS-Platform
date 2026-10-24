-- 0020: discussion, ratings and the moderation path the plan promised.
--
-- The plan listed ratings/comments/comment_votes/reports/takedown_requests/moderation_actions, but
-- none of those tables were ever created, so M8b starts from zero. Two existing columns finally get
-- a source: strategies.rating_avg / rating_count (search_strategies already sorts by rating, so the
-- "En yüksek puanlı" option has been dead until now) and stat_user_rollup.comments_count /
-- upvotes_received, which 0019 deliberately left alone.
--
-- Rules encoded here, in one place, because the client cannot be trusted to enforce them:
--   * Ratings: one row per (user, strategy), 1..5, only on published strategies, and the aggregate
--     on strategies is recomputed by trigger - never incremented - so an un-rate or a backfill
--     cannot leave a stale average behind.
--   * Comments: one level of threading (a reply's parent must itself be top-level), 2..1000
--     characters, a 20 second cooldown per author, and only on approved/featured strategies.
--     Deletion is soft: the row stays for moderation, the body is replaced by a tombstone.
--   * Reports: one open report per (reporter, target) via a partial unique index, so the spam path
--     is "you already reported this" instead of a queue full of duplicates.
--   * Takedown: the document-ownership claim from the risk register (R8). It requires a signed-in
--     claimant on purpose - an anonymous web form would be pure spam, and the app has no other
--     channel for this claim.
--   * Kill switches: app.flag_enabled('comments_enabled' / 'ratings_enabled'), read server-side
--     inside the write paths, so turning discussion off does not need a client release.

-- ------------------------------------------------------------ 1. tables

create table if not exists public.ratings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, strategy_id)
);

create index if not exists ratings_strategy_idx on public.ratings (strategy_id);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  body text not null check (char_length(body) between 2 and 1000),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists comments_strategy_idx on public.comments (strategy_id, created_at desc);
create index if not exists comments_parent_idx on public.comments (parent_id) where parent_id is not null;

create table if not exists public.comment_votes (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  dir text not null check (dir in ('up', 'down')),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('strategy', 'comment', 'profile')),
  target_id text not null,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason_code text not null check (reason_code in ('spam', 'harassment', 'not_mine', 'wrong_strategy', 'other')),
  detail text check (detail is null or char_length(detail) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolution_note text
);

-- One open report per reporter and target; resolved ones may be filed again later.
create unique index if not exists reports_open_once_idx
  on public.reports (reporter_id, target_type, target_id) where status = 'pending';
create index if not exists reports_queue_idx on public.reports (created_at) where status = 'pending';

create table if not exists public.takedown_requests (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid references public.strategies (id) on delete cascade,
  claimant_name text not null check (char_length(claimant_name) between 2 and 120),
  claimant_email text not null check (claimant_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  statement text not null check (char_length(statement) between 20 and 4000),
  status text not null default 'pending' check (status in ('pending', 'actioned', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  note text
);

create table if not exists public.moderation_actions (
  id bigint generated always as identity primary key,
  admin_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('strategy', 'comment', 'profile', 'report', 'takedown')),
  target_id text not null,
  action text not null,
  note text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ 2. RLS
--
-- Clients read through the RPCs; direct writes are only allowed where the row is plainly the
-- caller's own and the RPC would be overkill. Everything privileged is definer-only.

alter table public.ratings enable row level security;
alter table public.comments enable row level security;
alter table public.comment_votes enable row level security;
alter table public.reports enable row level security;
alter table public.takedown_requests enable row level security;
alter table public.moderation_actions enable row level security;

drop policy if exists ratings_read on public.ratings;
create policy ratings_read on public.ratings
  for select using (user_id = auth.uid() or app.is_moderator());

drop policy if exists comments_read on public.comments;
create policy comments_read on public.comments for select using (true);

drop policy if exists comment_votes_read on public.comment_votes;
create policy comment_votes_read on public.comment_votes
  for select using (user_id = auth.uid() or app.is_moderator());

drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports
  for select using (reporter_id = auth.uid() or app.is_moderator());

drop policy if exists takedown_read on public.takedown_requests;
create policy takedown_read on public.takedown_requests
  for select using (app.is_moderator());

drop policy if exists moderation_read on public.moderation_actions;
create policy moderation_read on public.moderation_actions
  for select using (app.is_moderator());

-- Nobody inserts or updates these directly: post_comment/rate_strategy/file_report validate first.
-- `from public` is included because Supabase hands table privileges to PUBLIC by default, and a
-- missing revoke there would leave a writable table behind the RPCs (same lesson as 0016).
revoke all on table public.ratings, public.comments, public.comment_votes,
             public.reports, public.takedown_requests, public.moderation_actions
  from public, authenticated, anon;

-- ------------------------------------------------------------ 3. flags

insert into public.app_flags (key, value)
values ('comments_enabled', 'true'::jsonb), ('ratings_enabled', 'true'::jsonb)
on conflict (key) do nothing;

create or replace function app.flag_enabled(p_key text, p_default boolean default true)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- A missing flag, or a stored JSON null, is not "off": the seed may not have run on an older
  -- database, and a kill switch that fails closed would take discussion down with it.
  select coalesce(
    (select case when f.value = 'null'::jsonb then null
                 else (f.value #>> '{}')::boolean end
       from public.app_flags f where f.key = p_key),
    p_default
  );
$$;

-- ------------------------------------------------------------ 4. ratings

create or replace function app.recompute_strategy_rating()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid;
begin
  -- NEW is unassigned in a DELETE trigger, so the target depends on the operation.
  if tg_op = 'DELETE' then
    v_target := old.strategy_id;
  else
    v_target := new.strategy_id;
  end if;

  -- Recomputed from the rows, never incremented: an un-rate or a backfill cannot leave a stale
  -- average behind. Numeric(3,2) holds 0.00..9.99, and an average of 1..5 always fits.
  update public.strategies s
    set rating_count = agg.rating_total,
        rating_avg = agg.rating_mean
    from (
      select count(*)::integer as rating_total,
             round(avg(r.score)::numeric, 2) as rating_mean
        from public.ratings r
        where r.strategy_id = v_target
    ) agg
    where s.id = v_target;

  return null;
end;
$$;

drop trigger if exists ratings_recompute on public.ratings;
create trigger ratings_recompute
  after insert or delete or update on public.ratings
  for each row execute function app.recompute_strategy_rating();

create or replace function public.rate_strategy(p_strategy_id uuid, p_score integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_status text;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;
  if not app.flag_enabled('ratings_enabled') then
    raise exception 'RATINGS_DISABLED: rating is turned off right now';
  end if;

  select s.status into v_status from public.strategies s where s.id = p_strategy_id;
  if v_status is null or v_status not in ('approved', 'featured') then
    raise exception 'NOT_PUBLISHED: only published strategies can be rated';
  end if;

  if p_score is null then
    delete from public.ratings r where r.user_id = v_user and r.strategy_id = p_strategy_id;
  else
    if p_score not between 1 and 5 then
      raise exception 'BAD_SCORE: use 1..5';
    end if;
    insert into public.ratings (user_id, strategy_id, score)
      values (v_user, p_strategy_id, p_score::smallint)
      on conflict (user_id, strategy_id) do update set
        score = excluded.score,
        updated_at = now();
  end if;

  return (
    select jsonb_build_object(
      'strategyId', p_strategy_id,
      'myScore', p_score,
      'ratingAvg', s.rating_avg,
      'ratingCount', s.rating_count
    )
      from public.strategies s where s.id = p_strategy_id
  );
end;
$$;

-- ------------------------------------------------------------ 5. comments

create or replace function public.post_comment(
  p_strategy_id uuid,
  p_body text,
  p_parent_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_status text;
  v_parent record;
  v_body text;
  v_comment uuid;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;
  if not app.flag_enabled('comments_enabled') then
    raise exception 'COMMENTS_DISABLED: discussion is turned off right now';
  end if;

  v_body := trim(coalesce(p_body, ''));
  if char_length(v_body) < 2 or char_length(v_body) > 1000 then
    raise exception 'BAD_BODY: a comment is 2..1000 characters';
  end if;

  select s.status into v_status from public.strategies s where s.id = p_strategy_id;
  if v_status is null or v_status not in ('approved', 'featured') then
    raise exception 'NOT_PUBLISHED: only published strategies have discussion';
  end if;

  if p_parent_id is not null then
    -- Replying to a tombstoned comment stays allowed: the thread keeps its shape.
    select c.strategy_id, c.parent_id into v_parent
      from public.comments c where c.id = p_parent_id;
    if not found then
      raise exception 'NOT_FOUND: no such comment';
    end if;
    if v_parent.strategy_id <> p_strategy_id then
      raise exception 'BAD_PARENT: the reply belongs to another strategy';
    end if;
    -- One level of threading: replies attach to top-level comments only.
    if v_parent.parent_id is not null then
      raise exception 'TOO_DEEP: replies cannot be nested further';
    end if;
  end if;

  if exists (
    select 1 from public.comments c
      where c.user_id = v_user and c.created_at > now() - interval '20 seconds'
  ) then
    raise exception 'TOO_FAST: wait a moment before posting again';
  end if;

  insert into public.comments (strategy_id, user_id, parent_id, body)
    values (p_strategy_id, v_user, p_parent_id, v_body)
    returning id into v_comment;

  return v_comment;
end;
$$;

create or replace function public.delete_comment(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_comment public.comments%rowtype;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;

  select * into v_comment from public.comments c where c.id = p_comment_id;
  if v_comment.id is null then
    raise exception 'NOT_FOUND: no such comment';
  end if;
  if v_comment.user_id is distinct from v_user and not app.is_moderator() then
    raise exception 'FORBIDDEN: you can only delete your own comment';
  end if;

  update public.comments c set deleted_at = now() where c.id = p_comment_id and c.deleted_at is null;

  if app.is_moderator() and v_comment.user_id is distinct from v_user then
    insert into public.moderation_actions (admin_id, target_type, target_id, action, note)
      values (v_user, 'comment', p_comment_id::text, 'delete', null);
  end if;

  return true;
end;
$$;

create or replace function public.vote_comment(p_comment_id uuid, p_dir text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_author uuid;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;
  if p_dir is not null and p_dir not in ('up', 'down') then
    raise exception 'BAD_VOTE: use up, down or null';
  end if;

  select c.user_id into v_author from public.comments c where c.id = p_comment_id and c.deleted_at is null;
  if v_author is null then
    raise exception 'NOT_FOUND: no such comment';
  end if;
  -- Self-voting would inflate upvotes_received, which is a badge metric and therefore a currency
  -- reward path; a vote has to come from somebody else to count.
  if v_author = v_user then
    raise exception 'FORBIDDEN_SELF: you cannot vote on your own comment';
  end if;

  delete from public.comment_votes v where v.comment_id = p_comment_id and v.user_id = v_user;

  if p_dir is not null then
    insert into public.comment_votes (comment_id, user_id, dir) values (p_comment_id, v_user, p_dir);
  end if;

  return (
    select jsonb_build_object(
      'commentId', p_comment_id,
      'up', coalesce((select count(*)::integer from public.comment_votes u where u.comment_id = p_comment_id and u.dir = 'up'), 0),
      'down', coalesce((select count(*)::integer from public.comment_votes d where d.comment_id = p_comment_id and d.dir = 'down'), 0),
      'mine', p_dir
    )
  );
end;
$$;

-- The thread is assembled server-side: one round trip, deleted bodies replaced by a tombstone, and
-- the caller's own vote included. Ordering uses the timestamp column itself rather than a text
-- rendering of it, because jsonb_agg's ORDER BY over ->>'createdAt' would compare strings.
--
-- The strategy's rating aggregate and the caller's own score ride along, plus the two kill switches:
-- the detail page needs all of it to render the discussion panel and it should not have to ask twice.
create or replace function public.list_comments(p_strategy_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with tops as (
    select c.id, c.body, c.deleted_at, c.created_at, c.user_id, p.handle, p.display_name
      from public.comments c
      join public.profiles p on p.id = c.user_id
      where c.strategy_id = p_strategy_id and c.parent_id is null
      order by c.created_at desc
      limit 100
  ),
  replies as (
    select r.parent_id, r.id, r.body, r.deleted_at, r.created_at, r.user_id, p.handle, p.display_name
      from public.comments r
      join public.profiles p on p.id = r.user_id
      where r.parent_id in (select t.id from tops t)
      order by r.created_at
  ),
  reply_blobs as (
    select rp.parent_id,
           jsonb_agg(jsonb_build_object(
             'id', rp.id,
             'body', case when rp.deleted_at is null then rp.body else null end,
             'deleted', rp.deleted_at is not null,
             'createdAt', rp.created_at,
             'authorId', rp.user_id,
             'authorHandle', rp.handle,
             'authorDisplayName', rp.display_name,
             'mine', rp.user_id = auth.uid(),
             'up', coalesce((select count(*)::integer from public.comment_votes v2
                              where v2.comment_id = rp.id and v2.dir = 'up'), 0),
             'down', coalesce((select count(*)::integer from public.comment_votes v2
                                where v2.comment_id = rp.id and v2.dir = 'down'), 0),
             'myVote', (select v2.dir from public.comment_votes v2
                         where v2.comment_id = rp.id and v2.user_id = auth.uid())
           ) order by rp.created_at) as blob
    from replies rp
    group by rp.parent_id
  ),
  top_blobs as (
    select t.created_at as sort_at,
           jsonb_build_object(
             'id', t.id,
             'body', case when t.deleted_at is null then t.body else null end,
             'deleted', t.deleted_at is not null,
             'createdAt', t.created_at,
             'authorId', t.user_id,
             'authorHandle', t.handle,
             'authorDisplayName', t.display_name,
             'mine', t.user_id = auth.uid(),
             'up', coalesce((select count(*)::integer from public.comment_votes v
                              where v.comment_id = t.id and v.dir = 'up'), 0),
             'down', coalesce((select count(*)::integer from public.comment_votes v
                                where v.comment_id = t.id and v.dir = 'down'), 0),
             'myVote', (select v.dir from public.comment_votes v
                         where v.comment_id = t.id and v.user_id = auth.uid()),
             'replies', coalesce(rb.blob, '[]'::jsonb)
           ) as thread
    from tops t
    left join reply_blobs rb on rb.parent_id = t.id
  )
  select jsonb_build_object(
    'strategyId', p_strategy_id,
    'total', coalesce((select count(*)::integer from public.comments c3
                        where c3.strategy_id = p_strategy_id and c3.deleted_at is null), 0),
    'ratingsEnabled', app.flag_enabled('ratings_enabled'),
    'commentsEnabled', app.flag_enabled('comments_enabled'),
    'ratingAvg', (select s.rating_avg from public.strategies s where s.id = p_strategy_id),
    'ratingCount', coalesce((select s.rating_count from public.strategies s where s.id = p_strategy_id), 0),
    'myScore', (select r.score::integer from public.ratings r
                 where r.strategy_id = p_strategy_id and r.user_id = auth.uid()),
    'items', coalesce((select jsonb_agg(tb.thread order by tb.sort_at desc) from top_blobs tb), '[]'::jsonb)
  );
$$;

-- ------------------------------------------------------------ 6. reports and takedowns

create or replace function public.file_report(
  p_target_type text,
  p_target_id text,
  p_reason_code text,
  p_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_report_id uuid;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;
  if p_target_type is null or p_target_type not in ('strategy', 'comment', 'profile') then
    raise exception 'BAD_TARGET: strategy, comment or profile';
  end if;
  if p_reason_code is null or p_reason_code not in ('spam', 'harassment', 'not_mine', 'wrong_strategy', 'other') then
    raise exception 'BAD_REASON: unknown reason code';
  end if;
  if coalesce(trim(p_target_id), '') = '' then
    raise exception 'BAD_TARGET: an id is required';
  end if;

  -- The partial unique index keeps one open report per target; a second call returns the first
  -- instead of filling the queue with duplicates.
  insert into public.reports (target_type, target_id, reporter_id, reason_code, detail)
    values (p_target_type, p_target_id, v_user, p_reason_code, nullif(trim(coalesce(p_detail, '')), ''))
    on conflict (reporter_id, target_type, target_id) where status = 'pending' do nothing
    returning id into v_report_id;

  if v_report_id is null then
    select r.id into v_report_id from public.reports r
      where r.reporter_id = v_user and r.target_type = p_target_type
        and r.target_id = p_target_id and r.status = 'pending'
      order by r.created_at limit 1;
    return jsonb_build_object('reportId', v_report_id, 'duplicate', true);
  end if;

  return jsonb_build_object('reportId', v_report_id, 'duplicate', false);
end;
$$;

create or replace function public.request_takedown(
  p_strategy_id uuid,
  p_claimant_name text,
  p_claimant_email text,
  p_statement text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_request uuid;
begin
  -- A signed-in claimant on purpose: the app has no other ownership-claim channel and an anonymous
  -- form would be unusable spam. The statement is the legal part, not the account.
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;
  if char_length(trim(coalesce(p_claimant_name, ''))) < 2 then
    raise exception 'BAD_CLAIMANT: a name is required';
  end if;
  -- is null first, because NULL !~* pattern is NULL and a NULL guard would sail past the check.
  if p_claimant_email is null or p_claimant_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'BAD_EMAIL: a reachable email address is required';
  end if;
  if char_length(trim(coalesce(p_statement, ''))) < 20 then
    raise exception 'BAD_STATEMENT: describe the claim in at least 20 characters';
  end if;
  if not exists (select 1 from public.strategies s where s.id = p_strategy_id) then
    raise exception 'NOT_FOUND: no such strategy';
  end if;

  insert into public.takedown_requests (strategy_id, claimant_name, claimant_email, statement)
    values (p_strategy_id, trim(p_claimant_name), lower(trim(p_claimant_email)), trim(p_statement))
    returning id into v_request;

  -- No moderation_actions row: that table's admin_id is the actor, and here the actor is the
  -- claimant, not staff. takedown_requests already is the record, and the queue reads it directly.
  return v_request;
end;
$$;

-- ------------------------------------------------------------ 7. admin queue

create or replace function public.admin_moderation_queue(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_out jsonb;
begin
  -- A plain SQL body would return NULL for a non-moderator; the client needs a reason instead.
  if not app.is_moderator() then
    raise exception 'FORBIDDEN: moderator role required';
  end if;

  select jsonb_build_object(
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'targetType', r.target_type,
               'targetId', r.target_id,
               'reason', r.reason_code,
               'detail', r.detail,
               'status', r.status,
               'createdAt', r.created_at,
               'reporter', p.handle,
               'targetLabel', case r.target_type
                 when 'strategy' then (select s.name from public.strategies s where s.id::text = r.target_id)
                 when 'comment' then left((select c.body from public.comments c where c.id::text = r.target_id), 80)
                 when 'profile' then (select p2.handle from public.profiles p2 where p2.id::text = r.target_id)
                 else null
               end
             ) order by r.created_at)
        from (
          select r0.* from public.reports r0
            where r0.status = 'pending'
            order by r0.created_at
            limit least(greatest(coalesce(p_limit, 50), 1), 200)
        ) r
      left join public.profiles p on p.id = r.reporter_id
    ), '[]'::jsonb),
    'takedowns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'strategyId', t.strategy_id,
               'strategyName', s.name,
               'claimantName', t.claimant_name,
               'claimantEmail', t.claimant_email,
               'statement', t.statement,
               'status', t.status,
               'createdAt', t.created_at
             ) order by t.created_at)
        from (
          select t0.* from public.takedown_requests t0
            where t0.status = 'pending'
            order by t0.created_at
            limit least(greatest(coalesce(p_limit, 50), 1), 200)
        ) t
      left join public.strategies s on s.id = t.strategy_id
    ), '[]'::jsonb)
  )
    into v_out;

  return v_out;
end;
$$;

create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_status text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := auth.uid();
begin
  if v_admin is null or not app.is_moderator() then
    raise exception 'FORBIDDEN: moderator role required';
  end if;
  if p_status is null or p_status not in ('resolved', 'dismissed') then
    raise exception 'BAD_STATUS: resolved or dismissed';
  end if;

  update public.reports r
    set status = p_status,
        resolved_at = now(),
        resolved_by = v_admin,
        resolution_note = nullif(trim(coalesce(p_note, '')), '')
    where r.id = p_report_id and r.status = 'pending';

  if not found then
    raise exception 'NOT_FOUND: no open report with that id';
  end if;

  insert into public.moderation_actions (admin_id, target_type, target_id, action, note)
    values (v_admin, 'report', p_report_id::text, p_status, nullif(trim(coalesce(p_note, '')), ''));

  return true;
end;
$$;

-- ------------------------------------------------------------ 8. the two metrics 0019 left for M8b
--
-- Same recomputation as before, plus comments_count (authored, not deleted) and upvotes_received
-- (votes on this user's comments), which is what badge_metrics describes as "alınan faydalı oy".

create or replace function app.refresh_user_rollup(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_published integer := 0;
  v_approvals integer := 0;
  v_imports integer := 0;
  v_steps integer := 0;
  v_sessions integer := 0;
  v_maps integer := 0;
  v_days integer := 0;
  v_streak integer := 0;
  v_rank integer;
  v_comments integer := 0;
  v_upvotes integer := 0;
  v_metrics jsonb;
begin
  if p_user is null then
    return '{}'::jsonb;
  end if;

  select count(*)::integer into v_published
    from public.strategies s
    where s.owner_id = p_user and s.status in ('approved', 'featured');

  select count(*)::integer into v_approvals
    from public.admin_audit_log l
    where l.entity = 'strategies'
      and l.action in ('review:approve', 'review:feature')
      and l.entity_id in (select s.id::text from public.strategies s where s.owner_id = p_user);

  select count(*)::integer into v_imports
    from public.import_jobs j
    where j.user_id = p_user and j.status = 'done';

  select count(*)::integer into v_steps
    from public.usage_events e
    join public.overlay_sessions os on os.id = e.session_id
    where os.user_id = p_user and e.direction = 'forward';

  select count(*)::integer into v_sessions
    from public.overlay_sessions os
    where os.user_id = p_user and os.qualified;

  select count(distinct s.map_key)::integer into v_maps
    from public.overlay_sessions os
    join public.strategies s on s.id = os.strategy_id
    where os.user_id = p_user and os.qualified and s.map_key is not null;

  select count(distinct os.started_at::date)::integer into v_days
    from public.overlay_sessions os
    where os.user_id = p_user;

  with activity as (
      select distinct os.started_at::date as d
        from public.overlay_sessions os
        where os.user_id = p_user
    ),
    islands as (
      select a.d, (a.d - (row_number() over (order by a.d))::integer) as grp
        from activity a
    ),
    latest as (select max(d) as last_day from activity)
  select case
           when l.last_day is null or l.last_day < current_date - 1 then 0
           else coalesce((select count(*)::integer from islands i
                           where i.grp = (select max(i2.grp) from islands i2)), 0)
         end
    into v_streak
    from latest l;

  select min(l.rank)::integer into v_rank
    from public.leaderboard_snapshots l
    join public.strategies s on s.id = l.strategy_id
    where s.owner_id = p_user and l.board_window = 'all_time' and l.bucket = 'all';

  select count(*)::integer into v_comments
    from public.comments c
    where c.user_id = p_user and c.deleted_at is null;

  select coalesce(sum(case when v.dir = 'up' then 1 else 0 end), 0)::integer into v_upvotes
    from public.comment_votes v
    join public.comments c on c.id = v.comment_id
    where c.user_id = p_user;

  insert into public.stat_user_rollup (
      user_id, strategies_published, approvals_received, imports_completed, steps_completed,
      sessions_qualified, distinct_maps, usage_rank_best, active_days, streak,
      comments_count, upvotes_received
    )
    values (p_user, v_published, v_approvals, v_imports, v_steps, v_sessions, v_maps, v_rank,
            v_days, v_streak, v_comments, v_upvotes)
    on conflict (user_id) do update set
      strategies_published = excluded.strategies_published,
      approvals_received = excluded.approvals_received,
      imports_completed = excluded.imports_completed,
      steps_completed = excluded.steps_completed,
      sessions_qualified = excluded.sessions_qualified,
      distinct_maps = excluded.distinct_maps,
      usage_rank_best = excluded.usage_rank_best,
      active_days = excluded.active_days,
      streak = excluded.streak,
      comments_count = excluded.comments_count,
      upvotes_received = excluded.upvotes_received,
      updated_at = now();

  perform app.evaluate_badges(p_user);

  select to_jsonb(r) - 'user_id' - 'updated_at' into v_metrics
    from public.stat_user_rollup r
    where r.user_id = p_user;

  return coalesce(v_metrics, '{}'::jsonb);
end;
$$;

-- ------------------------------------------------------------ 9. keeping the two metrics honest
--
-- Without these triggers comments_count / upvotes_received only move when something usage-related
-- happens, which would make the new badge look broken for a week and then fire at random. A vote
-- refreshes the comment's author, not the voter, so the trigger looks the author up.

create or replace function app.rollup_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid;
begin
  if tg_op = 'DELETE' then
    v_target := old.user_id;
  else
    v_target := new.user_id;
  end if;
  if v_target is not null then
    perform app.refresh_user_rollup(v_target);
  end if;
  return null;
end;
$$;

drop trigger if exists comments_rollup on public.comments;
create trigger comments_rollup
  after insert or delete or update of deleted_at on public.comments
  for each row execute function app.rollup_on_comment();

create or replace function app.rollup_on_comment_vote()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comment uuid;
  v_target uuid;
begin
  if tg_op = 'DELETE' then
    v_comment := old.comment_id;
  else
    v_comment := new.comment_id;
  end if;

  select c.user_id into v_target from public.comments c where c.id = v_comment;
  if v_target is not null then
    perform app.refresh_user_rollup(v_target);
  end if;
  return null;
end;
$$;

drop trigger if exists comment_votes_rollup on public.comment_votes;
create trigger comment_votes_rollup
  after insert or delete or update on public.comment_votes
  for each row execute function app.rollup_on_comment_vote();

-- ------------------------------------------------------------ 10. the badge those metrics feed
--
-- Same declarative conditions as the seeded ones, so the admin panel can retune the threshold
-- without a migration. comments_count gets a metric row too; it had none in 0001's seed.

insert into public.badge_metrics (metric, source_table, operators, description)
values
  ('comments_count', 'stat_user_rollup', '{gte}', 'Yazılmış, silinmemiş yorum')
on conflict (metric) do nothing;

-- badge_definitions has no desc_en column (0001's seed never needed one, and the profile page only
-- renders the name), so the English copy here is desc_tr's counterpart in name_en.
insert into public.badge_definitions
  (code, name_tr, name_en, desc_tr, tier, conditions, award_mode, currency_reward)
values
  ('useful_voice', 'Faydalı Ses', 'Useful Voice',
   'Yorumların topluluktan 10 faydalı oy aldı.', 'silver',
   '{"all_of":[{"metric":"upvotes_received","op":"gte","value":10}]}'::jsonb, 'auto', 80),
  ('contributor', 'Katkıda Bulunan', 'Contributor',
   '20 yorumla stratejilere tartışma açtın.', 'bronze',
   '{"all_of":[{"metric":"comments_count","op":"gte","value":20}]}'::jsonb, 'auto', 40)
on conflict (code) do nothing;

-- ------------------------------------------------------------ 11. privileges

do $$
declare
  v_sig text;
  v_list text[] := array[
    'public.rate_strategy(uuid, integer)',
    'public.post_comment(uuid, text, uuid)',
    'public.delete_comment(uuid)',
    'public.vote_comment(uuid, text)',
    'public.list_comments(uuid)',
    'public.file_report(text, text, text, text)',
    'public.request_takedown(uuid, text, text, text)',
    'public.admin_moderation_queue(integer)',
    'public.admin_resolve_report(uuid, text, text)'
  ];
begin
  foreach v_sig in array v_list loop
    if to_regprocedure(v_sig) is null then
      raise notice 'skipped, no such function: %', v_sig;
      continue;
    end if;
    -- Revoking PUBLIC is the part that matters: revoking only from authenticated/anon leaves the
    -- inherited grant in place (0016 learned that the hard way).
    execute format('revoke execute on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;

  -- Discussion is readable without an account, like the rest of the public catalogue.
  v_sig := 'public.list_comments(uuid)';
  if to_regprocedure(v_sig) is not null then
    execute format('grant execute on function %s to anon', v_sig);
  end if;
end;
$$;
