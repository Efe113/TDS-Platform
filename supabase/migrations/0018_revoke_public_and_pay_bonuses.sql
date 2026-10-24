-- 0018: the minting hole was still open, and two earning rules paid nothing.
--
-- 1. 0016 revoked award_currency FROM AUTHENTICATED, ANON - which does nothing on its own, because
--    Postgres grants EXECUTE on new functions to PUBLIC, and every role is a member of PUBLIC. The
--    probe after 0017 proved it: an anonymous call reached the function body and answered
--    "FORBIDDEN: you can only award to yourself" instead of "permission denied". The revoke below
--    drops `public` too, which is the part that actually closes it. The definer callers inside the
--    database (flush_usage, admin_review_strategy) are unaffected: privileges are checked against
--    the calling function's owner there, and they are owned by the same role that created them.
--
-- 2. wallet_summary lists publish_bonus (20/approved version) and approval_bonus (50/first
--    approval), but nothing ever called award_currency for them - only flush_usage paid the usage
--    rule. A user could read those rules on screen and never earn them. They are now paid inside
--    admin_review_strategy, on the transition to approved/featured:
--      publish_bonus  -> once per version, keyed by the version id
--      approval_bonus -> once per author, keyed by "first-approval:<author>"
--    Amounts are read from currency_rules instead of being hardcoded, so the admin economy panel
--    stays the single source of truth, and award_currency's own daily/weekly caps still apply.

-- ------------------------------------------------------------ 1. privileges that actually stick
--
-- Drift and typo tolerant on purpose: each signature is checked with to_regfunction first, so a
-- name that does not exist in this database raises a NOTICE instead of aborting the whole file
-- (a bare `revoke execute on function public.x(...)` on a missing signature would roll the file
-- back and cost another round).

do $$
declare
  v_sig text;
  v_authenticated text[] := array[
    'public.wallet_summary()',
    'public.buy_boost(uuid, text, text)',
    'public.select_theme(text)',
    'public.start_overlay_session(uuid, text, text, text)',
    'public.flush_usage(uuid, uuid, jsonb)',
    'public.submit_strategy(jsonb, text, text)',
    'public.create_strategy_from_draft(jsonb, text, text)',
    'public.publish_strategy(uuid)',
    'public.spend_currency(text, text)',
    'public.verify_balance(uuid)',
    'public.toggle_favorite(uuid)',
    'public.accept_consent(text, text, text)'
  ];
begin
  foreach v_sig in array v_authenticated loop
    if to_regprocedure(v_sig) is null then
      raise notice 'skipped, no such function: %', v_sig;
      continue;
    end if;
    -- PUBLIC is the grant that actually reaches the api roles; dropping it and re-granting
    -- explicitly is what makes the permission boundary real.
    execute format('revoke execute on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;

  v_sig := 'public.award_currency(uuid, text, integer, text, text, text)';
  if to_regprocedure(v_sig) is null then
    raise notice 'skipped, no such function: %', v_sig;
  else
    -- No client role at all: only definer functions inside the database mint coins.
    execute format('revoke execute on function %s from public, authenticated, anon', v_sig);
  end if;
end;
$$;

-- ------------------------------------------------------------ 2. pay the rules the wallet advertises

create or replace function public.admin_review_strategy(p_strategy_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.strategies%rowtype;
  v_version uuid;
  v_amount integer;
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

  -- Bonuses only follow a decision that actually publishes something, and only for a strategy that
  -- was not already live: re-approving the same row must not pay twice.
  if p_decision in ('approve', 'feature') and v_before.status not in ('approved', 'featured') then
    select cv.id into v_version
      from public.strategy_versions cv
      where cv.strategy_id = p_strategy_id
      order by cv.version_no desc limit 1;

    if v_version is not null then
      select r.amount into v_amount from public.currency_rules r where r.code = 'publish_bonus' and r.enabled;
      if v_amount is not null then
        perform public.award_currency(v_before.owner_id, 'publish_bonus', v_amount, 'version',
                                      v_version::text, v_version::text || ':publish');
      end if;

      select r.amount into v_amount from public.currency_rules r where r.code = 'approval_bonus' and r.enabled;
      if v_amount is not null then
        perform public.award_currency(v_before.owner_id, 'approval_bonus', v_amount, 'strategy',
                                      p_strategy_id::text, 'first-approval:' || v_before.owner_id::text);
      end if;
    end if;
  end if;

  insert into public.admin_audit_log (admin_id, action, entity, entity_id, before_data, after_data)
    values (auth.uid(), 'review:' || p_decision, 'strategies', p_strategy_id::text,
            to_jsonb(v_before),
            (select to_jsonb(s) from public.strategies s where s.id = p_strategy_id));
end;
$$;

grant execute on function public.admin_review_strategy(uuid, text, text) to authenticated;
