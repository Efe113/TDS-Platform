export const POLICY_VERSION = '2026.10.1'
export const SUPPORT_EMAIL = 'destek@tdscompanion.app'

export const ABOUT_MD = `# TDS Companion

Tower Defense Simulator (Roblox) için bağımsız bir masaüstü yardımcısı. Toplulukta paylaşılan
Google Docs stratejilerini içe aktarır, atomik adımlara kırar ve oyunun üstünde duran bir overlay
ile **alt tab atmadan** adım adım takip etmeni sağlar. Oyunun penceresine, belleğine veya dosyalarına
hiçbir şey yazmaz; gördüğün şey ekranın üstünde duran, senin tuşlarınla ilerleyen bir not kağıdıdır.

## Ne yapar
- Google Docs bağlantısından, \`.md\` dosyasından veya metin yapıştırarak strateji içe aktarır.
- Her \`>\` okunu tek adıma çevirir: adım numarası, dalga aralığı, aksiyon, kule, seviye ve not.
- İleri / geri / başa sar için kendi tuşunu atarsın; bastığın tuş oyuna da ulaşmaya devam eder.
- Detay ekranında zorluk, oyun modu, oyuncu sayısı, harita, modifikasyonlar, en fazla 5 kulelik
  envanter, yerleşim görseli, dalga atlama kuralları, kanıtlar ve hal-of-fame satırları görünür.
- Keşfet, liderlik tablosu, profil, rozetler, yorum/puan ve uygulama içi para birimi ile bir
  topluluk katmanı taşır.
- İnternet olmadan da çalışır: bir kez yüklenen strateji ve overlay çevrimdışı ilerler.

## Ne yapmaz
- Oyunun belleğini okumaz, içine kod enjekte etmez, dosyalarını değiştirmez.
- Tuşlarını çalmaz: yalnızca senin bağladığın üç tuşu izler, diğer her şey oyuna gider.
- Otomatik tıklama, bot, macro, aim-hilf veya giriş üretimi değildir.
- Düşman listesi, toplam maliyet veya oyun içi veri dökümü yayınlamaz — bunlar bilinçli olarak
  ürün kapsamı dışındadır; belgeyi yazan kişinin notu yerine geçer.
- Reklam, takip pikseli veya arka plan verisi toplamaz.

## Overlay ve tuşlar
Overlay penceresi her zaman-en-üstte ve tıklama-geçirirdir; yani üstüne gelmediğin sürece fare
oyuna aittir. Kartın üstüne geldiğinde tıklanabilir hale gelir, böylece adımı gizleyebilir veya
kapatıp geri dönebilirsin. Global tuş kancası Windows'un düşük seviye klavye kancasıyla çalışır;
kullanılabilir değilse uygulama seni oyun içi butonlara yönlendirir ve durumu Ayarlar'da açıkça
yazar. Uzak bir "hotkeys_enabled" anahtarı ile tuş kancası tamamen kapatılabilir.

## Ekonomi, rozetler ve liderlik
- **Coin:** oturum tamamlama, yayın onayı, ilk onay ve rozetler gibi sayılabilir katkılardan kazanılır.
  Defter yalnızca eklenendir: bir satır silinmez veya değiştirilmez, iptal ayrı bir kayıtla olur.
- **Harcamalar:** tema, strateji boost'u ve rozet vitrini gibi kozmetik/kısa süreli şeyler içindir.
  Coin gerçek para ile alınıp satılmaz; iade kavramı yoktur çünkü ödeme yoktur.
- **Rozetler:** istatistiklerden yeniden hesaplanır, elle sayılmaz. Eşiği sağlayan roz otomatik gelir.
- **Liderlik:** kullanım sayıları zamanla seyreltilir (yeni kullanım daha ağırlıklıdır), bu yüzden
  bir sıralama kalıcı bir unvan değil, o anki bir görünümdür.

## Teknoloji
Electron + React + TypeScript, Tailwind v4 tema değişkenleri, zustand ve TanStack Query ile bir
masaüstü arayüzü; kimlik doğrulama, veritabanı satır-seviyesi güvenlik (RLS) ve dosya depolama için
Supabase; global tuş izleme için koffi ile düşük seviye klavye kancası; Türkçe/İngilizce arayüz için
i18next; çökme raporları için (sen açarsan) Sentry; güncelleme dağıtımı için GitHub Releases.

## Sık sorulanlar
### Bu hile mi? Ban yer miyim?
Hayır, hile değil: oyuna hiçbir şey enjekte etmiyor, belleğini okumuyor, giriş üretmiyor. Yalnızca
ekranın üstünde kendi penceresini tutuyor ve senin bağladığın üç tuşu izliyor. Roblox'un koruma
sisteminin neyi nasıl değerlendirdiği bizim kontrolümüzde olmadığı için **ban vermeyiz garantisi
de veremeyiz**; riski bilerek kullanırsın.
### İnternet olmadan çalışır mı?
Bir stratejiyi bir kez yükledikten sonra overlay çevrimdışı çalışır: adımlar cihazında tutulur.
Yeni strateji içe aktarmak, keşfetmek ve ölçüm göndermek için bağlantı gerekir.
### Ücretli mi? Coin nedir?
Uygulama ücretsizdir. Coin yalnızca uygulama içinde kazanılan bir puan gerçekliğidir: tema, boost
gibi şeyler için harcanır; satın alınmaz, satılmaz, nakde çevrilmez.
### Stratejim neden eksik çözümlendi?
Google Docs düzeni serbesttir; başlık, tablo ve ikon kullanımı belgeden belgeye değişir. İnceleme
ekranı hangi alanın neden çözümlenemediğini satır satır gösterir ve oradan tamamlayabilirsin.
### Overlay görünmüyor, ne yapayım?
Ayarlar → Overlay konumunu sıfırla; pencere her zaman-en-üstte ve tıklama-geçirgendir, üstüne
gelmediğin sürece fare oyuna aittir. Ayarlar → Hotkeys ekranı tuş kancasının gerçekten çalışıp
çalışmadığını yazar.
### Verilerimi nasıl silerim?
Profilini ve taslaklarını uygulama içinden düzenleyip silebilirsin; hesabın ve sunucudaki verilerinin
kaldırılması için ${SUPPORT_EMAIL} adresine kayıtlı e-postandan yaz.

## Üçüncü taraf markalar
Roblox, Tower Defense Simulator ve Related Games / Fun Labs markaları, görselleri ve oyun verileri
ilgili sahiplerine aittir. Bu uygulama bağımsız bir topluluk aracıdır; ilgili şirketler tarafından
onaylanmaz, sponsorluk almaz ve satışa sunulmaz.

## Destek ve telif
Hata bildirimi, veri talebi ve telif kaldırma (takedown) için: ${SUPPORT_EMAIL}. Telif kaldırma
talebi uygulama içinden de gönderilebilir: ilgili stratejinin altındaki "Bana ait, kaldırılmasını
iste" akışı, beyanını ve erişilebilir bir e-posta adresini moderasyon kuyruğuna düşürür.

## Sürüm politikası ve ALPHA etiketi
Uygulama ALPHA aşamasındadır: veri modeli ve ölçüm kuralları henüz sabitlenmemiş olabilir, ancak
kullanıcı verisi için sözümüz değişmez (Gizlilik Politikası'nın sürüm numarası ve onay akışı bunu
bağlar). Otomatik güncelleme kapalı bir kutu değildir: kurulum dosyaları GitHub Releases üzerinden
dağıtılır ve imzasızdır, bu yüzden Windows "tanınmayan yayıncı" uyarısı gösterebilir. Politik
metinler değiştiğinde uygulamayı ilk açtığında sana yeniden gösterilir ve onaylamadan devam etmezsin.`

