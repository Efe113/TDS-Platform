-- 0021: the two loose ends M8b left, plus the queue the plan promised the admin panel would fill.
--
--   * list_comments returned `mine` as NULL for a signed-out reader, because `t.user_id = auth.uid()`
--     is NULL when there is no uid - three-valued logic, not a bug in the join. The client already
--     coerces it, so this is the contract being made honest rather than a hotfix: no consumer should
--     have to guess whether "not mine" and "nobody signed in" are different values.
--
--   * import_unmatched has existed since 0002 and has never received a single row: the importer knows
--     exactly which tower labels and modifier icons it could not resolve (report codes + matchedBy),
--     but record_import only wrote the job header. Now the gaps queue has a source, which is what
--     makes "add to catalog" from the admin panel a workflow instead of a dead button.
--
--   * record_import gains a seventh argument. Postgres does NOT replace a function when the argument
--     list changes - it creates an overload, and then a call with the old six named arguments becomes
--     ambiguous (42725). The old signature is dropped first, on purpose.
--
-- Anti-flood rule: the same label found twice inside one import is one row, and a (user, kind, sample)
-- seen in the last 7 days is skipped, because re-importing the same document is routine and would
-- otherwise bury the queue in duplicates. Frequency across *different* documents stays visible, which
-- is the signal the catalog actually needs.

-- ------------------------------------------------------------ 1. list_comments: boolean mine

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
             'mine', coalesce(rp.user_id = auth.uid(), false),
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
             'mine', coalesce(t.user_id = auth.uid(), false),
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

-- ------------------------------------------------------------ 2. record_import carries the gaps

drop function if exists public.record_import(text, text, text, text, text, text);

create or replace function public.record_import(
  p_kind text,
  p_status text,
  p_source_url text default null,
  p_doc_id text default null,
  p_sha256 text default null,
  p_error_code text default null,
  p_unmatched jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_job uuid;
begin
  if v_user is null then
    raise exception 'ANONYMOUS: sign in first';
  end if;

  insert into public.import_jobs (user_id, kind, source_url, doc_id, source_sha256, status, error_code, finished_at)
    values (
      v_user,
      case when p_kind in ('gdocs_link', 'file', 'paste') then p_kind else 'paste' end,
      left(nullif(p_source_url, ''), 500),
      left(nullif(p_doc_id, ''), 120),
      left(nullif(p_sha256, ''), 80),
      case when p_status in ('pending', 'done', 'failed') then p_status else 'done' end,
      left(nullif(p_error_code, ''), 60),
      case when p_status = 'pending' then null else now() end
    )
    returning id into v_job;

  -- A malformed payload must never fail an import the user already finished: this is the same call
  -- the profile statistics depend on.
  if jsonb_typeof(coalesce(p_unmatched, '[]'::jsonb)) <> 'array' then
    return v_job;
  end if;

  insert into public.import_unmatched (job_id, kind, sample)
  select v_job, d.kind, d.sample
    from (
      select distinct on (u.value ->> 'kind', u.value -> 'sample')
             u.value ->> 'kind' as kind,
             u.value -> 'sample' as sample
        from jsonb_array_elements(coalesce(p_unmatched, '[]'::jsonb)) u(value)
        where jsonb_typeof(u.value) = 'object'
          and u.value ->> 'kind' in ('icon', 'tower', 'mutator', 'map', 'section')
          and jsonb_typeof(u.value -> 'sample') = 'object'
          and length(coalesce(u.value -> 'sample' #>> '{}', '')) between 2 and 1500
        order by u.value ->> 'kind', u.value -> 'sample'
    ) d
    where not exists (
      select 1 from public.import_unmatched old
        join public.import_jobs old_job on old_job.id = old.job_id
        where old_job.user_id = v_user
          and old.kind = d.kind
          and old.sample = d.sample
          and old.created_at > now() - interval '7 days'
    )
    limit 25;

  return v_job;
end;
$$;

-- ------------------------------------------------------------ 3. privileges

do $$
declare
  v_sig text := 'public.record_import(text, text, text, text, text, text, jsonb)';
begin
  if to_regprocedure(v_sig) is null then
    raise notice 'skipped, no such function: %', v_sig;
    return;
  end if;
  -- Revoking PUBLIC is the part that matters; authenticated/anon alone leaves the inherited grant
  -- in place (0016 learned that the hard way).
  execute format('revoke execute on function %s from public, anon', v_sig);
  execute format('grant execute on function %s to authenticated', v_sig);
end;
$$;
