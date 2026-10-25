# Changelog

Tüm önemli değişiklikler bu dosyada tutulur. Sürümler [GitHub Releases](https://github.com/Efe113/TDS-Platform/releases) üzerinden yayınlanır.

## [Yayınlanmamış]

### Eklendi

- **Admin ekonomi kolları (0038):** üye başına rozet ver/geri al ve notla manuel bakiye ver/al.
  `admin_adjust_balance`, `admin_award_rule`, `admin_user_badges`, `admin_award_badge`,
  `admin_revoke_badge` RPC'leri eklendi; her hareket normal bir defter satırı (hash zinciri,
  `currency_balance_cache` ve negatif bakiye yasağı korunur) ve `admin_audit_log`'a yazılıyor.
- **Kural editörü tamamlandı:** İngilizce ad, Türkçe/İngilizce açıklama ve simge seçici (33 lucide
  simgesi) alanları geldi; `currency_rules.icon` 0029'dan beri ölü duruyordu, artık yazılıp okunuyor.
- **12 kazanç türü, 17 birim:** iş türü (`kind`) ile muhasebe türü (`ledger_kind`) ayrıldı; defterin
  sabit tür sözlüğü bozulmadan event/seri/kilometre taşı/topluluk/davet/meydan okuma/destek
  tanımlanabiliyor. Birimler artık `admin_upsert_rule` tarafından da doğrulanıyor.
- **Rozet simgesi URL:** `badge_definitions.icon_path` ya tam https adresi ya da `strategy-media`
  yolu; yönetici panelinde önizleme ve `badges/<kod>.webp` yüklemesi var, simge profilde ve liderlik
  rafında gerçekten çiziliyor.
- **Doğrulanmış hesap (0037):** ekip onayıyla verilen, satın alınmayan hesap türü. `profiles.is_verified`
  admin-pinned kolon olarak tutulur; `app.guard_profile_columns()` kullanıcıyı kendi hesabını
  doğrulayamaz.
- **Avantajlar:** isim yanında otomatik tik rozeti, yeşil animasyonlu `Doğrulanmış` ünvanı (verilirken
  otomatik kuşanır, geri alınırken temizlenir), profil afişinin açılması, bir ay boyunca tüm ürünlerde
  %10 indirim (VIP %25 ile çarpımsal yığılır) ve kullanıldığı stratejiyi 3 gün öne çıkaran bir kredi.
- **Keşfet:** doğrulanmış yazarların stratejileri normal stratejilerin üstünde sıralanır; "Yalnızca
  doğrulanmış" filtresi, aktif filtre çipi ve facet sayaçları sunucu tarafında.
- **Tik yüzeyleri:** Keşfet kartı (ızgara + liste), strateji detay künyesi, profil başlığı ve liderlik
  (podium, satır, mini raylar, "sen" kartı).
- **Başvuru:** `/verified` sayfası (avantaj vitrini, başvuru formu, durum takibi) ve `account_requests`
  kuyruğu; Admin → Doğrulama kuyruğu bölümünden onay/red, Admin → Kullanıcılar'dan manuel doğrula/geri al.
  Kurumsal hesap aynı tablonun `kind` dalında, sonraki sürümde açılacak.

### Düzeltildi

- **Ödenen boost öne çıkarmıyordu:** `strategies.boost_expires_at` kolonuna hiçbir yerde yazılmıyordu;
  `buy_boost` artık hem satın alma hem kredi kullanımında bu kolonu günceller, yani Keşfet pini gerçekten
  çalışır.
- **Boost fiyatı kasayla raftan farklıydı:** `buy_boost` `spend_catalog.price` kullanıyordu; artık
  `app.effective_price` üzerinden VIP ve doğrulanmış indirimlerini de uygular.
- Rafta indirim yüzdesi ile "−%" iki kez yazılıyordu; kartın sol altındaki tek rozete indirgendi.

### Değişti

- **Haftalık tavan artık uygulanıyor:** `award_currency` sadece günlük tavana bakıyordu; `weekly_cap`
  yazıldığında da kazanç orada duruyor.
- **`decay_after_sessions` gerçek mantığa bağlandı:** eşikten sonraki her aynı-gün kazancı yarıya iner
  (en az 1 coin), yani çiftçilik kuralı kapatmadan kendini söndürür.