export const PRIVACY_MD = `# Gizlilik Politikası

Sürüm: ${POLICY_VERSION}

Bu metin TDS Companion masaüstü uygulamasının hangi veriyi neden tuttuğunu, nerede sakladığını ve
sana hangi kontrol noktalarını bıraktığını anlatır. Kısa hali: oyun hesabını veya şifreni istemiyoruz,
yazdığın metni kaydetmiyoruz ve ölçüm verisini yalnızca liderlik/rozet sistemi için tutuyoruz.

## Kim verileri işliyor
Uygulamanın geliştiricisi (bireysel proje) veri sorumlusudur. Teknik altyapı için üç hizmet
sağlayıcısı kullanılır: Supabase (hesap, veritabanı, dosya depolama), Discord (isteğe bağlı giriş
sağlayıcısı) ve GitHub (güncelleme dağıtımı). İletişim: ${SUPPORT_EMAIL}.

## Hesap verisi
- **E-posta ile kayıt:** e-posta adresin ve şifrenin yalnızca doğrulanamaz özeti (hash) Supabase
  Auth tarafında tutulur. Şifrenin kendisini hiçbir yerde okuyamayız.
- **Discord ile giriş:** Discord'dan gelen genel profil bilgileri (kullanıcı adı, avatar kimliği,
  Discord kullanıcı kimliği) ve e-posta adresi (Discord paylaşıyorsa) alınır.
- **Profil:** kullanıcı adı (handle), görünen ad, kısa biyografi, dil tercihi ve rolün. Görünen ad
  ve kullanıcı adı diğer kullanıcılara görünür; e-posta adresin kimseye gösterilmez.

## Kullanım ölçümü
Overlay'i kaç kez açtığın, hangi stratejide kaç adıma kadar ilerlediğin, oturumun ne kadar sürdüğü,
uygulama sürümü, işletim sistemi ve tuş kancasının hangi yöntemle çalıştığı tutulur. Bu sayılar
"en çok kullanılan strateji" liderlik tablosu ve otomatik rozetler için gereklidir; senin kimliğinle
değil, stratejiyle ilişkilendirilerek yayınlanır. Ölçümü Ayarlar → "Kullanım takibi" ile kapatabilirsin;
kapalıyken overlay çalışmaya devam eder ama hiçbir adım sayılmaz.

## Tuş verisi
Yazdığın metinler, tuş kombinasyonları veya oyun içi sohbet içeriği kaydedilmez. Yalnızca senin
atadığın üç tuşun kimliği (ör. "KeyF") ve bu tuşla ilerlediğin adım numarası tutulur. Global izleme
sadece senin bağladığın tuşlarla sınırlıdır; diğer tuşlar oyuna ve sisteme aynen geçer.

## İçe aktarma verisi
Bir belge bağlantısı veya dosya verdiğinde içeriği ayrıştırmak için uygulamanın kendi veri klasöründe
(\`%APPDATA%\`) geçici olarak saklanır. Bu ham belge tarafımıza yüklenmez; yalnızca "bilinmeyen
dosyayı gönder" seçeneğini açıkça kullanırsan inceleme için yüklenir. Bağlantı üzerinden yapılan
içe aktarmalarda yalnızca belge kimliği, içerik özeti (hash) ve sonuç durumu sunucuya yazılır.

## Yayınladığın içerik
Strateji adı, açıklaması, etiketler, adımlar, envanter, yerleşim görselleri ve künye bilgileri
diğer kullanıcılara görünür hale gelir. Yorumların, puanların ve beğenilerin profilinle
ilişkilendirilir. Özel taslaklar yalnızca sen görebilirsin; onaylanan sürüm herkese açılır.

## Raporlama ve moderasyon
Şikayet ve telif kaldırma talepleri (ad, e-posta, beyan metni) moderasyon kuyruğunda tutulur ve
yalnızca moderatörler/administratörler tarafından görüntülenir. Moderasyon kararları denetim
izine yazılır; bu izler kamuya gösterilmez.

## Çökme raporları (isteğe bağlı)
Ayarlar → "Çökme raporu gönder" kapalıyken hiçbir hata bildirimi sunucuya ulaşmaz. Açtığında:
hata mesajı, yığın izi, uygulama sürümü ve işletim sistemi bilgisi Sentry'ye gönderilir; oturum
tokenları ve parola alanları gönderilmeden önce temizlenir, kimlik olarak yalnızca hesap numaran
eklenir (adın veya e-postan değil). Kapatırsan sonraki olaylar gönderilmez.

## Tarafımızca toplanmayanlar
- Roblox hesap bilgisi, Roblox şifresi, oturum çerezi veya oyun içi envanter.
- IP tabanlı konum, cihaz parmak izi, pano içeriği, ekran görüntüsü.
- Yazdığın metinler ve tuş kayıtları (yalnızca senin atadığın tuşun kimliği).

## Üçüncü taraflara ne gider
- **Supabase:** hesap, profil, strateji, ölçüm ve ekonomi verileri (veritabanı + dosya depolama).
- **Google:** herkese açık bir Docs bağlantısını içe aktardığında, o belgenin genel dışa aktarma
  uç noktasına istek gider. Senin Google oturum çerezlerin kullanılmaz; yalnızca herkese açık
  belgeler çalışır.
- **Discord:** yalnızca giriş akışında, standart OAuth2 görüşmesi.
- **Sentry:** yukarıdaki koşulla, sen açarsan.
- **GitHub:** güncelleme denetimi sırasında sürüm numaran ve IP adresin GitHub'a görünür. Bu,
  kurulum dosyasını indirmek için kaçınılmazdır ve oturum gerektirmez.

## Ne kadar saklanır
Hesap ve içerik verisi hesabın açık kaldığı süre tutulur. Ölçüm satırları anonimleştirilebilir
şekilde biriktirilir; ekonomi defteri (coin kazanç/harcama kayıtları) denetlenebilirlik için
yalnızca-eklenen türdendir, yani satırlar silinmez veya değiştirilmez. Hesabını sildirdiğinde
kimliğinle ilişkili tüm satırların bağları koparılır (ad, e-posta, profil ve içerik kaldırılır);
sayısal toplamların geri alınması defter bütünlüğü için mümkün değildir ve bu anonimleştirme
olarak adlandırılır.

## Silme ve düzeltme talebi
Uygulama içinden profilini düzenleyebilir, taslaklarını silebilir, vitrinindeki rozetleri
kapatabilirsin. Hesabın ve sana ait sunucu verisinin silinmesi için ${SUPPORT_EMAIL} adresine
kayıtlı e-postandan yaz; talebi 30 gün içinde sonuçlandırırız. Yedekleme sistemlerinde kopyalar
biraz daha uzun kalabilir, bu süreyi de aynı başvuruyla teyit ederiz.

## Güvenlik önlemleri
Tüm sunucu erişimi HTTPS ve satır-seviyesi güvenlik politikaları (RLS) üzerinden yapılır; ayrıcalıklı
işlemler sunucu tarafında tanımlı fonksiyonlarla sınırlıdır. Oturum tokenları kendi bilgisayarındaki
uygulama veri klasöründe tutulur — bu klasör işletim sistemi hesabınla korunur, bu yüzden ortak
kullanılan bilgisayarlarda çıkış yapmadan oturumu kapatma.

## Çocuklar
Bu araç oyunun kendisinin taban yaşını hedefler (13 ve üzeri). 13 yaşından küçüksen hesabını
velinin bilgisi ve onayı ile aç. Yaş doğrulaması yapmıyoruz; bu maddeye uyum sana ve veline aittir.

## Değişiklikler
Bu metni güncellersek sürüm numarası değişir ve uygulamayı ilk açtığında yeni metni tekrar
onaylamadan özellikler devam etmez. Onayladığın sürüm, onay zamanıyla birlikte saklanır.

## İletişim
Görüntüleme, düzeltme, silme, itiraz ve telif talepleri: ${SUPPORT_EMAIL}`

