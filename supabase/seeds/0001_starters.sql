-- Starter seeds. Safe to re-run (everything is `on conflict do nothing`).
-- The catalog is intentionally incomplete: towers/maps the parser could not resolve land in
-- `import_unmatched`, and the admin panel closes those gaps over time.

-- User-curated catalog: only towers that actually exist in TDS. `rifleman`, `field-medic`,
-- `gunner`, `slimer`, `bomber` and `cannon` were initial guesses and were removed on purpose —
-- squad compositions like `[3 Rifleman, 1 Field Medic]` are step `spec` text, not tower inventory.
insert into public.towers (key, name_en, name_tr, alias)
values
  ('operator', 'Operator', 'Operatör', '["operator","operators","operatör"]'::jsonb),
  ('shotgunner', 'Shotgunner', 'Pompacı', '["shotgunner","shotgunners","pompacı"]'::jsonb),
  ('executioner', 'Executioner', 'Cellat', '["executioner","executioners","cellat"]'::jsonb),
  ('commander', 'Commander', 'Komutan', '["commander","commanders","komutan"]'::jsonb),
  ('merc-base', 'Merc Base', 'Paralı Üs', '["merc base","merc bases","mercbase"]'::jsonb),
  ('dj-booth', 'DJ Booth', 'DJ Kabini', '["dj booth","djbooth","dj"]'::jsonb),
  ('juggernaut', 'Juggernaut', 'Juggernaut', '["juggernaut","juggernauts"]'::jsonb),
  ('soldier', 'Soldier', 'Asker', '["soldier","soldiers"]'::jsonb),
  ('sniper', 'Sniper', 'Keskin Nişancı', '["sniper","snipers"]'::jsonb),
  ('ranger', 'Ranger', 'Avcı', '["ranger","rangers"]'::jsonb),
  ('minigunner', 'Minigunner', 'Minigunner', '["minigunner","minigunners","minigun"]'::jsonb),
  ('engineer', 'Engineer', 'Mühendis', '["engineer","engineers","mühendis"]'::jsonb),
  ('medic', 'Medic', 'Medik', '["medic","medics"]'::jsonb)
on conflict (key) do nothing;

insert into public.tags (key, kind, name_tr, name_en)
values
  ('grind', 'grind', 'Coin grind', 'Coin grind'),
  ('solo', 'mode', 'Solo', 'Solo'),
  ('duo', 'mode', 'Duo', 'Duo'),
  ('trio', 'mode', 'Trio', 'Trio'),
  ('quad', 'mode', 'Quad', 'Quad'),
  ('event', 'event', 'Etkinlik', 'Event'),
  ('no-skill-tree', 'style', 'Skill tree yok', 'No skill tree'),
  ('fast', 'style', 'Hızlı bitir', 'Fast clear')
on conflict (key) do nothing;

insert into public.currency_rules (code, kind, amount, unit, daily_cap, weekly_cap, min_qualifying_seconds, min_steps, params)
values
  ('usage_session', 'usage', 3, 'per_qualifying_session', 12, 60, 180, 5, '{"decay_after_sessions": 4}'::jsonb),
  ('publish_bonus', 'publish', 20, 'per_approved_version', 60, 200, null, null, '{}'::jsonb),
  ('approval_bonus', 'approval', 50, 'per_first_approval', null, 250, null, null, '{}'::jsonb)
on conflict (code) do nothing;

insert into public.badge_metrics (metric, source_table, operators, description)
values
  ('sessions_qualified', 'stat_user_rollup', '{gte}', 'Kalifiye overlay oturumu sayısı'),
  ('steps_completed', 'stat_user_rollup', '{gte}', 'Toplam ilerlenen adım'),
  ('strategies_published', 'stat_user_rollup', '{gte}', 'Onaylanmış yayınlanan strateji'),
  ('imports_completed', 'stat_user_rollup', '{gte}', 'Tamamlanan içe aktarma'),
  ('distinct_maps', 'stat_user_rollup', '{gte}', 'Farklı haritada kullanım'),
  ('active_days', 'stat_user_rollup', '{gte}', 'Aktif gün'),
  ('streak', 'stat_user_rollup', '{gte}', 'Gün serisi'),
  ('upvotes_received', 'stat_user_rollup', '{gte}', 'Alınan faydalı oy'),
  ('comments_count', 'stat_user_rollup', '{gte}', 'Yazılmış, silinmemiş yorum')
on conflict (metric) do nothing;

insert into public.badge_definitions (code, name_tr, name_en, desc_tr, tier, conditions, award_mode, currency_reward)
values
  ('first_steps', 'İlk Adımlar', 'First Steps', 'İlk kalifiye strateji oturumunu tamamladın.', 'bronze',
   '{"all_of":[{"metric":"sessions_qualified","op":"gte","value":1}]}'::jsonb, 'auto', 10),
  ('weekly_warrior', 'Hafta Savaşçısı', 'Weekly Warrior', '5 farklı stratejiyi sonuna kadar takip et.', 'silver',
   '{"all_of":[{"metric":"steps_completed","op":"gte","value":150}]}'::jsonb, 'auto', 60),
  ('map_surveyor', 'Harita Kaşifi', 'Map Surveyor', '3 farklı haritada kalifiye oturum.', 'silver',
   '{"all_of":[{"metric":"distinct_maps","op":"gte","value":3}]}'::jsonb, 'auto', 80),
  ('strategy_author', 'Strateji Yazarı', 'Strategy Author', 'Onaylanmış ilk stratejini yayınladın.', 'gold',
   '{"all_of":[{"metric":"strategies_published","op":"gte","value":1}]}'::jsonb, 'auto', 100),
  ('useful_voice', 'Faydalı Ses', 'Useful Voice', 'Yorumların topluluktan 10 faydalı oy aldı.', 'silver',
   '{"all_of":[{"metric":"upvotes_received","op":"gte","value":10}]}'::jsonb, 'auto', 80),
  ('contributor', 'Katkıda Bulunan', 'Contributor', '20 yorumla stratejilere tartışma açtın.', 'bronze',
   '{"all_of":[{"metric":"comments_count","op":"gte","value":20}]}'::jsonb, 'auto', 40)
on conflict (code) do nothing;

insert into public.profile_themes (key, name_tr, price, css)
values
  ('default', 'Varsayılan', 0, '{"accent":"#4f9cff"}'::jsonb),
  ('ember', 'Kor', 180, '{"accent":"#ff7a45"}'::jsonb),
  ('toxic', 'Toksik', 220, '{"accent":"#7ed957"}'::jsonb)
on conflict (key) do nothing;

insert into public.spend_catalog (sku, kind, price, ref_code)
values
  ('theme_ember', 'theme', 180, 'ember'),
  ('theme_toxic', 'theme', 220, 'toxic'),
  ('boost_72h', 'boost', 500, null),
  ('badge_strategy_author', 'badge', 1200, 'strategy_author')
on conflict (sku) do nothing;
