-- 0.3.9 Faz D: "Gelince haber ver" — bir ürün rafı görmeden önce kuyruğa girilebiliyor.
--
-- `soon` etiketli katalog satırı şu ana kadar çıkmaz bir sokaktı: market killi bir düğme çiziyordu,
-- isteyen kişi bunu söyleyemiyordu, admin de önceliği hangi ürünün olduğunu söyleyecek bir sayı
-- göremiyordu. Bu tablo o sinyalin en küçük hali: kişi başına bir satır, coin yok, bildirim sözü yok —
-- sadece "bu ürün çıkınca ben de buradayım" kaydı ve adminin gördüğü talep sayısı.
--
-- Okuma/yazma hep SECURITY DEFINER fonksiyonlardan: tablo herkese kapalı (0054'ın creator_watch
-- kalıbı), böylece bir başkasının listesini sormak mümkün olmuyor.
--
-- İki kez çalıştırılabilir. Bağımlılıklar: 0001 (app.is_admin), 0003 (spend_catalog),
-- 0027 (tag='soon' + satın alma koruması).

create table if not exists public.product_waitlist (
  user_id uuid not null references public.profiles (id) on delete cascade,
  sku text not null references public.spend_catalog (sku) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, sku)
);

alter table public.product_waitlist enable row level security;

do $$
begin
  execute 'revoke all on table public.product_waitlist from public, anon, authenticated';
end;
$$;

-- ------------------------------------------------------------ 1. the member's side

create or replace function public.join_product_waitlist(p_sku text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tag text;
  v_demand integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select c.tag into v_tag from public.spend_catalog c where c.sku = p_sku;
  if v_tag is null then
    raise exception 'NOT_FOUND: ürün katalogda yok';
  end if;
  -- The queue is only for what the shelf does not carry yet; 0027 already refuses the purchase.
  if v_tag <> 'soon' then
    raise exception 'NOT_UPCOMING: bu ürün şu an rafta';
  end if;

  insert into public.product_waitlist (user_id, sku) values (v_uid, p_sku)
    on conflict (user_id, sku) do nothing;

  select count(*)::integer into v_demand from public.product_waitlist where sku = p_sku;
  return jsonb_build_object('sku', p_sku, 'waiting', true, 'demand', v_demand);
end;
$$;

create or replace function public.leave_product_waitlist(p_sku text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_demand integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  delete from public.product_waitlist where user_id = v_uid and sku = p_sku;

  select count(*)::integer into v_demand from public.product_waitlist where sku = p_sku;
  return jsonb_build_object('sku', p_sku, 'waiting', false, 'demand', v_demand);
end;
$$;

/**
 * One row per upcoming product: whether this member is queued and how many people are. The market page
 * reads this instead of the wallet payload, so the shop's own query did not have to be re-declared.
 */
create or replace function public.product_waitlist()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', c.sku,
           'name', c.name_tr,
           'nameEn', c.name_en,
           'joined', w.user_id is not null,
           'demand', (select count(*)::integer from public.product_waitlist x where x.sku = c.sku)
         ) order by c.sort_order, c.sku), '[]'::jsonb)
    into v_rows
    from public.spend_catalog c
    left join public.product_waitlist w on w.sku = c.sku and w.user_id = v_uid
    where c.tag = 'soon';

  return v_rows;
end;
$$;

-- ------------------------------------------------------------ 2. the admin's side

/** Demand per upcoming product, newest signups first. Handles only — an email is never exported here. */
create or replace function public.admin_product_waitlist()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', c.sku,
           'name', c.name_tr,
           'nameEn', c.name_en,
           'enabled', c.enabled,
           'demand', (select count(*) from public.product_waitlist x where x.sku = c.sku),
           'lastAt', (select max(x.created_at) from public.product_waitlist x where x.sku = c.sku),
           'people', (
             select coalesce(jsonb_agg(jsonb_build_object('handle', p.handle, 'at', w.created_at) order by w.created_at desc), '[]'::jsonb)
               from public.product_waitlist w
               join public.profiles p on p.id = w.user_id
              where w.sku = c.sku
              limit 40
           )
         ) order by (select count(*) from public.product_waitlist x where x.sku = c.sku) desc, c.sku), '[]'::jsonb)
    into v_rows
    from public.spend_catalog c
    where c.tag = 'soon'
       or exists (select 1 from public.product_waitlist x where x.sku = c.sku);

  return v_rows;
end;
$$;

-- ------------------------------------------------------------ privileges

do $$
declare
  v_sig text;
  v_list text[] := array[
    'public.join_product_waitlist(text)',
    'public.leave_product_waitlist(text)',
    'public.product_waitlist()',
    'public.admin_product_waitlist()'
  ];
begin
  foreach v_sig in array v_list loop
    if to_regprocedure(v_sig) is null then
      raise exception '0057 failed: % missing', v_sig;
    end if;
    execute format('revoke execute on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end;
$$;

-- ------------------------------------------------------------ prove it landed

do $$
declare
  v_def text;
  v_rls boolean;
begin
  if to_regclass('public.product_waitlist') is null then
    raise exception '0057 failed: product_waitlist table is missing';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.product_waitlist'::regclass and contype = 'p'
  ) then
    raise exception '0057 failed: the queue has no (user, sku) primary key, so a double join is possible';
  end if;

  select c.relrowsecurity into v_rls from pg_class c where c.oid = 'public.product_waitlist'::regclass;
  if v_rls is not true then
    raise exception '0057 failed: product_waitlist is not RLS-protected';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'join_product_waitlist';
  if v_def not like '%NOT_UPCOMING%' then
    raise exception '0057 failed: the join path no longer refuses a product that is already on the shelf';
  end if;

  if has_function_privilege('anon', 'public.product_waitlist()', 'EXECUTE') then
    raise exception '0057 failed: anon can read the queue';
  end if;

  if not has_function_privilege('authenticated', 'public.admin_product_waitlist()', 'EXECUTE') then
    raise exception '0057 failed: the admin read is not callable by a signed-in member (app.is_admin gates it)';
  end if;

  raise notice '0057 ok: beklenen ürün artık kuyruğa girilebiliyor; admin talep sayısını ve son 40 kişiyi görüyor.';
end;
$$;

select pg_notify('pgrst', 'reload schema');
