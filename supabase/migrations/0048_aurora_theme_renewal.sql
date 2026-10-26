-- 0.3.4 renewal #3: Kutup / Aurora.
--
-- The same standard as 0045 and 0047, drawn as its own physical idea: a polar night. Three horizontal
-- bands became five vertical light curtains, each leaning and waving on its own clock with striations
-- running along the column, over a star backing; under them a frozen horizon line with light pollution
-- welling up from below it. Registry side: packages/shared/src/domain/themes.ts (`aurora`, six layers,
-- a second `star` field).
--
-- The key stays `aurora` and the price stays 320, so an owner keeps what they bought. What changes here
-- is the shelf copy, the renewal chip and the accent, which must equal the registry brand token or the
-- picker swatch and the window disagree.
--
-- The tag CHECK is re-declared with the identical list (as 0047 does) so this file is safe to run alone
-- and re-running any of the three cannot drift the vocabularies apart.
--
-- Safe to run twice. Depends on 0022 (theme rows) and 0045 (renewed tag vocabulary).

-- ------------------------------------------------------------ 1. the chip vocabulary, unchanged list

alter table public.spend_catalog drop constraint if exists spend_catalog_tag_check;
alter table public.spend_catalog add constraint spend_catalog_tag_check
  check (tag in ('none', 'new', 'soon', 'vip', 'verified', 'corporate', 'renewed'));

-- ------------------------------------------------------------ 2. the skin row

update public.profile_themes
   set name_tr = 'Kutup',
       name_en = 'Aurora',
       css = jsonb_set(coalesce(css, '{}'::jsonb), '{accent}', '"#4fd2ff"', true)
 where key = 'aurora';

insert into public.spend_catalog (
  sku, kind, price, ref_code, enabled, name_tr, name_en, desc_tr, desc_en, perks, tag
)
values (
  'theme_aurora', 'theme', 320, 'aurora', true,
  'Kutup', 'Aurora',
  'Kutup gecesi: gökyüzünde ışık perdeleri, altta buz ufku, arkada yıldızlar.',
  'A polar night: light curtains in the sky, a frozen horizon below and stars behind them.',
  '["Beş ışık perdesi, her biri kendi ritminde dalgalanıyor","Perdenin içinde boyuna yürüyen damar doku","Altta buz ufku: keskin çizgi ve yukarı vuran ışık kirliliği","Yıldız desteği gökyüzünde, kurdeleler ortada akıyor","Film grenli zemin: camgöbeği panellere yapışmıyor"]'::jsonb,
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
    raise exception '0048 failed: spend_catalog_tag_check still rejects renewed';
  end if;

  if not exists (
    select 1 from public.spend_catalog where sku = 'theme_aurora' and tag = 'renewed' and price = 320
  ) then
    raise exception '0048 failed: theme_aurora is not the renewed row at 320';
  end if;

  if not exists (
    select 1 from public.profile_themes
     where key = 'aurora' and css ->> 'accent' = '#4fd2ff'
  ) then
    raise exception '0048 failed: the aurora accent does not match the registry brand token';
  end if;

  raise notice '0048 ok: Kutup artık kutup gecesi — ışık perdeleri ve buz ufkuyla rafta.';
end;
$$;

select pg_notify('pgrst', 'reload schema');