- **İçerik politikası:** `img-src` tüm `https:` kaynaklarına açıldı (rozet simgesi URL'si için);
  `http:` istekleri istemci tarafında reddedilir.

### Gereken

- `supabase/migrations/0037_verified_accounts.sql` ve `supabase/migrations/0038_admin_economy_and_badges.sql`
  Supabase dashboard'unda çalıştırılmalı (0035 ve 0036 bekliyorsa onlar önce).

## [0.1.2] — 2026-10-25

### Eklendi

- **Market indirim görünümü:** indirimli ürün, tema, boost ve VIP kartlarında orijinal fiyat üstü çizili, indirimli fiyat vurgulu ve kartın sol altında “İndirim %X” rozeti gösteriliyor; indirim bitiş zamanı korunuyor.
- **Yenilenen ünvan tasarımı:** profil, liderlik ve market yüzeylerinde ortak `TitleBadge` bileşeni; kırpılmış rozet formu, iç parlaklık, yavaş ışık kayması ve boyut varyantları.
- **Animasyonlu VIP ünvanı:** VIP üyelere özel `vip_rainbow` ünvanı; akan gökkuşağı kenarlık, gökkuşağı metin ve altın taç nabzı. `prefers-reduced-motion` için sabit varyant.
- **SQL 0036:** VIP ünvanını kataloğa ekler; `wallet_summary` ve `equip_cosmetic` VIP sahipliğini satın alma olmadan tanır.

### Notlar

- VIP ünvanının katalogda ve profilde görünmesi için `supabase/migrations/0036_vip_title.sql` (ve henüz çalıştırılmadıysa `0035`) Supabase dashboard'da uygulanmalı.
- Gökkuşağı VIP ünvanı yalnızca yetkiyle gelir; `spend_currency` VIP etiketli ürünleri satın almaya kapalıdır.
- Bu sürüm hâlâ **imzasız**; SignPath Foundation onayı bekleniyor.

## [0.1.1] — 2026-10-24

### Eklendi

- Markalı, animasyonlu NSIS kurulum sihirbazı: altı karelik karşılama animasyonu, özel header/sidebar, modern bitiş ekranı ve “şimdi başlat” seçeneği.
- Installer sanatı için `npm run installer:art` üretim hattı (SVG → 24-bit BMP).
- MIT lisansı; SignPath Foundation açık kaynak imza başvurusu için uygun zemin.

### Bilinen sınırlar

- Bu sürüm hâlâ **imzasız**; SignPath Foundation başvurusu/onayı tamamlanmadı.
- NSIS sihirbazındaki animasyon kare tabanlıdır; kurulum çıkarma sayfası `/S` otomatik güncelleme güvenliği için bilinçli olarak stock MUI akışında bırakıldı.

## [0.1.0] — 2026-10-24

İlk resmi sürüm.

### Eklendi

- **Aktarım konsolu:** Google Docs, `.md` dosyası ve yapıştırılan metin; kaynak geçmişi, otomatik kayıt, hazırlık skoru ve canlı doğrulama raporu.
- **Adım editörü:** 30+ araç; adım ekleme/çoğaltma/silme/sıralama, kalite bayrakları, arama, kopyalama, adım dağılımı ve overlay birebir önizlemesi.
- **Yayın ön kontrolü:** künye/etkinlik kontrolleri, kendi yayınlarında isim çakışması uyarısı, oturum kontrolü ve moderasyon kuyruğuna gönderim.
- **Overlay:** oyun üstü adım takibi, global kısayollar, oturum/outbox sayacı, canlı geometri ve tema bağları.
- **Keşfet ve detay:** filtre/facet paneli, kaydetme, karşılaştırma, yorum, puan, şikayet ve moderasyon.
- **Liderlik hub’ı:** strateji/oyuncu tabloları, farklı pencereler ve metrikler, takip listesi, “bana yakın” ve hareket edenler.
- **Profil, kozmetik ve VIP:** avatar/afiş, rozetler, 5 tema, kor/gökkuşağı/kutup/boşluk/toksik çerçeveler, VIP özel arka planı ve VIP market indirimi.
- **Cüzdan ve market:** coin ekonomisi, boost/tema/çerçeve paketleri, VIP satın alma, append-only ledger.
- **Ayarlar konsolu:** masaüstü davranışları, monitör seçimi, kısayollar, ölçek/yüksek kontrast, yedekleme ve tanılama.
- **Admin:** katalog CRUD, **toplu kule/harita/modifier içe aktarma**, modifier kat sayısı, moderasyon kuyruğu, rozet ve ekonomi araçları.
- **Otomatik güncelleme:** GitHub Releases tabanlı electron-updater; açılışta kontrol, arka planda indirme ve yeniden başlat/uygula.
- **Release hattı:** `npm run dist` (imzasız NSIS + `latest.yml` + blockmap) ve `GH_TOKEN` ile `npm run release:win`.

### Düzeltildi

- Ayarlar sayfasında bir alanı değiştirince diğer alanların varsayılana dönmesi (Zod `.partial()` + `.default()` kütle sıfırlaması) giderildi; yazma patch şemaları varsayılansız hale getirildi.
- Overlay geometri/tema değişikliklerinin canlı pencereye yansımaması düzeltildi.
- İçe aktarma hatalarının mevcut çalışma taslağını silmesi engellendi; başarısız denemeler ayrı raporlanıyor.
- Harita eşleşmesi en uzun katalog anahtarını seçecek şekilde düzeltildi.

### Bilinen sınırlar

- Windows x64 dışında paket yok.
- Kurulum/güncelleme imzasız; SmartScreen “tanınmayan yayıncı” uyarısı gösterebilir.
- Topluluk ve hesap özellikleri Supabase bağlantısı gerektirir.
- Bu sürümde kule/harita/modifier seed’leri TDS wiki temellidir; yeni oyun güncellemelerinden sonra admin kataloğundan düzenlenmelidir.
