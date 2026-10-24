-- 0022: two new skins in the catalogue, and the price ladder made honest.
--
-- The visual definition of every skin lives in the app (packages/shared/src/domain/themes.ts): a
-- jsonb column cannot carry a canvas scene or a motion signature. What the database has to know is
-- only that the skin exists, what it is called, and what it costs - select_theme validates ownership
-- against these rows, so without them the new skins cannot be bought or selected at all.
--
-- Accent values match the registry's brand token exactly. wallet_summary reads the accent from here
-- for the swatch, and a mismatch would show one colour in the picker and another on the window.
--
-- Prices: ember 180 and toxic 220 already exist. aurora (320) and void (420) are priced above them
-- because they add layers the cheaper skins do not have - ribbons with a conic card edge, and a
-- three-plane parallax starfield with grain.

-- ------------------------------------------------------------ 1. theme rows

insert into public.profile_themes (key, name_tr, name_en, price, css)
values
  ('default', 'Varsayılan', 'Default', 0, '{"accent":"#4c8dff"}'::jsonb),
  ('ember',   'Kor',        'Ember',   180, '{"accent":"#ff7a45"}'::jsonb),
  ('toxic',   'Toksik',     'Toxic',   220, '{"accent":"#7ed957"}'::jsonb),
  ('aurora',  'Kutup',      'Aurora',  320, '{"accent":"#38bdf8"}'::jsonb),
  ('void',    'Boşluk',     'Void',    420, '{"accent":"#a78bfa"}'::jsonb)
on conflict (key) do update set
  name_tr = excluded.name_tr,
  name_en = excluded.name_en,
  -- The catalogue row owns the price, so re-running this migration can retune it without a new file.
  price = excluded.price,
  css = excluded.css;

-- ------------------------------------------------------------ 2. purchasable skus

-- spend_catalog.price is `check (price > 0)`, so the free skin is deliberately absent: "default" is
-- selected, never bought.
insert into public.spend_catalog (sku, kind, price, ref_code)
values
  ('theme_ember',   'theme', 180, 'ember'),
  ('theme_toxic',   'theme', 220, 'toxic'),
  ('theme_aurora',  'theme', 320, 'aurora'),
  ('theme_void',    'theme', 420, 'void')
on conflict (sku) do update set
  price = excluded.price,
  ref_code = excluded.ref_code,
  enabled = true;

-- ------------------------------------------------------------ 3. what landed

do $$
declare
  v_themes integer;
  v_skus integer;
begin
  select count(*) into v_themes from public.profile_themes where key in ('default', 'ember', 'toxic', 'aurora', 'void');
  select count(*) into v_skus from public.spend_catalog where kind = 'theme';
  raise notice '0022: % of 5 theme rows present, % purchasable theme skus', v_themes, v_skus;
end;
$$;