export const TERMS_MD = `# Kullanım Koşulları

Sürüm: ${POLICY_VERSION}

Bu koşulları kabul ederek uygulamayı kullanmaya başlarsın. Özet: araç bir not ve takip aracıdır,
hile değildir; içeriğini sen sahiplenirsin ama başkasınınkini yayınlarken künye vermek zorundasın;
sanal para gerçek para değildir; ve hiçbirimiz Roblox'un ban vermeyeceğini garanti edemeyiz.

## 1. Kapsam ve amaç
TDS Companion, topluluk stratejilerini adım adım takip etmeni sağlayan bağımsız bir masaüstü
uygulamasıdır. Oyunu otomatikleştirmez, oyunla etkileşime girmez, oyunun veri akışına dokunmaz.
Bu amaç dışındaki her kullanım (giriş üretimi, otomasyon, veri kazıma) koşulların ihlalidir.

## 2. Hesap sorumluluğu
Bir hesap bir kişiyedir. Hesabını satmak, kiralamak, paylaşmak veya toplu otomatik kayıtla açmak
yasaktır. Erişim sağladığın cihazlarda oturumunu kapattığından emin ol; oturum tokenı o cihazda
uygulamanın veri klasöründe tutulur. Hesabının yaptığı işlemlerden sen sorumlusun.

## 3. Kabul edilebilir kullanım
Şunları yapmamayı kabul edersin:
- Liderlik, rozet veya coin sistemlerini otomasyon, sahte oturum veya tekrarlayan yapay ölçümle şişirmek.
- Başkasının belgesini künyesiz veya bağlantısız yayınlamak.
- Taciz, nefret, spam veya kişisel veri ifşası içeren strateji, yorum ve profil içeriği paylaşmak.
- Uygulamayı tersine mühendislikle oyun içi hile üretmek için kullanmak.
- Sunucu arayüzlerini doğrudan çağırarak doğrulama akışlarını atlatmaya çalışmak.

İhlalde içerik kaldırılabilir, hesap askıya alınabilir veya kapatılabilir; kararlar moderasyon
kuyruğunda ve denetim izinde tutulur.

## 4. İçeriğin, sahipliğin ve lisans
Yayınladığın strateji senin eserindir veya senin topladığın bir derlemedir. Yayınladığında bize
bunu barındırma, gösterme, önbelleğe alma ve arama sonuçlarına dahil etme için ücretsiz, devredilebilir
olmayan bir lisans verirsin; hesabını sildiğinde bu lisans sona erer. Başkasının belgesini yayınlarken
künye alanını doldurmak ve yazarın bağlantısını korumak zorunludur. İzinsiz yayın bildirimi
(takedown) hem uygulama içinden hem ${SUPPORT_EMAIL} üzerinden yapılabilir; talep eden kişiden
belge sahipliğine dair beyan ve erişilebilir bir e-posta isteriz.

## 5. Sanal ekonomi
Coin yalnızca uygulama içinde kazanılır ve yalnızca uygulama içinde harcanır; gerçek para, kripto
veya takas karşılığında alınıp satılmaz, nakde çevrilmez ve devredilmez. Kazanç oranları, fiyatlar
ve kısıtlar denge amacıyla değiştirilebilir. Değişiklik geriye dönük bir bakiyeyi silmez; yalnızca
gelecekteki kazançları etkiler. Ödeme olmadığı için iade kavramı da yoktur.

## 6. Rozetler ve liderlik
Rozetler istatistiklerinden otomatik hesaplanır; eşiği kaybettiğinde vitrininden kalkabilir.
Liderlik tablosu zamanla seyreltilen ağırlıklarla yeniden hesaplanır; sıralaman kalıcı bir unvan
veya kazanılmış hak değildir. Ölçüm kurallarını değiştirdiğimizde sıralamalar yeniden hesaplanabilir.

## 7. Anti-cheat ve ban riski
Uygulama oyunun belleğine dokunmaz ve kod enjekte etmez; yalnızca kendi penceresini ekranda tutar
ve senin bağladığın tuşları izler. Roblox'un kullandığı koruma sistemlerinin davranışı bizim
kontrolümüzde değildir ve değişebilir. Bu nedenle **hiçbir ban verilmeyeceğinin garantisini
vermeyiz.** Bu riski anladığını ve hesabınla ilgili kararı kendi sorumluluğunda verdiğini kabul edersin.

## 8. Hizmet seviyesi ve güncellemeler
Uygulama "olduğu gibi" ve "mevcut olduğu kadarıyla" sunulur. ALPHA aşamasında hatalar, veri modeli
değişiklikleri ve geçici erişilemezlikler olabilir. Güncellemeler GitHub Releases üzerinden
dağıtılır ve imzasızdır; Windows "tanınmayan yayıncı" uyarısı gösterebilir. Yanlış ayrıştırılmış
bir strateji yüzünden kaybettiğin zamandan veya bozulan bir koşundan sorumlu değiliz; hataları
bildirirsen düzeltmek isteriz.

## 9. Fikri mülkiyet
Uygulamanın kodu, arayüzü ve markası bize aittir. Roblox, Tower Defense Simulator ve Related Games /
Fun Labs markaları ilgili sahiplerine aittir; bu proje onların onayladığı veya sponsor olduğu bir
ürün değildir.

## 10. Sorumluluk sınırı
Yasal olarak izin verilen azami ölçüde; dolaylı zararlar, veri kaybı, kâr kaybı, hesap kaybı ve
kesintiler için sorumluluk kabul etmeyiz. Bir tüketicinin zorunlu yasal hakları bu madde ile
kısıtlanmaz.

## 11. Hesabın sonlandırılması
Koşulları ihlal ettiğinde hesabı askıya alabilir veya kapatabiliriz; seni erişebildiğimiz kanal
üzerinden bilgilendiririz. Kendi hesabını silmek istediğinde Gizlilik Politikası'ndaki silme
akışı işler. Kapatma sonrası kazanılmış coin ve rozetler geri yüklenmez.

## 12. Değişiklikler
Koşulları güncelleyebiliriz. Önemli değişikliklerde yeni sürüm numarası ile birlikte uygulama içinden
tekrar onayını isteriz; onaylamadan devam edemezsin. Onay kayıtların (hangi sürümü ne zaman kabul
ettiğin) saklanır.

## 13. Uygulanacak hukuk
Bu koşullar Türkiye Cumhuriyeti hukukuna tabidir. Zorunlu tüketici hakların ikamet ettiğin ülkenin
hukuku saklıdır.

İletişim ve bildirimler: ${SUPPORT_EMAIL}`

const ABOUT_DOCUMENT = { kind: 'about', title: 'Hakkında', body: ABOUT_MD } as const
const PRIVACY_DOCUMENT = { kind: 'privacy', title: 'Gizlilik Politikası', body: PRIVACY_MD } as const
const TERMS_DOCUMENT = { kind: 'terms', title: 'Kullanım Koşulları', body: TERMS_MD } as const

export const LEGAL_DOCUMENTS = [ABOUT_DOCUMENT, PRIVACY_DOCUMENT, TERMS_DOCUMENT] as const

/**
 * The consent-gated documents only. "Hakkında" used to share the same screen, which made a product
 * page and two legal contracts look like the same kind of thing - and the About page is not something
 * a user accepts. Named constants rather than an index so a caller can pick a default without
 * re-checking for undefined.
 */
export const POLICY_DOCUMENTS = [PRIVACY_DOCUMENT, TERMS_DOCUMENT] as const
export const DEFAULT_POLICY_DOCUMENT = PRIVACY_DOCUMENT

export type PolicyKind = (typeof POLICY_DOCUMENTS)[number]['kind']
