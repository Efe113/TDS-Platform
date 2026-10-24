-- 0028: the overlay gets cosmetics you can own.
--
-- The overlay is where the product is actually used, so its paid extras are the ones a player sees
-- every match: a glowing card, a scan texture, a step counter and the right to skin the overlay with
-- the purchased app theme. All four are ordinary `cosmetic` catalogue rows; ownership is derived from
-- spend_orders like every other cosmetic, and the editor asks one RPC which ones are owned.

insert into public.spend_catalog (sku, kind, price, ref_code, enabled, sort_order, name_tr, name_en, desc_tr, desc_en, perks)
values
  ('overlay_glow', 'cosmetic', 300, 'overlay_glow', true, 610,
   'Parlayan kart', 'Glowing card',
   'Overlay kartına marka renginde bir ışık halkası ekler.',
   'Adds a brand-coloured light ring around the overlay card.',
   '["Overlay kartında ışık halkası","Tema rengini izler","Oyun içinde görünür"]'::jsonb),
  ('overlay_scan', 'cosmetic', 350, 'overlay_scan', true, 620,
   'Tarama dokusu', 'Scan texture',
   'Kartın üzerine ince, teknik bir tarama dokusu bindirir.',
   'Overlays a fine technical scan texture on the card.',
   '["İnce tarama dokusu","Teknik görünüm","Göz yormaz"]'::jsonb),
  ('overlay_counter', 'cosmetic', 200, 'overlay_counter', true, 630,
   'Adım sayacı', 'Step counter',
   'Kartın başlığında 19/32 gibi bir sayaç rozeti gösterir.',
   'Shows a 19/32 counter badge in the card header.',
   '["Başlıkta sayaç rozeti","Tek bakışta ilerleme","Oyun içinde görünür"]'::jsonb),
  ('overlay_theme_bind', 'cosmetic', 150, 'overlay_theme_bind', true, 640,
   'Overlay teması', 'Overlay theme',
   'Sahip olduğun uygulama temasının renklerini overlay kartına taşır.',
   'Brings your app theme colours onto the overlay card.',
   '["Overlay satın aldığın temayla uyumlu","Kart, marka ve ilerleme renkleri","Kapatılabilir"]'::jsonb)
on conflict (sku) do update set
  kind = excluded.kind, price = excluded.price, ref_code = excluded.ref_code,
  enabled = excluded.enabled, sort_order = excluded.sort_order,
  name_tr = excluded.name_tr, name_en = excluded.name_en,
  desc_tr = excluded.desc_tr, desc_en = excluded.desc_en, perks = excluded.perks;

create or replace function public.overlay_entitlements()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(distinct c.ref_code), '[]'::jsonb)
    from public.spend_orders o
    join public.spend_catalog c on c.sku = o.sku
   where o.user_id = auth.uid()
     and o.status = 'filled'
     and c.kind = 'cosmetic'
     and c.ref_code like 'overlay\_%';
$$;

do $$
declare
  v_sig text := 'public.overlay_entitlements()';
begin
  revoke execute on function public.overlay_entitlements() from public, anon;
  grant execute on function public.overlay_entitlements() to authenticated;
  if to_regprocedure(v_sig) is null then
    raise notice '0028: overlay_entitlements missing?';
  end if;
end;
$$;

do $$
begin
  raise notice '0028: overlay cosmetics (glow, scan, counter, theme bind) are on sale.';
end;
$$;
