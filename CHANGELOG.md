# Changelog

Tüm önemli değişiklikler bu dosyada tutulur. Sürümler [GitHub Releases](https://github.com/Efe113/TDS-Platform/releases) üzerinden yayınlanır.

## [0.3.7] — 2026-10-27

0.3.6'nın saha hataları: biri rafı düşürüyordu, biri üyeye şablon metni gösteriyordu.

### Düzeltildi: etkinlik bandı "Could not load data / rules.0.own" ile çöküyordu

`active_campaigns()` içinde `'own', r.campaign_key = c.key` yazıyordu. Sıradan (etkinliğe doğmamış) bir
kuralda `campaign_key` NULL'dır ve Postgres üç değerli mantığında `NULL = 'x'` sonucu **NULL**'dır,
`false` değil — jsonb bunu JSON `null` olarak yazıyor, şema `boolean` bekliyor, raf çöküyor.
`admin_list_campaigns()`ta da aynı ifade vardı.

- Her iki okuyucu artık `coalesce(r.campaign_key = c.key, false)` diyor.
- Şema `z.boolean().default(false)` yerine `.catch(false)` kullanıyor: `default` yalnız **anahtar
  yokken** çalışır, sunucu anahtarı `null` ile gönderdiğinde o geçerli bir değer gibi görünür. Aynı
  sertleştirme duyurunun `dismissed` / `ackRequired` / `enabled` alanlarına da uygulandı.
- Ödeme yolu etkilenmiyordu (`award_currency` önce `UNKNOWN_RULE` ile çıkıyor); bozulan tek şey raftı.

Aynı ailenin ilk sürümü de bu turda yakalandı: `app.rule_payable_now()` `false` yerine NULL dönüyordu
(eşleşen satır yoksa sorgu satır döndürmez, `coalesce`'e ulaşılamaz) — migration'ın kendi kanıt bloğu
bunu çıkışta yakaladı, `bool_or` ile düzeltildi.

### Düzeltildi: `{time}` ve `{name}` yazıları üyeye aynen basılıyordu

i18next `{{ad}}` kullanır. Tek süslü parantez **hata değildir**: olduğu gibi basılır. Etkinlik bandı
"Bitmesine {time}" / "Ends in {time}", cüzdan çipi "{name} etkinliğinde" / "During {name}" gösteriyordu.
Anahtar var, tip geçiyor, değer geçerli bir cümle — yani araçların hiçbiri göremezdi, yalnız üye görürdü.

16 yer düzeltildi (8 TR + 8 EN): `campaign.endsIn`, `campaign.startsIn`, `wallet.campaignBoost`,
`notice.starts`, `notice.until`, `admin.noticeReads`, `admin.noticeDismisses` ve **`admin.badgesOf`** —
sonuncusu bu turdan değil, Üyeler paneli üyenin adını değil `{name}` yazısını gösteriyordu.

Yeni muhafız `i18n-interpolation.test.ts`: eşlenmemiş süslü parantez yasak, iki dildeki yer tutucu
adları birebir aynı olmak zorunda, ve bu hatayı taşıyan cümleler birebir kilitli.

### Testler

**266 test** (24 dosya), `npm run verify` temiz. Yeni: `i18n-interpolation.test.ts` (3) ve
`campaign.test.ts`de NULL-bayrak sözleşmesi (2) — SQL metninde çıplak eşitlik yasak, `own: null`
artık `false` olarak parse ediliyor.

### Kurulumdan sonra

Uygulama 0.3.7'ye yükselsin; veritabanında 0051 **bir kez daha** çalıştırılmalı (`create or replace
function`, tekrar çalıştırmaya güvenli) — `own` alanını düzelten taraftaki `coalesce` orada.
Beklenen: `0051 ok: etkinlikler tarih penceresiyle yaşıyor — kurallar ya bu pencerede çarpanla ödüyor
ya da kendi kampanyasıyla.`

## [0.3.6] — 2026-10-27

### Yeniden yapıldı: profil temaları artık **beş yüzey**, dört sabit span değil

`aurum / slate / onyx / nebula / abyss` vitrina temaları, çerçevelerin 0049'da aldığı sözleşmeye geçti:
her tema registry'de **beş bildirimsel yüzey** taşır (TR + EN adlarıyla), boyacı listeyi yürür, raf aynı
beş kelimeyi satılır. Eski yapıda boyacı dört sabit span çıkarıp beşinciyi yalnız `nebula` için
ekliyordu — yani bir tema, JSX'te kaç span varsa ancak o kadar yüzeye sahip olabilirdi; arduvaz fiilen
bir yıkamanın üstünden geçen tek parlamaydı ve "beş tema aynı tasarım" gözlemi doğruydu.

| Tema | Önder yüzey (imza şekli) | Beş yüzey |
|---|---|---|
| Aurum (VIP) | `fan` — kartın altından açan kazınmış yelpaze | yelpaze · yükselen kıvılcım · avatar halesi · üzerinden geçen parlama · erimiş altın dikiş |
| Arduvaz (doğrulanmış) | `brush` — fırçalanmış metal bandı | bant · yürüyen doğrulama rayı · yavaş tek parlama · dişli alt hizası · mat tane |
| Oniks (kurumsal) | `facet` — taş kesiti | kesit · altın baskı çizgisi · yörüngede altın tozu · geniş düşük parlama · kalın alt hıza |
| Nebula (1400) | `cloud` — iki katman bulut | bulut · ters yönde gaz perdesi · çekirdek parlaması · seyrek yıldız · film greni |
| Abiss (2200) | `depth` — derinlik ufku | ufuk · bant bant su ışığı · süzülen zerreler · soğuk yıldız · soğuk kenar hizası |

Renk change edilmedi, **silüet** değişti: onsekiz yüzey tarifinin beş imza zemini birbirinden ayrı, ve
renkleri registry'den gelen custom-property'ler taşıyor. Maliyet kuralı aynı: hareketli yüzey yalnız
`transform`/`opacity` animasyonu yapar; blur, `backdrop-filter` ve animasyonlu `background-position` yok;
yürüyen desenler (su bandı, doğrulama rayı) bir periyot kadar ötelenen taşmış levhalardır. Kademe bütçesi
yalnız hareketli yüzeyleri sayar; vitrin önizlemesi ekran dışına çıkınca durur.

- Market rafında her tema kutusu artık **vitrin**: sol tarafta kart örneği, sağda beş yüzeyin adı.
- `0050_profile_theme_layers.sql` beş `theme_*` satırının `perks`'ını bu beş etiketle yeniler.
  Aurum/slate/onyx **kademe bağışı** olarak 0 fiyatta ve kendi etiketinde (`vip`/`verified`/`corporate`)
  kalır — `renewed` çipi kasanın fayda listesinden satırı düşürürdü; yalnız nebula (1400) ve
  abyss (2200) `renewed`a geçer.

### Yeni: **etkinlik sistemi** — kazanım kuralları artık tarih penceresiyle ödüyor

`currency_rules`da tarih alanı yoktu; "bu hafta sonu çift coin" kampanyası ya elle her kuralı
düzenleyip sonra geri almayı ya da birinin `flat_once` kuralını elle ateşlemesini gerektiriyordu, ve
`award_currency()` kuralda ne yazıysa **sonsuza dek** ödüyordu.

- `campaigns`: ad + kısa satır TR/EN, opsiyonel uzun gövde, **başlangıç/bitiş**, yüzey (bant | modal),
  vurgu rengi, görsel, bağlantı. Pencere CHECK'i, `#rrggbb` CHECK'i ve bağlantı şeması CHECK'i
  veritabanında (`https://` ve `tdsapp://` yalnız).
- `campaign_rules`: mevcut kurala **çarpan** (0.1–5'te sınırlı) ya da **sabit miktar** ya da ayrı günlük
  tavan. Kural kimliğini korur; defter geçmişi ve cüzdan listesi çalışmaya devam eder.
- `currency_rules.campaign_key`: o etkinlik için doğmuş kural. Pencere dışında **sessiz** — 0 döner,
  `UNKNOWN_RULE` vermez (çağıranlar kullanım ve inceleme tetikleyicileri, insan değil).
- `app.campaign_overlay_for_rule()` tek karar yeri: kuralın kendi kampanyası başkasını ezer; eşitler
  arasında en erken başlangıç kazanır, böylece çakışan iki kampanya ×4'e çıkmaz.
- **Tavan yine kuralla gelir:** `p_amount` üyenin hak ettiği, kural (ya da çarpanı) tek olayın tavanıdır.
  Haftalık tavan ve `decay_after_sessions` aynen duruyor — çift hafta sonu, sonsuz hafta sonu olmaz.
- Uygulama üstünde **bant**: ad, canlı/yakında çipi, ilk yükseltilmiş kural + çarpan, mutlak tarihler ve
  kalan süre, ayrıntı düğmesi, kapatma. Modal yüzeyi seçilen etkinlik açılışta kendisi gelir (kampanya
  başına bir kez).
- **Cüzdan** kazanım listesini aynı etkinlikten okur: çarpanlı kurallarda efektif miktar, üstü çizili
  temel miktar ve kampanyanın tavanı gösterilir. Temel tavanı göstermek, sunucu hâlâ öderken üyeye
  "hakkın bitti" demek olurdu.
- **Düzeltme:** `admin_upsert_rule` (0038) olduğu gibi bırakıldı — tür/birim/tavan doğrulamaları iki
  kopyaya bölünmesin; bağlama işi ayrı kol `admin_set_rule_campaign`. Bir etkinlik silinince kendi
  kuralları **kapatılır**, silinmez (defter o kodları zaten referans alıyor).
- `0051_campaigns.sql`. Ad çakışması bilinçli: `public.events` TDS'nin oyun içi etkinlik kataloğu
  (0001) ve `strategies.event_key` ona bağlı; bu bir promosyon, harita modifier'ı değil.

### Yeni: **duyuru sistemi** — uygulama artık konuşmadan önce de sözü var

Platformun tek sesi bakımdı ve o yalnız "yazımlar kapalı" diyebiliyordu. Bakiye onarımı, moderasyon
gecikmesi, yeni bir kural ya da cumartesi açılacak etkinlik anlatılacak yer bulamıyordu.

- Tür: **bilgi / uyarı / kritik**. Görünüm: **bant** (kısa bilgi + tür çipi + kapama) ya da **modal**
  (resim + ayrıntılı metin). Başlık ve bant satırı TR/EN, uzun metin opsiyonel, tarih aralığı ve
  opsiyonel bağlantı.
- Modal, uzun metin ya da resim yoksa **kaydedilmez**: ikisi de yoksa bu zaten bir banttır ve editör
  bunu yüzüne söyler.
- **Kapatma hesapta durur** (`announcement_reads`: `read` | `dismissed`); yeniden kurma ya da başka
  makine sonrası aynı bant baştan gelmez. Hesap yoksa (ziyaretçi) istemci yerel düşer.
- `ackRequired`: kritik duyurunun köşe çarpısı yoktur, yalnız **"Anladım"** ile kapanır. Onay istenen
  bir şeyi çarpıyla kapamak kapamak değildir.
- `updated_at` kapatmanın damgasıdır: düzenlenen duyuru farklı bir duyurudur ve yeniden gösterilir.
- **Öncelik tek kuraldır:** bakım → duyuru bandı → etkinlik bandı; aynı anda tek bant, tek modal. Duyuru
  etkinliğe ağır basar çünkü ilki üyenin hesabıyla, ikincisi mağazayla ilgili.
- Etkinlikle bilinçli olarak birleştirilmedi: duyuru kazanım kuralı taşımaz, kampanya da üyeye hikâye
  anlatmaz. İkisini birleştirmek bir "bilgi" notunun ekonomiye dokunabilmesi demekti.
- `0052_announcements.sql`.

### Admin

Kenar rayına iki bölüm: **Etkinlikler** ve **Duyurular**. JSON yok — tarih alanları (giriş/çıkış
çevirimi bakım editörüyle aynı yardımcılara indi), dil çiftleri, tür/yüzey seçimleri, kural satırları
listeden seçilir, görsel yükleme tek nesne üzerine yazar. Her iki editörün önizlemesi çizim değil:
üyenin gördüğü `CampaignBand` / `NoticeBand` bileşenlerinin kendisi. Hatalar sunucuya gitmeden
adlandırılır (`campaignDraftErrors`, `noticeDraftErrors` RPC'nin reddettiği her şeyi aynı anahtarlarla
söyler).

### Testler ve araçlar

- **260 test** (23 dosya), `npm run verify` temiz. Yeni: `campaign.test.ts` (20: `campaignStateOf` ile
  `app.campaign_state()` aynı açılış/kapanış anını sayar, taslak doğrulayıcı RPC'nin reddettiğini
  önceden adlandırır, para yolu pencereden geçmeden geçemez), `announcements.test.ts` (26: pencere,
  ağırlık sırası, tek-bant kuralı, kapama sözü, kabuk sırası).
- Profil teması sözleşmesi 8 yeni testle kilitli: beş yüzey zorunlu, önder yüzeyler birbirinden farklı,
  her CSS tarifi gerçekten kullanılıyor ve hiçbir tarif sahipsiz değil, `perks` = registry etiketleri,
  kademe bağışlarına `renewed` dokunamıyor.
- `scripts/check-sql.mjs` blok yorumları atlamıyordu: "kampanyanın kazanç sayfası" gibi düz yazıdaki bir
  kesme işaretini string başlangıcı sayıyordu. Yorumlar artık dolar gövdeleri dışında boşlukla
  nötrlense de satır numaraları korunuyor (54 dosya temiz).

### Düzeltildi: 0051 kendi kanıt bloğunda takıldı

İlk sürümde `app.rule_payable_now()` şu biçimde yazılmıştı: `select coalesce(case ... end, false)
from currency_rules where code = ?`. Eşleşen satır yoksa sorgu **satır döndürmez**; satır döndürmeyen
bir sorgunun sonucu NULL'dır ve `coalesce` hiç ulaşılamaz, çünkü birleştirilecek satır yoktur. 0051'in
kendi kanıt bloğu bunu yakaladı (`0051 failed: an unknown rule should not read as payable`) — kanıt
haklıydı, fonksiyon bozuktu. `bool_or` boş kümede NULL verir ve dıştaki `coalesce` onu görür; cevap
artık gerçekten `false`. Ödeme yolu etkilenmiyordu (`award_currency` önce `UNKNOWN_RULE` ile çıkıyor),
ama `app.campaign_live`'ın doğru yazılmış haliyle düz yazının üstündeki bu ifade aynı görünüp farklı
sonuç veren tek ikiliydi. Test sözleşmeyi metinden bağlıyor.

## [0.3.5] — 2026-10-27

### Yenilendi: **Boşluk (Void)** — dördüncüsü ve sonuncusu

Üç katmanlı mor yıkama + tek yıldız alanı yerine **bir yerçekimi kuyusu**:

- **Birikim diski (accretion):** eğik duran, kendi içinde dönen bir disk; üstünde sıcak bir halka
  yürüyor. Disk `transform: rotate()` ile dönüyor — açı animasyonu değil.
- **Kara çekirdek (singularity):** ışığı yutan olay ufku ve onun üstünde nefes alan bir foton
  çizgisi; diskin ortasındaki delik ilk kez gerçek bir delik.
- **Üç derinlikte gaz (nebula):** üç bulut aynı hızda hareket etmiyor, bu yüzden uzaklık okunuyor;
  tek bir yıkama yerine katmanlı gökyüzü.
- **Yörüngeler (orbits):** üç elips, her birinde bir gövde — farklı hızlarda dönen bir güneş saati.
- **Yırtık (rift):** çapraz sızan ışık; `opacity` + `transform` ile açılıp kapanıyor.
- **İki alan, bir tuval:** yıldız alanına karşı toz alanı. Yıldızlar küçük, hızlı ve kırpıyor; toz
  iri, yavaş ve sabit. İkisi de düşmüyor — düşme işini diskin kendisi yapıyor.
- `mesh + grain + vignette` altında sekiz katman, 20 px paralaks, `renewed: true`. Accent `#9d7bff`
  registry brand'iyle eşit; anahtar `void`, fiyat 420 — sahiplik korunuyor.

Kampanya burada bitiyor: **Varsayılan** bilinçli olarak sakin kalacak.

### Optimize edildi: kastırmanın dört sebebi de kapatıldı

Önizlemeler dahil her tema artık aynı kurallara tabi. Ölçülen değil, **yapısal** düzeltmeler:

- **Tek animasyon döngüsü:** her tuval kendi `requestAnimationFrame` zincirini çalıştırıyordu; artık
  hepsi `motion/ticker.ts` içindeki tek tick'e abone oluyor ve kademe başına kare tavanı alıyor
  (low 24 / medium 30 / high 60). Sekme görünmüyorken döngü tamamen duruyor.
- **Parça başına iş kaldırıldı:** renkler ve alfa değerleri tohumlamada önbelleğe alınıyor, palet
  başına sprite bir kez üretiliyor, `shadowBlur` çizim döngüsünden çıktı (yerini önceden çizilmiş
  parlama sprite'ı aldı), DPR 1.5'te sınırlı.
- **Yeniden rasterize eden hiçbir şey yok:** kartlarda ve üst barda `backdrop-filter`, hareketli
  katmanlarda `filter: blur()` ve `mix-blend-mode` kaldırıldı; yumuşaklik gradyan duraklarıyla
  ifade ediliyor. Modal perdeleri ve overlay kartı artık blur yerine opaklık kullanıyor.
- **Yeniden boyayan animasyon yok:** `background-position` / `top` / `box-shadow` ile ilerleyen
  tüm büyük yüzeyler `translate3d` veya `scaleX` taşımasına çevrildi (dikiş, köpük, tarama, perde,
  indirim halkası, profil süpürmesi). `@property --frame-angle` ve `--edge-angle` silindi — açı
  animasyonu, altı çerçeve ve bir liderlik satırı dolusu avataru saniyede altmış kez yeniden
  rasterize ediyordu.
- **Bütçe artık hareket eden katmanları sayıyor:** `vignette`, `grain` ve `grid` duran yüzeyler;
  düşük kademede kesilmiyorlar, çünkü kontrastı tam da ona ihtiyaç duyan kullanıcı koruyor.
- **Önizlemeler ekrandayken çalışıyor:** `useAmbientActive` kapısı ile vitrinden çıkan tema sahnesi
  duruyor; minyatür önizleme 30 kare ve dört hareketli katmanla sınırlı.
- `data-motion='low'` kademe işareti MotionProvider tarafından kök elemana yazılıyor ve CSS tüm
  dönüşleri orada park ediyor.

### Sıfırdan: çerçeveler — hepsi beş katman

Altı çerçeve tek bir makine: **hale · çekirdek · dönüş · kıvılcım · işaret**
(`halo | core | spin | spark | mark`). Tip düzeyinde beşi zorunlu; eksik katman derlenmiyor.

- Halka artık **sabit bir maskenin içinde dönen dairesel gradyan levhası** — altı yüzeyin hepsi
  kompozitörde, hiçbiri yeniden rasterize etmiyor.
- Her efektin kendi hareket imzası ve kendi dönüş süresi var (Ocak 5.2s · Toksik 7.6s · Kutup 8.4s ·
  Gökkuşağı 10s · Boşluk 12s · Altın 16s); Altın ve Gökkuşağı da dahil **altısının da animasyonlu**.
- **`FrameVitrine`:** raftaki her çerçeve artık beş katmanını canlı örneklerle ve **isimleriyle**
  listeliyor; katalog satırındaki `perks` alanı da aynı beş etiketi taşıyor, böylece vitrin ile
  müşteri istemcisi aynı sözlüğü okuyor.
- **Düzeltme:** `frame_aurora` kaydı hiçbir zaman eklenmemişti — registry'de 0031'den beri duruyor,
  rafta görünüyor ama satın alınamıyordu (`equip_cosmetic` NOT_FOUND). 0049 ile gerçek satır: 540.

### SQL

- **`0049_void_theme_and_five_layer_frames.sql`** — Boşluk yenilemesi (ad/fiyat/anahtar korunuyor,
  accent `#9d7bff`), altı çerçevenin beş katmanlı satırı ve `frame_aurora`'nın eklenmesi. Kendi
  kendini doğruluyor: altı satır, `jsonb_array_length(perks) = 5`, Gökkuşağı hâlâ `vip`/0. Etiket
  sözlüğü 0045 ile birebir aynı. İki kez çalıştırılabilir.

### Testler

- **`render-performance.test.ts` (9 yeni test):** kare başına maliyet sözleşmesi artık yazılı — animasyon
  öznitelikleri yalnızca `transform`/`opacity` (+ tek tek listelenmiş ince şeritler), CSS'te blur ve
  `backdrop-filter` yok, renderer'da tek rAF sahibi var, çerçeve motorunun beş yüzeyi ve kademe kapısı
  yerinde.
- Toplam **206 test**, 21 dosya — `npm run verify` temiz.

## [0.3.4] — 2026-10-26

### Yenilendi: **Kutup (Aurora)** — üçüncüsü

Yatay üç bant yerine **kutup gecesi**:

- **Işık perdesi (curtain):** beş dikme perde; her biri kendi eğimi, hızı ve gecikmesiyle dalgalanıyor,
  rengi iki gaz arasında dönüşümlü (camgöbeği / mor). Perdenin içinde **boyuna yürüyen damar doku**
  var — maskenin altta sönmesiyle birlikte bu grain, ışığın bir leke değil perde gibi görünmesini
  sağlıyor.
- **Buz ufku (horizon):** altta keskin bir ufuk çizgisi, çizginin altında yukarı vuran ışık
  kirliliği ve iki yönde sürüklenen soğuk parlama — kutup ışığı gökten değil, buzdan da geliyor.
- **Yıldız desteği (sceneAlt `star`):** gökyüzünde hafif, küçük, iki katmanlı yıldızlar; kurdeleler
  ortada akmaya devam ediyor. Boşluk temasının yoğun üç katmanlı yıldız alanından bilinçli olarak
  daha seyrek — ayrımcı olması için.
- Film grenli zemin + 18 px paralaks; altı katman, `renewed: true` — 0.3.2 kromunu kendi soğuk
  rengiyle alıyor.
- Anahtar `aurora`, fiyat 320: sahiplik korunuyor. Accent `#4fd2ff` registry brand'iyle eşitleniyor.

Sırada bir tek **Boşluk (void)** kalıyor; **Varsayılan** bilinçli olarak sakin kalacak.

### Düzeltildi: her açılışta yeniden giriş

Oturum diske yazılıyordu ama **her açılışta siliniyordu**. `main/auth/manager.ts` state-change
dinleyicisini oturum geri yüklenmeden **önce** kaydediyordu; Supabase istemcisi yeni bir aboneye
her zaman belleğindeki oturumu taşıyan bir `INITIAL_SESSION` olayı gönderiyor ve kalıcılık kapalı
olduğu için o bellek açılışta boş. Eldeki kod "oturum yok"u "çıkış yapıldı" sayıp `session.bin`'i
siliyordu — dosya okuma daha bitmeden. Kanıt: `%APPDATA%\@tds\desktop\auth\` klasörü var ama boş, ve
`main.log` dosyasında tek bir uyarı satırı yok (silme sessiz).

- Abonelik artık `restoreStoredSession()` bittikten **sonra** kuruluyor.
- "Oturum yok" kararı tek saf fonksiyona taşındı: `sessionStorageAction(event, hasSession)` —
  `INITIAL_SESSION`/`USER_UPDATED` boş gelirse dosyaya dokunmuyor, yalnızca `SIGNED_OUT` siliyor.
- Bozuk/eski biçimde yazılmış bir dosya artık sessizce geçmiyor; bir uyarı satırı bırakıyor.
- Test: olay tablosu + "abonelik geri yüklemeden sonra" sıralaması + tek abonelik.

## [0.3.3] — 2026-10-26

### Yenilendi: **Toksik** (second renewal, same standard as Ocak)

Tema yenilemesi artık tek bir temaya özel cilâ değil, bir standart. Toksik eskiden bir tehlike
şeridi + içinde yüzen noktalardı; şimdi bir **sızıntı**:

- **Asit banyosu (sludge):** tabanda çalkalanan havuz, yüzeyde sağa koşan köpük hattı, üç hava
  kanalından yavaşça kabaran buhar, havuzun üstünde yeşil bir pus.
- **Sarkan sıvı (drip):** tavandan yedi damar; her biri kendi hızında uzuyor ve damla kendi
  saatinde kopup tabana düşüyor. CSS keyframe ile çiziliyor — sonsuz damlalar JS tik'i harcamıyor.
- **Çift tarama bandı (scanline):** biri aşağı inen geniş bant, diğeri yukarı çıkan ince parlak hat;
  kesiştikleri yerde cihaz çalışıyor hissi.
- **İki köşede tehlike bandı (hazard):** 45° ve −45° şeritler zıt yönlerde emekliyor; duvar kâğıdı
  değil, canlı bariyer.
- **Patlayan baloncuklar:** yedi kabarcık on biri çıktı, tepeye yakın şişip **patlıyor** — solup
  kaybolmak yerine.
- **Sürünen toz (sceneAlt):** sporlar aşağı düşerken kontaminasyon tozu havada asılı sürükleniyor;
  iki alan tek canvas, tek rAF döngüsü.
- Yedi katman, `renewed: true` — 0.3.2'nin `data-renewed` kromunu (kart dikişi, panel yıkanması, ray
  kıvılcımı, kaydırma çubuğu, isim yanması) token'lar üzerinden kendi asit rengiyle alıyor.
- İsim ve fiyat **değişmedi** (`toxic`, 220): sahipler ne aldıysa onu koruyor. Yenileme bir kopya
  değişikliği, test artık bunu da kilitliyor.

### Kalan temalar

Kutup (aurora) ve Boşluk (void) sıradaki patch'lerde aynı standarta çekilecek; Varsayılan skin bilinçli
olarak sakin kalıyor (ücretsiz olanın görevi dikkat dağıtmamak).

## [0.3.2] — 2026-10-26

### Yenilendi: **Kor → Ocak (Forge)**

İlk kez bir tema renklendirilmedi, baştan çizildi. Ocak artık bir ateş gradyanı değil, bir ocak:

- **Eriyen zemin (crucible):** tabanda nefes alan ergimiş bir banyo ve üzerinde sağa doğru dolaşan
  parlak dikiş; iki ısı kuyusu ayrı ritimlerde parlayıyor.
- **Kor yatağı (coals):** on dört kömür, her biri kendi boyutunda, gecikmesinde ve ritminde
  soğuyor; üçü ara sıra tutuşuyor. Tek bir nabız değil, dağınık bir ateş.
- **Isı titreşimi (shimmer):** soft-light ile yükselen dört bant, farklı genişlik ve hızda.
- **Kül düşüyor (ash):** kıvılcımlar alttan yükselirken üstten kül düşüyor; iki alan tek canvas ve
  tek rAF döngüsünde, bütçe payları oranında bölünüyor.
- **Krom temayla geliyor:** kartların çevresinde dolaşan ergimiş bant, panel tabanında kavrulma,
  raydaki aktif öğeden yükselen kıvılcım, ateş renkli kaydırma çubuğu, odak halkası ve profil
  adında yanma. Kurallar tema adına değil `data-renewed` yeteneğine bağlı — sonraki yenileme
  kendi rengini token'lardan alacak.
- Yedi katman bildiriyor; katman merdiveni (2/4/6) buna yer açacak şekilde yükseltildi, aksi halde
  amiral gemisi ücretsiz temayla aynı üç katmanı çizecekti.
- Anahtar `ember` kaldı: sahipler, makbuzlar ve `profiles.theme_key` korunuyor. Fiyat 180.

### 'Yenilendi' etiketi

- `spend_catalog.tag` sözlüğüne `renewed` eklendi; CHECK ve Market editörü aynı listede tutuluyor
  (test artık bu iki listeyi birebir karşılaştırıyor).
- Etiket bir pazarlama işareti, **avantaj değil**: kasasının red listesi büyümüyor, yani
  yenilenmiş ürün eskisi gibi satılabilir.
- Rafda etiket + katman sayısı şipi; önizleme yenilenmiş temada tam katman yığınını (4 katman)
  ve dikişini çiziyor.

### Bakım sistemi artık bir operasyon

- Tek anahtar yerine pencere: `{enabled, mode, title, note, startsAt, endsAt}`.
- İki mod: **salt okunur** (yazımlar sunucuda reddedilir, uygulama kullanılır) ve **tam kilit**
  (aynı kural + tam ekran kapı, kalan süre ve saat bilgisiyle). Okumalar, overlay ve yerel oyun
  takibi ikisinde de çalışmaya devam ediyor.
- Zamanlama: başlangıç ileri alınırsa bakım **önceden duyurulur**; bitiş dolunca sunucu kendiliğinden
  açılır (cron yok). Bozuk/elle yazılmış zaman damgası "sonsuz açık" olarak okunur, patlamaz.
- Guard artık **insert + update + delete** ve sekiz yüzeyde: `spend_orders`, `user_themes`,
  `strategy_boosts`, `comments`, `ratings`, `favorites`, `account_requests`, `reports`. Önceden dört
  tabloda yalnızca insert engelleniyordu; üye bakım sırasında kendi yorumunu düzenleyebiliyordu.
  Bir BEFORE DELETE tetikleyicisinin `NEW` döndürürse silmeyi sessizce atlayacağı da düzeltildi.
- Reddedilen yazım üyeye **nedenini** söylüyor: band/kapıdaki başlık, trigger'ın attığı mesajla aynı.
- Console'a **Bakım** bölümü geldi: durum, mod denetimi, başlık/not (sayaçlı), başlangıç/bitiş,
  hızlı bitiş düğmeleri (30dk/2s/8s/24s, bitiş yok, hemen başlasın), dondurulan yüzeyler ve
  **gerçek bileşenle canlı önizleme**. Personel kapıda değil — kapı kaldıran kişi kapıda kalamaz.

### Düzeltildi

- **Kuşanılan çerçeve hiçbir yerde görünmüyordu:** 0040 `profile_showcase`'i yeniden yazarken
  `frameKey` çıkış alanını düşürdü, 0043 de o şekli taşıdı. Yazım tarafı baştan beri çalışıyordu
  (canlıda ölçüldü: `profiles.frame_key = 'void'`) ama sunucu alanı hiç göndermediği için istemci
  varsayana düşüyordu — halka yok, "kuşanıldı" işareti yok, tıklama ölü görünüyor. 0044 geri koydu.
- Yeniden yazılan bir okuyucunun alan kaybetmesi sınıfına karşı iki kalıcı kapı:
  `scripts/check-sql-drift.mjs` (`npm run verify` zincirinde; son bildirimin çıplak parantez-eşlemeli
  `jsonb_build_object` anahtarlarını önceki bildirimlerle karşılaştırıyor) ve şemanın her alanının en
  yeni `profile_showcase` çıktısında bulunduğunu doğrulayan test. Negatif fixture ile denendi: 0044
  kaldırıldığında tarayıcı tam olarak `frameKey`'i işaret ediyor.

## [0.3.1] — 2026-10-25

### Düzeltildi

- **Profil teması afişin altında kalıyordu:** katman, üyenin afiş resminin altına çizildiği için afişi
  olan herkeste tema tamamen gizleniyordu (etiket görünüyor, boyama yoktu). Artık tema afişin üstünde
  ve `screen` karışımıyla ışık ekliyor; kart gövdesi tema zeminiyle yıkanıyor, tema halkası avatarın
  dışına ayrı katman olarak düşüyor.
- **Kart avatarında çerçeve halkası çizilmiyordu:** `frameStyle` hiç uygulanmadığı için kuşanma
  çalışsa bile ekranda hiçbir şey değişmiyordu; "hiçbir çerçeveyi kuşanamıyorum" olarak görünen buydu.
  Şimdi statik halka ve animasyonlu bant birlikte çiziliyor.
- **Kişiselleştir perdesinin önizlemeleri gerçek:** çerçeve kutusunda ref yazısı yerine mini avatar
  üstünde FrameRing + halka, tema kutusunda tema zemini + mini avatar, ayrıca "başkaları böyle
  görüyor" bloğu (yorum satırı ve keşfet yazar satırı mock'u) — ikinci bir hesap gerekmiyor.
- Kuşanma sonrası hata/başarı satırı satırların üstüne taşındı; sunucunun gerekçesi artık tıklamanın
  hemen altında okunuyor.

## [0.3.0] — 2026-10-25

### Eklendi

- **`tdsapp://` bağlantıları artık gerçekten geziniyor:** profil kartındaki kopyalama düğmesi
  `tdsapp://profile/<uuid>` üretiyor; ana süreç gelen bağlantıyı `routeFromDeepLink` ile doğrulayıp
  (`profile|strategy|discover|leaderboard|wallet|market|import` + uuid) yeni `app:deepLink` olayıyla
  arayüze gönderiyor. Bilinmeyen konuk ya da uuid olmayan kimlik yönlendirilmiyor.
- **Discord yapısında profil kartı (0043):** tek kart her yerde. Zeminde tema katmanı, üstünde üyenin
  afişi, dışarı taşan çerçeveli avatar, sonra isim → zamirler → tik → ünvan → @handle → tür çipleri →
  "Mart 2026'da katıldı" → hakkında → tek şeritte etkinlik sayıları → rozetler → stratejiler.
  Yorum yazarı ve strateji künyesindeki isim de aynı kartı açar; kartta profil bağlantısı
  (`tdsapp://profile/<uuid>`) kopyalama düğmesi var.
- **Profil temaları ayrı bir ürün:** `profiles.profile_theme_key` + beş tema. `Aurum` VIP ile gelir ve
  amiral gemisi: kazınmış altın ışınlar, yukarı sürüklenen kıvılcım alanı, specular süpürme, altın
  ufuk çizgisi ve parlayan avatar halkası. `Arduvaz` doğrulanmışa, `Oniks` kurumsala, `Nebula`
  (1400) ve `Abiss` (2200) coin ile satın alınır. Uygulama/HUD temasından bağımsızdır — ikisi ayrı
  ürün olarak satılabilir.
- **Kişiselleştir perdesi profilde:** çerçeve, ünvan ve profil teması artık profil sayfasından
  kuşanılıyor (önizleme kartıyla birlikte, kuşanılmış olanda "Kuşanmayı bırak"). Market rafı da duruyor;
  sahiplik hiçbir yerde istemcide hesaplanmıyor, `wallet_summary`'nin yetki cevabı kullanılıyor.
- **Zamirler:** `profiles.pronouns` (en çok 60 karakter) + kimlik düzenleyicisinde alanı.
- `frame_gold` katalog satırı eklendi — istemcideki altın çerçevenin arkasında hiç satır yoktu.

### Düzeltildi

- **Kendi kozmetiğini basabilen açık kapandı:** 0026 `active_title` ve `frame_key`'i
  `app.cosmetic_write` perdesine bağlamıştı, 0017 de `theme_key`'i `app.theme_write`'e. 0037 bu
  fonksiyonu doğrulanmış kolonları eklemek için yeniden yazarken iki perde de düştü; 0040 aynı şekli
  taşıdı. Sonuç: giriş yapmış bir üye kendi profil satırını PATCH edip VIP ünvanını, gökkuşağı
  çerçevesini ya da herhangi bir HUD temasını kendine verebiliyordu. 0043 hepsini geri sarıyor ve
  profil temasını aynı kurala bağlıyor.
- **VIP satın alınamıyordu (0042):** canlı `vip_lifetime` satırı `tag='vip'` taşıyordu; kasadaki
  "avantaj etiketi satılmaz" kuralı üyelikin kendisini de vurduğu için "VIP ol" herkezde
  `BENEFIT_ONLY` ile dönüyordu ve kart fiyatı göstermiyordu. Artık `kind` gerçek, `tag` sadece çip:
  `spend_currency` `kind='vip'` satırını avantaj red listesinden muaf tutuyor, canlı satırın çipi
  temizleniyor ve Market editörü aynı etiketi üyelik satırına yeniden yapıştıramıyor. Migration
  tek başına yeterli — kurulu 0.2.0 istemcisi VIP'i satmaya devam eder.

### Gereken

- `supabase/migrations/0042_vip_membership_is_a_product.sql` ve
  `supabase/migrations/0043_profile_themes.sql` (0039 → 0040 → 0041 sırasının ardından).

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
