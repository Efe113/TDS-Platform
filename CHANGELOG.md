# Changelog

Tüm önemli değişiklikler bu dosyada tutulur. Sürümler [GitHub Releases](https://github.com/Efe113/TDS-Platform/releases) üzerinden yayınlanır.

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
