# Changelog

Tüm önemli değişiklikler bu dosyada tutulur. Sürümler [GitHub Releases](https://github.com/Efe113/TDS-Platform/releases) üzerinden yayınlanır.

## [Yayınlanmamış]

### Düzeltildi

- **VIP satın alınamıyordu (0042):** canlı `vip_lifetime` satırı `tag='vip'` taşıyordu; kasadaki
  "avantaj etiketi satılmaz" kuralı üyelikin kendisini de vurduğu için "VIP ol" herkezde
  `BENEFIT_ONLY` ile dönüyordu ve kart fiyatı göstermiyordu. Artık `kind` gerçek, `tag` sadece çip:
  `spend_currency` `kind='vip'` satırını avantaj red listesinden muaf tutuyor, canlı satırın çipi
  temizleniyor ve Market editörü aynı etiketi üyelik satırına yeniden yapıştıramıyor. Migration
  tek başına yeterli — kurulu 0.2.0 istemcisi VIP'i satmaya devam eder.

### Gereken

- `supabase/migrations/0042_vip_membership_is_a_product.sql` (0039 → 0040 → 0041 sırasının ardından).

## [0.2.0] — 2026-10-25

### Eklendi

- **Kurumsal hesap (0040):** doğrulanmışın üstü, satın alınmayan ikinci hesap türü. Stüdyo/ekip/
  topluluklar için; `profiles.is_corporate` admin-pinned kolon, `app.corporate_write` kaçış anahtarı.
  Kurumsal hesap otomatik olarak doğrulanmışın da üstüdür: `app.verified_active()` artık
  `is_verified or is_corporate` döner, böylece 0037 ile kurulmuş her tik yüzeyi kurumları da kapsar.
- **Avantajlar:** altın animasyonlu `Kurumsal` ünvanı (yeşil ünvanın yerini alır, geri alınınca
  doğrulanmışsa ona döner), gökkuşağı çerçevesi ve özel profil arka planı + afiş (VIP'in görsel zemini,
  satın alma olmadan), 60 gün boyunca tüm ürünlerde %20 indirim (doğrulamanın %10'unun üstüne binmez,
  yerini alır; VIP %25 ile çarpımsal) ve üç adet 7 günlük öne çıkarma kredisi.
- **Öne çıkarma kredisi tek kapıdan iki cep:** `claim_verified_boost` kurumsal krediyi önce harcar ve
  168 saat veriyor; doğrulanmış kredi 72 saatte kaldı. Sonuç artık hangi SKU'dan harcandığını da söylüyor.
- **Keşfet sırası ve sayacı:** kurumsal yazarlar doğrulanmışın da üstünde; `search_strategies`
  `author_corporate` kolonunu döndürüyor, `discover_facets` artık `verified` ve `corporate` kovası
  sayıyor ve "Yalnızca doğrulanmış" düğmesi kaç strateji üreteceğini gösteriyor.
- **/kurumsal başvuru sayfası:** doğrulama sayfasıyla tek ortak başvuru bileşeni (avantaj vitrini,
  form, durum takibi), sidebar'da ayrı giriş; Admin → Doğrulama kuyruğunda tür filtresi ve kurumsal
  onayının ne verdiği görünüyor. Onay artık sadece karar kaydı yazmıyor, yetkiyi de tanıyor.
- **Admin ekonomi kolları (0041):** `admin_reconcile_balance` ve `admin_reconcile_drift` önbellek
  bakiyesini defter toplamından yeniden hesaplıyor (`verify_balance` yalnız karşılaştırıyordu);
  `admin_refund_order` siparişi `reversed` yapıp coin'i defter satırıyla geri veriyor ve ürünü
  (tema/çerçeve/ünvan/rozet/boost/membership) geri alıyor; `admin_set_vip` ile VIP verme ve geri alma
  (geri alınca gökkuşağı çerçevesi ve `vip_rainbow` ünvanı çıkıyor, paket siparişi de reversed oluyor).
- **Toplu kuyruk kararı:** `admin_queue_bulk` 0026'dan beri vardı ama hiçbir arayüzden çağrılmıyordu;
  strateji kuyruğunda çoklu seçim + onayla/red çubuğu geldi.
- **Satış kayıtları ekranı:** Admin → Market altında sipariş listesi (durum ve SKU filtresi) ve iade
  akışı; iade edilen satır `İade edilmiş` rozetiyle görünüyor.
- **Rozet simgesi artık gerçekten çiziliyor:** `badge_definitions.icon_path` bir simge ADI
  (`badge-check`, `building`) içerdiğinde rafta kırık resim yerine o simge çiziliyor; simge sözlüğüne
  `building` ve `landmark` eklendi.
- **Liderlik tek sorgu:** `leaderboard_hub` tik, kurumsal işareti, ünvan anahtarını ve ünvanın İngilizce
  adını sunucudan döndürüyor; satır başına ikinci bir profil sorgusu kaldırıldı.
- **Dil duyarlı ünvan:** `profile_showcase` artık `titleNameEn` de veriyor; İngilizce arayüzde ünvan
  Türkçe kalmıyor.

### Düzeltildi

- **Market yönetimi avantaj etiketini kaydedemiyordu:** `admin_upsert_catalog_item` kendi liste
  doğrulamasını taşıyordu (`none/new/soon/vip`), bu yüzden arayüzden `verified` ya da `corporate`
  seçmek `TAG_INVALID` ile dönüyordu. Liste artık 0040'taki CHECK ile aynı.
- **0038'deki liderlik gövdesi bozuktu:** iki yerde `b.icon_path$1` yazılmıştı — migration üreten  betiğin `String.replace` yakalama grubu substitute edilememişti. plpgsql gövdesi CREATE sırasında
  geçerli sayıldığı için migration hatasız çalışmış, `leaderboard_hub` ilk çağrıda patlıyordu.
  İki satır düzeltildi ve `check-sql` artık migration metninde başıboş `$1` bırakmıyor.

- **"Bu stratejide zaten etkin bir öne çıkarman var" her yerde çıkıyordu:** `ALREADY_OWNED`,
  `BENEFIT_ONLY`, `NOT_VERIFIED`, `NO_CREDIT`, `COMING_SOON`, `NOT_OWNED`, `NOT_OWNER` ve `NOT_FOUND`
  hepsi tek bir boost cümlesine bağlanmıştı. Her ön ek artık kendi çevirisine sahip; VIP'i zaten olan
  üye tekrar "VIP ol"a basınca kafa karıştıran değil doğru satırı görüyor.
- **VIP zaten sende olsa da satın alma butonu duruyordu (0039):** `spend_currency` üyelik için
  "herhangi bir VIP türü sipariş" sorusunu soruyor, `wallet_summary` ise `owned` bayrağını SKU bazında
  hesaplıyordu. Uyuşmazlık, kasasının reddettiği bir teklifi rafta canlı bırakıyordu. Artık `owned`
  yetkiyle (`app.vip_active`, `app.verified_active`) aynı soruyu soruyor ve gökkuşağı çerçevesi de
  VIP yetkisiyle sahiplenilmiş sayılıyor. İstemci tarafı da `wallet.vip` bayrağını esas alıyor, böylece
  migration öncesi de doğru davranıyor.
- **Bilinmeyen bir katalog etiketi tüm Market sayfasını düşürüyordu:** `verified` etiketi 0037 ile
  veritabanına girdiğinde 0.1.2 istemcisinin katı enum'u parse'ı patlatıyordu. `tag` ve `kind` artık
  tanımadığı değeri görünmez karta indirgiyor; Market yönetimi ekranına da eksik `verified` seçeneği
  eklendi.

### Gereken

- `supabase/migrations/0039_wallet_owned_by_tier.sql`, `0040_corporate_accounts.sql` ve
  `0041_admin_money_hands.sql` sırayla Supabase dashboard'unda çalıştırılmalı. 0040, 0039'un
  `wallet_summary` gövdesini de içeriyor; 0039 çalıştırılmışsa tekrar çalıştırmak zararsız.
  0041, 0038'de bozuk çıkan `leaderboard_hub` gövdesini yeniden yazıyor — 0038 çalışan kurulumlarda
  Sıralama sekmesi 0041 olmadan bozuk kalır.

## [0.1.3] — 2026-10-25

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

### Bilinen sınırlar

- Bu sürüm de **imzasız**; SignPath Foundation onayı bekleniyor, SmartScreen uyarısı normaldir.
- Kurumsal hesap başvuru sayfası bu sürümde yok; `account_requests.kind = 'corporate'` zemini hazır.
- Yeni yüzeyler gerçek bir Windows oturumunda gezilerek doğrulanmadı (kod + sözleşme testleri geçti).

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
