-- 0031: the rainbow and toxic frames.
--
-- A frame is one registry entry in the client plus one spend_catalog row here. The purchase path and
-- equip_cosmetic already accept any frame sku, so this file seeds the products and refreshes the copy
-- of the animated frames. Safe to run twice.

insert into public.spend_catalog (
  sku, kind, price, ref_code, enabled, sort_order,
  name_tr, name_en, desc_tr, desc_en, perks, tag
)
values (
  'frame_rainbow', 'frame', 640, 'rainbow', true, 530,
  'Gökkuşağı çerçevesi', 'Rainbow frame',
  'Avatarının çevresinde dönen, yörüngede ışıldayan gökkuşağı halkası.',
  'A luminous spectrum ring with orbiting sparks around your avatar.',
  '["Animasyonlu gökkuşağı halkası","Yörüngede kıvılcımlar","Tüm profillerde"]'::jsonb,
  'new'
)
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

-- A toxic frame may already exist under an operator-chosen sku; this one is only seeded when the
-- registry key has no product at all, so a shop row is never duplicated.
insert into public.spend_catalog (
  sku, kind, price, ref_code, enabled, sort_order,
  name_tr, name_en, desc_tr, desc_en, perks, tag
)
select
  'frame_toxic', 'frame', 360, 'toxic', true, 540,
  'Toksik çerçevesi', 'Toxic frame',
  'Avatarının çevresinde kaynayan asit halkası.',
  'A boiling acid ring around your avatar.',
  '["Asit halkası","Zehirli kabarcıklar","Tüm profillerde"]'::jsonb,
  'new'
where not exists (
  select 1 from public.spend_catalog c where c.kind = 'frame' and c.ref_code = 'toxic'
)
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

update public.spend_catalog
   set name_tr = 'Kor çerçevesi',
       name_en = 'Ember frame',
       desc_tr = 'Avatarının çevresinde dönen, kıvılcım saçan alev halkası.',
       desc_en = 'A turning ring of flame that sheds embers around your avatar.',
       perks = '["Animasyonlu alev halkası","Yükselen kor kıvılcımları","Kor temasıyla uyumlu"]'::jsonb
 where sku = 'frame_ember';

update public.spend_catalog
   set desc_tr = 'Avatarının çevresinde bükülen ışıktan bir olay ufku.',
       desc_en = 'An event horizon of bent light around your avatar.',
       perks = '["Olay ufku halkası","İçe çekilen yıldız tozu","Tüm profillerde"]'::jsonb
 where sku = 'frame_void';

-- The aurora frame is not seeded here (it may or may not be sold yet), but if an operator created it
-- its copy should describe the ribbons rather than a flat ring.
update public.spend_catalog
   set desc_tr = 'Avatarının çevresinde akan kutup ışığı halkası.',
       desc_en = 'Polar light ribbons flowing around your avatar.',
       perks = '["Animasyonlu kutup ışığı","Parıldayan yıldızlar","Tüm profillerde"]'::jsonb
 where sku = 'frame_aurora';

-- The ember skin gained a smoke pass, a header wash and warm menu surfaces.
update public.spend_catalog
   set desc_tr = 'Yükselen alevler, duman ve köz parçacıklarıyla sıcak bir arayüz.',
       desc_en = 'A warm interface of rising flames, smoke and ember particles.',
       perks = '["Alev ve duman katmanları","Yükselen közler","Sıcak panel kenarları"]'::jsonb
 where sku = 'theme_ember';

-- The toxic skin gained a layer pass (bubbles, hazard rail, acid edges); its shop copy should say so.
update public.spend_catalog
   set desc_tr = 'Asit yeşili paneller, tehlike şeritleri ve yükselen asit kabarcıkları.',
       desc_en = 'Acid-green panels, hazard stripes and rising acid bubbles.',
       perks = '["Tehlike şeritleri","Yükselen asit kabarcıkları","Nabız atan aktif öğe"]'::jsonb
 where sku = 'theme_toxic';
