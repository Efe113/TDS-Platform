-- 0035: modifiers gain an optional numeric multiplier.
--
-- The catalog historically stored only names/aliases/groups. Modifier reward boosts (e.g. +30%)
-- are displayed by the game and matter when comparing routes, so the admin catalog exposes them
-- as a multiplier (1.30 = +30%). Null means the modifier has no numeric reward multiplier.
--
-- Run after 0034. Idempotent: safe to paste twice.

alter table public.mutators
  add column if not exists multiplier numeric;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mutators_multiplier_positive'
      and conrelid = 'public.mutators'::regclass
  ) then
    alter table public.mutators
      add constraint mutators_multiplier_positive
      check (multiplier is null or multiplier > 0)
      not valid;
  end if;
end $$;

comment on column public.mutators.multiplier is
  'Reward/score multiplier shown by the game; 1.30 = +30%. Null when there is no numeric boost.';

select pg_notify('pgrst', 'reload schema');
