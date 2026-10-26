-- 0045: the first renewed skin — Kor becomes Ocak / Forge.
--
-- 0.3.2 rebuilds one application skin to the flagship standard instead of tinting it: a molten bath
-- with a seam that travels, a coal bed where every chip cools on its own clock, heat shimmer bands,
-- ash falling while embers rise, and chrome that follows the skin onto card edges, the rail, the
-- scrollbar and the profile name. The registry (packages/shared/src/domain/themes.ts) owns all of
-- that; what the database has to say is the name, the accent it must match, and the shelf copy.
--
-- The key stays `ember`, on purpose. Owners, receipts and `profiles.theme_key` all reference it, so
-- renaming the *display* name is a copy change and nobody loses a skin they paid for. Price stays 180.
--
-- 'renewed' is a marketing chip, not an entitlement: the till's benefit deny-list
-- (`kind <> 'vip' and tag in ('vip','verified','corporate')`) deliberately does not grow, so a renewed
-- product remains exactly as buyable as it was.
--
-- Safe to run twice. Depends on 0022 (theme rows) and 0042 (editor tag normalisation).

-- ------------------------------------------------------------ 1. the new chip in the vocabulary

alter table public.spend_catalog drop constraint if exists spend_catalog_tag_check;
alter table public.spend_catalog add constraint spend_catalog_tag_check
  check (tag in ('none', 'new', 'soon', 'vip', 'verified', 'corporate', 'renewed'));

-- ------------------------------------------------------------ 2. the theme catalogue row

-- The accent must equal the registry's brand token: wallet_summary reads it for the swatch, and a
-- mismatch shows one colour in the picker and another on the window.
update public.profile_themes
   set name_tr = 'Ocak',
       name_en = 'Forge',
       css = jsonb_set(coalesce(css, '{}'::jsonb), '{accent}', '"#ff8a3d"', true)
 where key = 'ember';

insert into public.spend_catalog (
  sku, kind, price, ref_code, enabled, name_tr, name_en, desc_tr, desc_en, perks, tag
)
values (
  'theme_ember', 'theme', 180, 'ember', true,
  'Ocak', 'Forge',
  'Eriyen bir zemin, kendi ritminde soğuyan kömürler ve üstten düşen kül: ateşin beslendiği yer.',
  'A molten floor, coals that each cool on their own clock, and ash falling from above: the forge.',
  '["Eriyen zemin ve dolaşan parlak dikiş","On dört kömür, her biri kendi nabzında","Yükselen kıvılcım, düşen kül","Isı titreşimi bantları ve duman","Kart kenarında ergimiş bant, isimde ateş parlaması"]'::jsonb,
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

-- ------------------------------------------------------------ 3. the editor has to be able to say it

-- 0042 owns this function; it is re-declared here whole, with one widened list, so re-running either
-- file cannot put the two tag vocabularies out of step with the constraint.
create or replace function public.admin_upsert_catalog_item(
  p_sku text,
  p_kind text,
  p_price integer,
  p_ref_code text default null,
  p_duration_hours integer default null,
  p_enabled boolean default true,
  p_sort_order integer default 100,
  p_name_tr text default null,
  p_name_en text default null,
  p_desc_tr text default null,
  p_desc_en text default null,
  p_perks jsonb default '[]'::jsonb,
  p_discount_percent integer default 0,
  p_discount_ends_at timestamptz default null,
  p_tag text default 'none'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sku text := lower(btrim(coalesce(p_sku, '')));
  v_discount integer := coalesce(p_discount_percent, 0);
  -- A benefit tag tells the till "not for sale", so it must not stick to a row that is for sale.
  v_tag text := case
    when p_kind = 'vip' and coalesce(p_tag, 'none') in ('vip', 'verified', 'corporate') then 'none'
    else coalesce(p_tag, 'none')
  end;
begin
  if not app.is_moderator() then raise exception 'FORBIDDEN'; end if;
  if v_sku !~ '^[a-z0-9_]{3,40}$' then raise exception 'SKU_INVALID'; end if;
  if p_kind not in ('badge', 'theme', 'boost', 'cosmetic', 'title', 'frame', 'vip') then raise exception 'KIND_INVALID'; end if;
  if p_price is null or p_price < 0 then raise exception 'PRICE_INVALID'; end if;
  if p_kind = 'boost' and (p_duration_hours is null or p_duration_hours < 1) then raise exception 'DURATION_REQUIRED'; end if;
  if v_discount < 0 or v_discount > 90 then raise exception 'DISCOUNT_INVALID'; end if;
  if v_discount > 0 and p_kind = 'boost' then raise exception 'DISCOUNT_NOT_FOR_BOOSTS'; end if;
  if coalesce(p_tag, 'none') not in ('none', 'new', 'soon', 'vip', 'verified', 'corporate', 'renewed') then raise exception 'TAG_INVALID'; end if;

  insert into public.spend_catalog as c (
    sku, kind, price, ref_code, duration_hours, enabled, sort_order, name_tr, name_en, desc_tr, desc_en, perks,
    discount_percent, discount_ends_at, tag
  )
  values (
    v_sku, p_kind, p_price, nullif(btrim(coalesce(p_ref_code, '')), ''), p_duration_hours,
    coalesce(p_enabled, true), coalesce(p_sort_order, 100),
    nullif(btrim(coalesce(p_name_tr, '')), ''), nullif(btrim(coalesce(p_name_en, '')), ''),
    nullif(btrim(coalesce(p_desc_tr, '')), ''), nullif(btrim(coalesce(p_desc_en, '')), ''),
    coalesce(p_perks, '[]'::jsonb),
    v_discount, p_discount_ends_at, v_tag
  )
  on conflict (sku) do update set
    kind = excluded.kind, price = excluded.price, ref_code = excluded.ref_code,
    duration_hours = excluded.duration_hours, enabled = excluded.enabled, sort_order = excluded.sort_order,
    name_tr = excluded.name_tr, name_en = excluded.name_en,
    desc_tr = excluded.desc_tr, desc_en = excluded.desc_en, perks = excluded.perks,
    discount_percent = excluded.discount_percent, discount_ends_at = excluded.discount_ends_at,
    tag = excluded.tag;

  return jsonb_build_object('sku', v_sku, 'price', p_price, 'kind', p_kind, 'discountPercent', v_discount);
end;
$$;

-- ------------------------------------------------------------ 4. prove it landed

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'spend_catalog_tag_check';
  if v_def is null or v_def not like '%renewed%' then
    raise exception '0045 failed: spend_catalog_tag_check still rejects renewed';
  end if;

  if not exists (
    select 1 from public.spend_catalog where sku = 'theme_ember' and tag = 'renewed' and name_tr = 'Ocak'
  ) then
    raise exception '0045 failed: theme_ember is not the renewed Ocak row';
  end if;

  raise notice '0045 ok: Ocak/Forge is on the shelf with the renewed chip.';
end;
$$;

select pg_notify('pgrst', 'reload schema');
