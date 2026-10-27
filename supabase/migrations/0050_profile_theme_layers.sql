-- 0.3.6: the profile themes are rebuilt as five named surfaces.
--
-- The renderer used to paint four fixed spans for every theme and add a fifth only for `nebula`, which
-- meant `slate` was a gradient with a sheen across it and the catalogue could not tell a buyer what a
-- theme actually contains. The registry now lists five surfaces per theme (`layers` in
-- packages/shared/src/domain/cosmetics.ts) and this file sells those five words, so the shelf, the
-- vitrine and the pixels read one vocabulary — the same contract the frames got in 0049.
--
-- Nothing here renames or re-prices an entitlement. `aurum`, `slate` and `onyx` keep price 0 and keep
-- their tier tags: 'renewed' is a marketing chip, and putting it on a benefit row would take that row
-- out of the `tag in ('vip','verified','corporate')` test the till uses to hand products out for free
-- (the trap 0042 closed for VIP and 0049 closed for the rainbow frame). Only the two coin themes move
-- to 'renewed'.
--
-- Safe to run twice. Depends on 0043 (the five `theme_*` rows) and 0045 (the `renewed` tag vocabulary).

-- ------------------------------------------------------------ 1. the chip vocabulary, unchanged list

alter table public.spend_catalog drop constraint if exists spend_catalog_tag_check;
alter table public.spend_catalog add constraint spend_catalog_tag_check
  check (tag in ('none', 'new', 'soon', 'vip', 'verified', 'corporate', 'renewed'));

-- ------------------------------------------------------------ 2. the five themes, five surfaces each

insert into public.spend_catalog (
  sku, kind, price, ref_code, enabled, sort_order,
  name_tr, name_en, desc_tr, desc_en, perks, tag
)
values
  ('theme_aurum', 'cosmetic', 0, 'aurum', true, 410,
   'Aurum profil teması', 'Aurum profile theme',
   'Kazınmış altın yelpazesi, yükselen kıvılcım, erimiş dikiş ve üzerinden geçen parlama.',
   'An engraved gold fan, rising sparks, a molten seam and a sheen crossing all of it.',
   '["Kazınmış ışık yelpazesi","Yükselen kıvılcımlar","Avatar halesi","Üzerinden geçen parlama","Erimiş altın dikiş"]'::jsonb,
   'vip'),
  ('theme_slate', 'cosmetic', 0, 'slate', true, 411,
   'Arduvaz profil teması', 'Slate profile theme',
   'Fırçalanmış yeşil metal, dişli alt hizası ve üzerinde yürüyen doğrulama rayı.',
   'Brushed green metal, a notched base rule and a verification rail walking over it.',
   '["Fırçalanmış metal bandı","Yürüyen doğrulama rayı","Yavaş tek parlama","Dişli alt hizası","Mat tane dokusu"]'::jsonb,
   'verified'),
  ('theme_onyx', 'cosmetic', 0, 'onyx', true, 412,
   'Oniks profil teması', 'Onyx profile theme',
   'Taş kesiti zemin, üstte altın baskı çizgisi, yörüngede altın tozu ve kalın alt hizası.',
   'A cut-stone ground, a printed gold crown, gold dust in orbit and a heavy base rule.',
   '["Taş kesiti zemini","Altın baskı çizgisi","Yörüngedeki altın tozu","Geniş düşük parlama","Kalın alt hizası"]'::jsonb,
   'corporate'),
  ('theme_nebula', 'cosmetic', 1400, 'nebula', true, 413,
   'Nebula profil teması', 'Nebula profile theme',
   'İki bulut farklı hızda sürükleniyor, altında gaz perdesi, üstünde seyrek yıldız ve çekirdek halesi.',
   'Two clouds drift at different speeds over a gas veil, under sparse stars and a core halo.',
   '["İki katman bulut","Ters yönde gaz perdesi","Çekirdek parlaması","Seyrek yıldız alanı","Film greni"]'::jsonb,
   'renewed'),
  ('theme_abyss', 'cosmetic', 2200, 'abyss', true, 414,
   'Abiss profil teması', 'Abyss profile theme',
   'Derinlik ufku, bant bant su ışığı, süzülen zerreler ve soğuk yıldız alanı.',
   'A depth horizon, banded caustic light, sinking motes and a cold star field.',
   '["Derinlik ufku","Bant bant su ışığı","Süzülen zerreler","Soğuk yıldız alanı","Soğuk kenar hizası"]'::jsonb,
   'renewed')
on conflict (sku) do update set
  kind = excluded.kind,
  price = excluded.price,
  ref_code = excluded.ref_code,
  enabled = true,
  sort_order = excluded.sort_order,
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
  v_count int;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'spend_catalog_tag_check';
  if v_def is null or v_def not like '%renewed%' then
    raise exception '0050 failed: spend_catalog_tag_check still rejects renewed';
  end if;

  -- All five showcase themes must be on the shelf, and each must be selling exactly five surfaces.
  select count(*) into v_count
    from public.spend_catalog
   where kind = 'cosmetic'
     and ref_code in ('aurum', 'slate', 'onyx', 'nebula', 'abyss');
  if v_count <> 5 then
    raise exception '0050 failed: only % of the five profile themes have a catalog row', v_count;
  end if;

  if exists (
    select 1 from public.spend_catalog
     where kind = 'cosmetic' and ref_code in ('aurum', 'slate', 'onyx', 'nebula', 'abyss')
       and jsonb_array_length(perks) <> 5
  ) then
    raise exception '0050 failed: a profile theme is not selling five surfaces';
  end if;

  -- The tier themes stay entitlements: 0042 and the till read them by tag, not by price.
  if exists (
    select 1 from public.spend_catalog
     where kind = 'cosmetic'
       and ((ref_code = 'aurum' and (tag <> 'vip' or price <> 0))
         or (ref_code = 'slate' and (tag <> 'verified' or price <> 0))
         or (ref_code = 'onyx' and (tag <> 'corporate' or price <> 0)))
  ) then
    raise exception '0050 failed: a tier-granted theme stopped being a benefit';
  end if;

  if exists (
    select 1 from public.spend_catalog
     where kind = 'cosmetic'
       and ((ref_code = 'nebula' and (price <> 1400 or tag <> 'renewed'))
         or (ref_code = 'abyss' and (price <> 2200 or tag <> 'renewed')))
  ) then
    raise exception '0050 failed: a purchased theme lost its price or its renewal chip';
  end if;

  raise notice '0050 ok: beş profil teması da beş yüzeyle rafta — kademe bağışları olduğu gibi duruyor.';
end;
$$;

select pg_notify('pgrst', 'reload schema');
