-- 0.3.3 renewal #2: Toksik.
--
-- Same standard as 0045's Ocak, drawn as its own physical idea. The old toxic skin was a hazard stripe
-- with dots in it; this one is a leak: an acid pool churning at the floor with a foam line running
-- across its surface, ooze strands hanging from the ceiling that shed drops on staggered clocks, two
-- scan bands crossing each other, hazard tape crawling in opposite directions from two corners, and
-- bubbles that swell and burst instead of fading. Registry side:
-- packages/shared/src/domain/themes.ts (`toxic`, seven layers, a second `dust` field).
--
-- The key stays `toxic` and the price stays 220, so owners keep what they bought. Only the shelf copy,
-- the renewal chip and the accent — which must equal the registry brand token — change here.
--
-- The tag CHECK is re-declared (identical list to 0045) so this file is safe to run on its own and so
-- re-running either file cannot put the two vocabularies out of step.
--
-- Safe to run twice. Depends on 0022 (theme rows) and 0045 (renewed tag vocabulary).

-- ------------------------------------------------------------ 1. the chip vocabulary, again identical

alter table public.spend_catalog drop constraint if exists spend_catalog_tag_check;
alter table public.spend_catalog add constraint spend_catalog_tag_check
  check (tag in ('none', 'new', 'soon', 'vip', 'verified', 'corporate', 'renewed'));

-- ------------------------------------------------------------ 2. the skin row

update public.profile_themes
   set name_tr = 'Toksik',
       name_en = 'Toxic',
       css = jsonb_set(coalesce(css, '{}'::jsonb), '{accent}', '"#84f95c"', true)
 where key = 'toxic';

insert into public.spend_catalog (
  sku, kind, price, ref_code, enabled, name_tr, name_en, desc_tr, desc_en, perks, tag
)
values (
  'theme_toxic', 'theme', 220, 'toxic', true,
  'Toksik', 'Toxic',
  'Sızıntı: tabanda çalkalanan asit, tavanda kopan damlalar, ortamda sürünen toz.',
  'A leak: acid churning on the floor, drops breaking off the ceiling, dust drifting through it.',
  '["Asit banyosu ve yüzeyde koşan köpük hattı","Tavandan sarkan sıvı: her damla kendi saatinde kopuyor","Çift tarama bandı — biri aşağı, biri yukarı","İki köşede zıt yönde yürüyen tehlike bandı","Baloncuklar tepede şişip patlıyor"]'::jsonb,
  'renewed'
)
on conflict (sku) do update set
  kind = excluded.kind,
  price = excluded.price,
  ref_code = excluded.ref_code,
  enabled = true,
  name_tr = excluded.name_tr,
  name_en = excluded.name_en,
  desc_tr = excluded.desc_tr,
  desc_en = excluded.desc_en,
  perks = excluded.perks,
  tag = excluded.tag;

-- ------------------------------------------------------------ 3. prove it landed

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'spend_catalog_tag_check';
  if v_def is null or v_def not like '%renewed%' then
    raise exception '0047 failed: spend_catalog_tag_check still rejects renewed';
  end if;

  if not exists (
    select 1 from public.spend_catalog where sku = 'theme_toxic' and tag = 'renewed' and price = 220
  ) then
    raise exception '0047 failed: theme_toxic is not the renewed row at 220';
  end if;

  if not exists (
    select 1 from public.profile_themes
     where key = 'toxic' and css ->> 'accent' = '#84f95c'
  ) then
    raise exception '0047 failed: the toxic accent does not match the registry brand token';
  end if;

  raise notice '0047 ok: Toksik yenilendi, asit banyosu ve sızıntıyla rafta.';
end;
$$;

select pg_notify('pgrst', 'reload schema');
