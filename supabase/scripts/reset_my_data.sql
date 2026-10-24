-- Reset one account to a blank slate (your own), for testing the first-run experience.
--
-- HOW TO USE
--   1. Put your e-mail in v_email below.
--   2. Run the whole file in the Supabase SQL editor.
--   3. Sign out and back in: the profile is recreated by the signup trigger with zero data.
--
-- WHAT IT DOES
--   Deletes the account's product data in child-to-parent order inside one transaction, so a failure
--   leaves nothing half-deleted. It does NOT touch app_flags, catalogues, badges or other people's
--   rows: a reset is about one player, never about the platform.
--
--   The auth user itself is kept on purpose, so you do not have to re-verify the e-mail. The commented
--   block at the end deletes the whole auth user instead (then you can register the address again).

do $$
declare
  v_email text := 'you@example.com'; -- <-- put your e-mail here
  v_user uuid;
  v_profile uuid;
  v_strategies uuid[];
  v_sessions uuid[];
  v_comments uuid[];
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);
  if v_user is null then
    raise exception 'No auth user for %', v_email;
  end if;

  select id into v_profile from public.profiles where id = v_user;
  v_strategies := coalesce(array(select id from public.strategies where owner_id = v_user), array[]::uuid[]);
  v_sessions := coalesce(array(select id from public.overlay_sessions where user_id = v_user), array[]::uuid[]);
  v_comments := coalesce(array(select id from public.comments where user_id = v_user), array[]::uuid[]);

  -- Moderation / social children first.
  delete from public.comment_votes where comment_id = any (v_comments) or user_id = v_user;
  delete from public.comments where strategy_id = any (v_strategies) or user_id = v_user;
  delete from public.comment_solutions where strategy_id = any (v_strategies) or created_by = v_user;
  delete from public.ratings where strategy_id = any (v_strategies) or user_id = v_user;
  delete from public.reports where reporter_id = v_user;
  -- No user FK here: a takedown claim is an e-mail, not an account.
  delete from public.takedown_requests where strategy_id = any (v_strategies) or lower(claimant_email) = lower(v_email);
  delete from public.moderation_actions where admin_id = v_user;
  delete from public.favorites where user_id = v_user;

  -- Personal layer.
  delete from public.step_marks where user_id = v_user;
  delete from public.step_feedback where user_id = v_user;
  delete from public.strategy_watch where user_id = v_user;
  delete from public.public_badges where user_id = v_user;
  delete from public.user_badges where user_id = v_user;
  delete from public.user_themes where user_id = v_user;

  -- Usage + economy.
  delete from public.usage_events where session_id = any (v_sessions);
  delete from public.overlay_sessions where user_id = v_user;
  delete from public.strategy_usage_daily where strategy_id = any (v_strategies);
  delete from public.strategy_boosts where buyer_id = v_user or strategy_id = any (v_strategies);
  delete from public.spend_orders where user_id = v_user;
  delete from public.currency_ledger where user_id = v_user;

  -- Imports.
  delete from public.import_unmatched where job_id in (select id from public.import_jobs where user_id = v_user);
  delete from public.import_jobs where user_id = v_user;

  -- Strategies (versions, steps, inventory, media, tags cascade from strategies).
  delete from public.strategies where owner_id = v_user;

  -- Finally the profile row; the signup trigger recreates it on the next sign-in.
  delete from public.profiles where id = v_user;

  raise notice 'Reset done for % (user %): % strategies, % sessions, % comments removed.',
    v_email, v_user, coalesce(array_length(v_strategies, 1), 0),
    coalesce(array_length(v_sessions, 1), 0), coalesce(array_length(v_comments, 1), 0);
end;
$$;

-- Uncomment to delete the auth user as well (a brand-new signup, including e-mail verification):
-- delete from auth.users where lower(email) = lower('you@example.com');
