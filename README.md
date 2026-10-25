# TDS Companion

Roblox **Tower Defense Simulator** için masaüstü strateji yardımcısı. Topluluk belgelerini içe aktarır, adımlara böler, oyunun üstünde takip eder ve keşfet/liderlik/profil tarafını tek uygulamada toplar.

**Son sürüm:** [0.1.2](https://github.com/Efe113/TDS-Platform/releases/latest) · Windows 10/11 x64

> Kurulum dosyası imzasızdır. Windows SmartScreen “tanınmayan yayıncı” uyarısı gösterebilir; bu bir sertifika eksikliğidir, otomatik güncellemeyi engellemez. SignPath Foundation başvurusu bu sürümden sonra ele alınacak.

## Öne çıkanlar

- **Stratejini Aktar:** Google Docs, `.md` dosyası veya yapıştırılan metin; canlı doğrulama, düzenlenebilir adımlar ve overlay önizlemesi.
- **Overlay:** Oyunun üstünde kalan adım kartı; global kısayollar, adım geçmişi, oturum sayacı.
- **Keşfet ve detay:** Arama, filtreler, karşılaştırma, favoriler, yorum/puan ve moderasyon akışı.
- **Liderlik:** Strateji ve oyuncu tabloları; pencere, metrik, takip listesi ve “bana yakın” görünümü.
- **Profil ve kozmetikler:** Avatar, afiş, rozetler, temalar, çerçeveler; VIP özel arka planı ve market indirimi.
- **Doğrulanmış hesap:** Ekip onayıyla tik rozeti, yeşil animasyonlu ünvan, bir ay %10 indirim, 3 günlük öne çıkarma kredisi ve Keşfette üst sıralama; başvurular `/verified` ekranından, kararlar Admin → Doğrulama kuyruğundan.
- **Cüzdan ve market:** Coin ekonomisi, boost/tema/çerçeve paketleri, VIP.
- **Ayarlar:** Tema, overlay yerleşimi, kısayollar, başlangıç davranışı, ölçek, veri araçları ve güncelleme denetimi.
- **Admin:** Moderasyon kuyruğu, katalog düzenleme, toplu kule/harita/modifier içe aktarma, rozet ve ekonomi araçları.
- **Kurulum:** Animasyonlu karşılama/bitiş ekranları, markalı header ve sidebar ile imzasız Windows kurulum sihirbazı.

## Otomatik güncelleme

Kurulu uygulama açılıştan 15 saniye sonra GitHub Releases’i denetler ve yeni sürümü arka planda indirir. Kurulum hazır olduğunda **Ayarlar → Uygulama güncellemesi** kartından “Yeniden başlat ve güncelle” denir. Geliştirme (`npm run dev`) ve `--dir` derlemelerinde güncelleme bilinçli olarak kapalıdır.

## Kurulum

1. [Releases](https://github.com/Efe113/TDS-Platform/releases/latest) sayfasından `TDS-Companion-0.1.2-Setup.exe` dosyasını indir.
2. Kurulumu çalıştır; kurulum dizinini seçebilirsin.
3. Uygulama verileri Windows kullanıcı klasöründe tutulur; kaldırma sırasında hesap/ayar verisi silinmez.

## Geliştirme

Gereksinimler: Node.js **>= 22.12**, Windows x64.

```bash
npm ci
cp .env.example .env.local   # Supabase URL + anon key (ve istersen Sentry DSN)
npm run dev
```

Doğrulama ve derleme:

```bash
npm run verify     # IPC + SQL + typecheck + 107 test
npm run build
npm run installer:art  # SVG → 24-bit BMP installer art
npm run dist           # imzasız NSIS installer + latest.yml + blockmap
```

`npm run dist` çıktısı `apps/desktop/release/` altındadır. `latest.yml`, `.exe` ve `.exe.blockmap` üçü birlikte yayınlanmalıdır; otomatik güncelleme `latest.yml` olmadan çalışmaz.

### Sürüm yayınlama

1. `package.json`, `apps/desktop/package.json` ve `packages/shared/package.json` sürümünü artır.
2. `npm run verify` ve `npm run dist` çalıştır.
3. GitHub Releases’te yeni bir tag (`vX.Y.Z`) aç; `TDS-Companion-X.Y.Z-Setup.exe`, `.blockmap` ve `latest.yml` dosyalarını yükle.
4. Yayını **release** olarak işaretle (draft veya prerelease otomatik güncellemeye düşmez).

`GH_TOKEN` verilmişse `npm run release:win` aynı üç dosyayı doğrudan GitHub Releases’e yükler.

## Bilinen sınırlar

- Yalnızca Windows x64 NSIS paketi üretilir; macOS/Linux paketi yok.
- Kurulum ve güncelleme dosyaları **imzasız**. SmartScreen uyarısı normaldir.
- Topluluk, hesap, yayınlama ve liderlik özellikleri Supabase bağlantısı gerektirir; overlay ve içe aktarma çevrimdışı da çalışır.
- Google Docs içe aktarma yalnızca “bağlantıya sahip herkes: görüntüleyebilir” belgelerde çalışır.
- Supabase free-tier kota/uyku davranışı canlı ortamda değişebilir.

## Lisans

[MIT](LICENSE) — kaynak kodu serbestçe kullanılabilir, değiştirilebilir ve dağıtılabilir; garanti verilmez.

## Teknoloji

Electron 45 · React 19 · TypeScript · Tailwind CSS v4 · Zustand · TanStack Query · Zod · Supabase (Postgres + RLS) · electron-updater · Sentry (env-gated).
