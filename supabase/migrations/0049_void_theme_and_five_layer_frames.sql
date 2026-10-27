-- 0.3.5 renewal #4: Boşluk / Void — and the frame engine rebuilt to five layers.
--
-- Void was three layers and one star field over a purple wash. The renewal follows the same standard
-- as 0045/0047/0048, drawn as its own physical idea: a gravity well. An accretion disc turns over a
-- dark core with a photon hairline, gas clouds sit at three depths so the sky has parallax instead of
-- a wash, three elliptical orbits carry one body each, a diagonal rift leaks light, and the canvas runs
-- a star field against a dust field that never twinkles. Registry side:
-- packages/shared/src/domain/themes.ts (`void`, eight layers, second field `dust`).
--
-- The second half of this file is the frame rebuild. Every frame is now the same machine with five
-- surfaces — halo, core, spin, spark, mark — and the shelf lists them by name, so `perks` carries the
-- five layer labels of the registry rather than prose. That is deliberate: a buyer reading the tile
-- sees exactly what the client paints, and a test compares the two lists.
--
-- Nothing here re-prices or renames a key an owner already holds. `frame_aurora` is the one genuine
-- gap: the registry has carried an `aurora` skin since 0031 and only ever *updated* a row that no
-- migration inserted, so the frame could never be bought and `equip_cosmetic` answered NOT_FOUND.
-- It gets a real row at 540.
--
-- The rainbow stays a benefit: `tag = 'vip'` with `price = 0`, exactly as 0032 and 0041 expect. The
-- renewal chip is marketing and must never be used on something a tier hands out.
--
-- Safe to run twice. Depends on 0022/0025 (theme rows), 0026/0031/0032/0043 (frame rows) and 0045
-- (the `renewed` tag vocabulary).

-- ------------------------------------------------------------ 1. the chip vocabulary, unchanged list

alter table public.spend_catalog drop constraint if exists spend_catalog_tag_check;
alter table public.spend_catalog add constraint spend_catalog_tag_check
  check (tag in ('none', 'new', 'soon', 'vip', 'verified', 'corporate', 'renewed'));

-- ------------------------------------------------------------ 2. the void skin

update public.profile_themes
   set name_tr = 'Boşluk',
       name_en = 'Void',
       css = jsonb_set(coalesce(css, '{}'::jsonb), '{accent}', '"#9d7bff"', true)
 where key = 'void';

