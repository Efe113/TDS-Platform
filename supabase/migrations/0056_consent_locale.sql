-- 0.3.9 Faz A: the consent record says which language the member actually read.
--
-- 0005 wrote `locale` as the literal 'tr' because there was only one interface then. The policy texts
-- are now a bilingual register — a Turkish member and an English member accept different sentences — so
-- the row that proves consent has to carry the language it was given in, or the record is a signature
-- next to an unnamed document.
--
-- The read (`has_consented`) is untouched: consent is per version, not per language. Accepting the
-- English text of 2026.11.1 is accepting that version.
--
-- Safe to run twice. Depends on 0005 (app_consents, accept_consent).

-- The old three-argument signature is dropped first: a new defaulted parameter would otherwise leave two
-- overloads with the same name, and PostgREST refuses to guess between them.
drop function if exists public.accept_consent(text, text, text);

create or replace function public.accept_consent(
  p_kind text,
  p_policy_version text,
  p_client_version text default null,
  p_locale text default 'tr'
)
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

  -- A bad locale is corrected rather than rejected: losing an acceptance over a language tag is a worse
  -- outcome than an inaccurate tag, and the client cannot send anything the enum below would not catch.
  insert into public.app_consents (user_id, kind, policy_version, client_version, locale)
    values (
      auth.uid(),
      p_kind,
      trim(p_policy_version),
      p_client_version,
      case when p_locale in ('tr', 'en') then p_locale else 'tr' end
    )
    on conflict (user_id, kind, policy_version) do update set
      -- Re-accepting the same version on a machine set to the other language updates the tag, so the
      -- row describes the text the member read most recently.
      locale = excluded.locale,
      client_version = coalesce(excluded.client_version, app_consents.client_version);
end;
$$;

-- ------------------------------------------------------------ privileges

do $$
declare
  v_sig text := 'public.accept_consent(text, text, text, text)';
begin
  if to_regprocedure(v_sig) is null then
    raise exception '0056 failed: accept_consent was not re-created with the locale argument';
  end if;
  execute format('revoke execute on function %s from public, anon', v_sig);
  execute format('grant execute on function %s to authenticated', v_sig);
end;
$$;

-- ------------------------------------------------------------ prove it landed

do $$
declare
  v_args text[];
begin
  if to_regprocedure('public.accept_consent(text, text, text, text)') is null then
    raise exception '0056 failed: the four-argument accept_consent is missing';
  end if;

  if to_regprocedure('public.accept_consent(text, text, text)') is not null then
    raise exception '0056 failed: the old three-argument overload survived, so PostgREST has to guess';
  end if;

  select array_agg(arg order by position)
    into v_args
    from (
      select a.argname as arg, a.argposition as position
        from pg_proc p
        join unnest(p.proargnames) with ordinality a(argname, argposition) on true
       where p.oid = 'public.accept_consent(text, text, text, text)'::regprocedure
    ) s;

  if v_args is distinct from array['p_kind', 'p_policy_version', 'p_client_version', 'p_locale'] then
    raise exception '0056 failed: unexpected argument order: %', v_args;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'app_consents' and column_name = 'locale'
  ) then
    raise exception '0056 failed: app_consents has no locale column to write';
  end if;

  -- Behaviour, not just shape: without a session the function must still refuse, and it must say so
  -- with the code the client already translates.
  begin
    perform public.accept_consent('tos', '2026.11.1', 'proof', 'en');
    raise exception '0056 failed: an anonymous accept went through';
  exception
    when others then
      if sqlerrm not like 'ANONYMOUS%' then
        raise exception '0056 failed: accept_consent answered with %', sqlerrm;
      end if;
  end;

  raise notice '0056 ok: onay kaydı artık okunan dili (tr/en) taşıyor ve aynı sürüm yeniden onaylanırsa etiket güncelleniyor.';
end;
$$;

select pg_notify('pgrst', 'reload schema');