insert into public.spend_catalog (
  sku, kind, price, ref_code, enabled, name_tr, name_en, desc_tr, desc_en, perks, tag
)
values (
  'theme_void', 'theme', 420, 'void', true,
  'Boşluk', 'Void',
  'Bir yerçekimi kuyusu: dönen birikim diski, kara bir çekirdek, üç derinlikte gaz bulutu.',
  'A gravity well: a turning accretion disc over a dark core, with gas clouds at three depths.',
  '["Eğik dönen birikim diski ve üzerinde yürüyen sıcak halka","Kara çekirdek: ışığı yutan olay ufku ve nefes alan foton çizgisi","Üç derinlikte gaz bulutu: aynı hızda hareket etmezler, bu yüzden uzaklık okunuyor","Üç yörünge, her birinde bir gövde — farklı hızlarda dönen bir bir güneş saati gibi","Yıldız alanına karşı toz alanı: tek tuvalde iki derinlik, ikisi de kırpmadan"]'::jsonb,
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

-- ------------------------------------------------------------ 3. the five-layer frames

insert into public.spend_catalog (
  sku, kind, price, ref_code, enabled, sort_order,
  name_tr, name_en, desc_tr, desc_en, perks, tag
)
values
  ('frame_ember', 'frame', 320, 'ember', true, 510,
   'Ocak çerçevesi', 'Forge frame',
   'Avatarının çevresinde beş katmanlı bir ocak: erimiş bant, dönen dikiş, yükselen kıvılcım.',
   'A five-layer forge around your avatar: a molten band, a turning seam and rising sparks.',
   '["Kor halesi","Erimiş halka","Dikiş gibi yürüyen ışık","Yükselen kıvılcımlar","Tutuşan kömür patlaması"]'::jsonb,
   'renewed'),
  ('frame_void', 'frame', 480, 'void', true, 520,
   'Boşluk çerçevesi', 'Void frame',
   'Avatarının çevresinde bükülen ışık: bir olay ufku, onun üstünde dönen bir disk.',
   'Bent light around your avatar: an event horizon with a disc turning over it.',
   '["Lens halesi","Olay ufku","Dönen birikim diski","İçe düşen yıldız tozu","Yırtıktan sızan ışık"]'::jsonb,
   'renewed'),
  ('frame_aurora', 'frame', 540, 'aurora', true, 525,
   'Kutup çerçevesi', 'Aurora frame',
   'Avatarının çevresinde kutup ışığı: soğuk bir bant, üzerinden geçen bir perde, arkada yıldızlar.',
   'Polar light around your avatar: a cold band, a curtain sweeping it, stars behind.',
   '["Kutup parıltısı","Buz bandı","Işık perdesi taraması","Kutup yıldızları","Ters akan şerit"]'::jsonb,
   'renewed'),
  ('frame_toxic', 'frame', 360, 'toxic', true, 540,
   'Toksik çerçevesi', 'Toxic frame',
   'Avatarının çevresinde kaynayan asit: bant, yüzeyde yürüyen köpük, patlayan kabarcıklar.',
   'Boiling acid around your avatar: a band, foam running on its surface, bubbles that burst.',
   '["Asit buğusu","Kayan asit bandı","Yüzeyde yürüyen köpük","Zehir kabarcıkları","Sarkan damla"]'::jsonb,
   'renewed'),
  ('frame_gold', 'frame', 800, 'gold', true, 535,
   'Altın çerçevesi', 'Gold frame',
   'Fırçalanmış altın bant, üzerinden geçen ölçülü bir parlama, yörüngede altın tozu.',
   'A brushed gold band with one measured sheen crossing it and gold dust in orbit.',
   '["Sıcak hale","Fırçalanmış metal","Ölçülü parlama","Altın tozu","Kazınmış kılcal çizgi"]'::jsonb,
   'renewed'),
  ('frame_rainbow', 'frame', 0, 'rainbow', true, 530,
   'Gökkuşağı çerçevesi', 'Rainbow frame',
   'Tam spektrum halkası, prizma taraması ve yörüngedeki kıvılcımlarla VIP çerçevesi.',
   'The VIP frame: a full spectrum ring, a prism sweep and sparks in orbit.',
   '["Spektrum halesi","Tam spektrum bandı","Prizma taraması","Yörüngedeki kıvılcımlar","İç kılcal halka"]'::jsonb,
   'vip')
on conflict (sku) do update set
  kind = excluded.kind,
  price = excluded.price,
  ref_code = excluded.ref_code,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order,
  name_tr = excluded.name_tr,
  name_en = excluded.name_en,
  desc_tr = excluded.desc_tr,
  desc_en = excluded.desc_en,
  perks = excluded.perks,
  tag = excluded.tag;

-- ------------------------------------------------------------ 4. prove it landed

do $$
declare
  v_def text;
  v_count int;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'spend_catalog_tag_check';
  if v_def is null or v_def not like '%renewed%' then
    raise exception '0049 failed: spend_catalog_tag_check still rejects renewed';
  end if;

  if not exists (
    select 1 from public.spend_catalog where sku = 'theme_void' and tag = 'renewed' and price = 420
  ) then
    raise exception '0049 failed: theme_void is not the renewed row at 420';
  end if;

  if not exists (
    select 1 from public.profile_themes
     where key = 'void' and css ->> 'accent' = '#9d7bff'
  ) then
    raise exception '0049 failed: the void accent does not match the registry brand token';
  end if;

  -- Every frame the client can paint must be buyable, and must carry exactly its five layers.
  select count(*) into v_count
    from public.spend_catalog
   where kind = 'frame'
     and ref_code in ('ember', 'void', 'aurora', 'gold', 'rainbow', 'toxic');
  if v_count <> 6 then
    raise exception '0049 failed: only % of the six frames have a catalog row', v_count;
  end if;

  if exists (
    select 1 from public.spend_catalog
     where kind = 'frame' and ref_code <> 'rainbow' and jsonb_array_length(perks) <> 5
  ) then
    raise exception '0049 failed: a frame is not selling five layers';
  end if;

  -- The renewal chip is marketing, never an entitlement; the rainbow must stay a VIP benefit.
  if exists (
    select 1 from public.spend_catalog
     where kind = 'frame' and ref_code = 'rainbow' and (tag <> 'vip' or price <> 0)
  ) then
    raise exception '0049 failed: the rainbow frame stopped being the VIP benefit';
  end if;

  raise notice '0049 ok: Boşluk bir yerçekimi kuyusuna dönüştü; altı çerçeve de beş katmanla rafta.';
end;
$$;

select pg_notify('pgrst', 'reload schema');
