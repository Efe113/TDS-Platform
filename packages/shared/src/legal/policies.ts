/**
 * The three long documents, in both interface languages.
 *
 * These used to be one Turkish markdown string each, which broke in three ways at once: an English
 * interface still showed Turkish contracts, the UI had to re-parse headings to find an icon, and the
 * consent row wrote `'tr'` for everyone. So the copy is now structured data with a `{ tr, en }` pair per
 * section, and an `id` the interface can key on — the pages no longer guess anything from a title.
 *
 * The register is a *register*: both languages must say the same thing with the same section ids, so the
 * page layout cannot drift between languages. `policies.test.ts` enforces that pairing.
 */

export const POLICY_VERSION = '2026.11.1'
/** When this version took effect, shown next to the version number like any contract does. */
export const POLICY_EFFECTIVE_DATE = { tr: '27 Ekim 2026', en: '27 October 2026' } as const
export const SUPPORT_EMAIL = 'destek@tdscompanion.app'

export const POLICY_LANGUAGES = ['tr', 'en'] as const
export type PolicyLanguage = (typeof POLICY_LANGUAGES)[number]

export const POLICY_KINDS = ['about', 'privacy', 'terms'] as const
export type PolicyKind = (typeof POLICY_KINDS)[number]

export interface LocalizedText {
  tr: string
  en: string
}

export interface PolicySection {
  /** Stable machine id: the interface picks icons and anchors by this, never by the title. */
  id: string
  title: LocalizedText
  body: LocalizedText
}

export interface PolicyDocument {
  kind: PolicyKind
  title: LocalizedText
  /** The short paragraph above the sections — the part most readers actually stop at. */
  summary: LocalizedText
  sections: PolicySection[]
}

export interface FaqEntry {
  q: LocalizedText
  a: LocalizedText
}

export function pickLanguage(preferred: string | null | undefined): PolicyLanguage {
  return (preferred ?? '').toLocaleLowerCase().startsWith('en') ? 'en' : 'tr'
}

export function text(value: LocalizedText, language: PolicyLanguage): string {
  return value[language]
}

/* ---------------------------------------------------------------- about */

const ABOUT_SECTIONS: PolicySection[] = [
  {
    id: 'what-it-does',
    title: { tr: 'Ürün ne yapar', en: 'What the product does' },
    body: {
      tr: `TDS Companion, Tower Defense Simulator (Roblox) topluluğunda paylaşılan strateji belgelerini içe aktaran, bunları adım adım
okunabilir bir yürüyüş planına çeviren ve oyunun üstünde duran bir katman (overlay) ile takip etmeni sağlayan bağımsız bir
masaüstü uygulamasıdır. Belge bağlayıcısıdır: adımlar, kule isimleri ve dalga aralıkları topluluğun yazdığı metinden gelir;
uygulama bu metni çözümler, uydurmaz.`,
      en: `TDS Companion is an independent desktop application that imports strategy documents shared in the Tower Defense Simulator
(Roblox) community, turns them into a step-by-step walking plan, and lets you follow them in an overlay that sits above the game.
It is a document viewer: tower names, steps and wave ranges come from text written by the community. The application parses that
text; it does not invent it.`
    }
  },
  {
    id: 'capabilities',
    title: { tr: 'Yetenekler', en: 'Capabilities' },
    body: {
      tr: `- Google Docs bağlantısından, \`.md\` dosyasından veya metin yapıştırarak içe aktarma.
- Her adımı numaralı tek satıra indirir: dalga aralığı, aksiyon, kule, seviye, adet, süre ve tekrar.
- Kendin atadığın üç tuşla ilerleme; o tuşlar oyuna da ulaşmaya devam eder.
- Keşfet, liderlik, profil, rozetler, yorum/puan ve uygulama içi coin ile bir topluluk katmanı.
- Bağlantı kesildiğinde izlemeye aldığın belgeyi cihazdan okuyarak devam ettirme.`,
      en: `- Import from a Google Docs link, a \`.md\` file or pasted text.
- Reduce every instruction to one numbered line: wave range, action, tower, level, count, duration and repetition.
- Step forward with three keys you assign yourself; those keys still reach the game.
- A community layer: discover, leaderboard, profile, badges, comments and ratings, and an in-app coin.
- When the connection drops, continue from the document kept on your own machine.`
    }
  },
  {
    id: 'what-it-never-does',
    title: { tr: 'Yapmadıkları — sınır buysa, garanti de budur', en: 'What it never does — the boundary is the guarantee' },
    body: {
      tr: `- Oyunun belleğini okumaz, sürecine kod enjekte etmez, dosyalarını değiştirmez.
- Giriş üretmez: otomatik tıklama, bot, macro veya aim desteği çalıştırma özelliği yoktur.
- Tuşlarını kaydetmez; yalnızca senin bağladığın üç tuşun kimliğini izler, diğer her şey oyuna ve sisteme aynen geçer.
- Oyun içi veri dökümü, düşman listesi veya maliyet hesabı yayınlamaz; bu bilinçli bir ürün kapsamı kararıdır.
- Reklam, takip pikseli veya arka plan telemetrisi yoktur.`,
      en: `- It does not read game memory, inject code into the process or modify game files.
- It generates no input: there is no auto-clicker, bot, macro or script runner.
- It does not record your keystrokes; it watches only the three keys you bind, and everything else goes to the game and the system.
- It publishes no in-game data dumps, enemy lists or cost calculations — a deliberate product-scope decision.
- There are no advertisements, tracking pixels or background telemetry.`
    }
  },
  {
    id: 'overlay-and-keys',
    title: { tr: 'Overlay ve tuş kancası', en: 'Overlay and key hook' },
    body: {
      tr: `Overlay penceresi her zaman en üsttedir ve tıklama-geçirirdir; imleç üstüne gelmedikçe fare oyuna aittir. Üzerine
geldiğinde tıklanabilir hale gelir. Global tuş izleme, Windows'un düşük seviye klavye kancası (koffi) ile yapılır; bu kanca
kurulamayorsa uygulama bunu Ayarlar ekranında açıkça yazar ve seni oyun içi düğmelere yönlendirir. Uzaktan bir
\`hotkeys_enabled\` anahtarı ile kancayı tamamen kapatabiliriz.`,
      en: `The overlay window is always-on-top and click-through: the mouse belongs to the game until the pointer is over it,
where it becomes clickable. Global key watching uses the Windows low-level keyboard hook (koffi). If that hook cannot be
installed, the application says so plainly in Settings and directs you to the on-screen buttons. A remote
\`hotkeys_enabled\` flag can disable the hook entirely.`
    }
  },
  {
    id: 'economy',
    title: { tr: 'Sanal ekonomi, rozetler ve liderlik', en: 'Virtual economy, badges and leaderboard' },
    body: {
      tr: `**Coin** yalnızca uygulama içinde kazanılan bir sadakat puanıdır: oturum tamamlama, yayın onayı ve rozetler gibi
sayılabilir katkılardan doğar; tema, boost ve kozmetik gibi kalemlere harcanır. Gerçek para ile alınıp satılmaz, nakde
çevrilmez, devredilmez. Kazanç defteri yalnızca-eklenen yapıdadır: bir satır silinmez veya değiştirilmez, iptal ayrı bir
kayıtla edilir. **Rozetler** ölçülmüş istatistiklerden yeniden hesaplanır; elle sayılmaz. **Liderlik** zamanla seyreltilen
ağırlıklarla hesaplanır; bu yüzden bir sıra kalıcı bir unvan değil, o anki bir görünümdür.`,
      en: `A **coin** is a loyalty point earned only inside the application: it comes from countable contributions such as completed
sessions, approved publications and badges, and is spent on items such as themes, boosts and cosmetics. It is not bought or sold
for real money, cannot be cashed out and cannot be transferred. The earning ledger is append-only: a row is never deleted or
edited, and a reversal is a separate record. **Badges** are recomputed from measured statistics, never counted by hand.
**The leaderboard** is recalculated with weights that decay over time, so a rank is a view of the moment, not a permanent title.`
    }
  },
  {
    id: 'technology',
    title: { tr: 'Teknoloji ve dağıtım', en: 'Technology and distribution' },
    body: {
      tr: `Electron, React, TypeScript ve Tailwind ile kurulmuş bir masaüstü arayüzü; kimlik doğrulama, satır-seviyesi
güvenlik (RLS) ve dosya depolama için Supabase; global tuş izleme için koffi; Türkçe/İngilizce arayüz için i18next;
açtığın takdirde çökme raporları için Sentry. Kurulum dosyaları GitHub Releases üzerinden dağıtılır ve kod imzası
taşımaz, bu yüzden Windows "tanınmayan yayıncı" uyarısı gösterebilir.`,
      en: `A desktop interface built with Electron, React, TypeScript and Tailwind; Supabase for authentication, row-level security
(RLS) and file storage; koffi for global key watching; i18next for the Turkish/English interface; and Sentry for crash reports,
but only if you switch them on. Installers are distributed through GitHub Releases and carry no code signature, so Windows may
show an "unknown publisher" warning.`
    }
  },
  {
    id: 'roadmap',
    title: { tr: 'Sürüm politikası ve ALPHA etiketi', en: 'Release policy and the ALPHA label' },
    body: {
      tr: `Uygulama ALPHA aşamasındadır: arayüz, veri modeli ve ölçüm kuralları değişebilir. Kullanıcı verisi hakkındaki sözümüz
değişmez — o kısım Gizlilik Politikası'nın sürüm numarası ve onay akışı ile bağlıdır, politika değiştiğinde uygulamayı ilk
açışında metin yeniden gösterilir ve onaylamadan devam etmezsin. Kapatma (beta/sürüm sonu) kararı verilirse hesap ve veri
hakkındaki sonuçlar aynı politikle bildirilir.`,
      en: `The application is in ALPHA: the interface, data model and measurement rules may change. Our commitment about your data does
not change — it is bound by the version number of the Privacy Policy and the consent flow, so when the policy changes the text is
shown again on first launch and nothing continues until you accept it. If a shutdown (beta or end of life) is decided, the
consequences for accounts and data are announced under the same policy.`
    }
  },
  {
    id: 'brands',
    title: { tr: 'Üçüncü taraf markaları', en: 'Third-party brands' },
    body: {
      tr: `Roblox, Tower Defense Simulator ve Related Games / Fun Labs markaları, görselleri ve oyun verileri ilgili
sahiplerine aittir. Bu uygulama bağımsız bir topluluk aracıdır; ilgili şirketler tarafından onaylanmaz, sponsorluk almaz ve
onlarla ticari bir ilişkisi yoktur.`,
      en: `Roblox, Tower Defense Simulator and Related Games / Fun Labs brands, artwork and game data belong to their respective
owners. This application is an independent community tool: it is not endorsed or sponsored by those companies and has no
commercial relationship with them.`
    }
  },
  {
    id: 'support',
    title: { tr: 'Destek, telif ve başvuru yolları', en: 'Support, copyright and how to reach us' },
    body: {
      tr: `Hata bildirimi, veri talebi ve telif kaldırma (takedown) için: ${SUPPORT_EMAIL}. Telif kaldırma talebi uygulama
içinden de gönderilebilir: ilgili stratejinin altındaki "Bana ait, kaldırılmasını iste" akışı, beyanını ve erişilebilir bir
e-posta adresini moderasyon kuyruğuna düşürür. Başvurular kimlikle değil, beyan ve belge üzerinden yürür.`,
      en: `For bug reports, data requests and copyright takedown: ${SUPPORT_EMAIL}. A takedown request can also be sent in-app:
the "This is mine, take it down" flow under the strategy puts your statement and a reachable email address into the moderation
queue. Requests run on statements and evidence, not on identity documents.`
    }
  }
]

export const ABOUT_FAQ: FaqEntry[] = [
  {
    q: { tr: 'Bu hile mi? Ban yer miyim?', en: 'Is this cheating? Will I get banned?' },
    a: {
      tr: `Hile tanımına girmez: oyuna hiçbir şey enjekte etmiyor, belleğini okumuyor, giriş üretmiyor; yalnızca kendi penceresini
ekranın üstünde tutuyor. Buna karşın Roblox'un koruma sisteminin neyi nasıl değerlendirdiği bizim kontrolümüzde değildir.
Bu yüzden "ban yemezsin" garantisi vermiyoruz; koşulların 9. maddesi bu riski açıkça sana bırakır.`,
      en: `It is not cheating by definition: it injects nothing into the game, reads no memory, generates no input, and only keeps its
own window on top of the screen. We do not control how Roblox's anti-cheat evaluates anything, so we do not promise you will not be
banned; clause 9 of the Terms explicitly leaves that risk with you.`
    }
  },
  {
    q: { tr: 'İnternet olmadan çalışır mı?', en: 'Does it work offline?' },
    a: {
      tr: `İzlemeye aldığın bir strateji cihazında saklanır; overlay ve sağ ray çevrimdışı çalışmaya devam eder, adımlar
işaretlenirse ölçüm kayıtları bağlantı geleneği kadar bekletilir. Yeni strateji içe aktarmak, keşfetmek ve hesap işlemleri için
bağlantı gerekir.`,
      en: `A strategy you start tracking is kept on your machine; the overlay and the run rail continue offline, and any recorded
steps are held until a connection returns. Importing new strategies, browsing Discover and account operations need a connection.`
    }
  },
  {
    q: { tr: 'Ücretli mi? Coin nedir?', en: 'Is it paid? What is a coin?' },
    a: {
      tr: `Uygulama ücretsizdir ve ücretli bir planı yoktur. Coin, ödeme olmayan bir ekonomi içinde kazanılan tek puandır:
tema, boost ve kozmetik vitrinler için harcanır; satın alınamaz, satılamaz, nakde çevrilemez.`,
      en: `The application is free and has no paid tier. A coin is the only point in an economy with no payments: it is spent on themes,
boosts and cosmetic showcases, and cannot be bought, sold or cashed out.`
    }
  },
  {
    q: { tr: 'Stratejim neden eksik çözümlendi?', en: 'Why was my strategy only partly parsed?' },
    a: {
      tr: `Topluluk belgelerinin biçimi serbesttir: başlık, tablo, simge ve kısaltma kullanımı belgeden belgeye değişir.
İnceleme ekranı hangi alanın neden çözümlenemediğini satır satır gösterir ve eksik alanı oradan tamamlayabilirsin;
tamamlanmadan yayınlanan bir adım, yayıncının sorumluluğunda kalmaya devam eder.`,
      en: `Community documents are free-form: headings, tables, icons and abbreviations vary from document to document. The review screen
lists which field could not be resolved and why, and lets you complete it there; a step published without completion stays the
publisher's responsibility.`
    }
  },
  {
    q: { tr: 'Overlay görünmüyor, ne yapayım?', en: 'The overlay is not visible — what do I do?' },
    a: {
      tr: `Ayarlar → Overlay bölümünden konumu sıfırla. Overlay her zaman en üstte ve tıklama-geçirgendir; üstüne gelmediğin sürece
fare oyuna aittir, bu yüzden "kayboldu" hissi normal olabilir. Ayarlar → Hotkeys ekranı tuş kancasının gerçekten çalışıp
çalışmadığını yazar.`,
      en: `Reset the position under Settings → Overlay. The overlay is always-on-top and click-through, so the mouse belongs to the game
until you hover it — which can make it look like it "disappeared". Settings → Hotkeys tells you whether the key hook is actually
running.`
    }
  },
  {
    q: { tr: 'Verilerimi nasıl silerim?', en: 'How do I delete my data?' },
    a: {
      tr: `Profilini, taslaklarını ve yayınladığın içerikleri uygulama içinden yönetebilirsin. Hesabın ve sunucudaki verilerinin
kaldırılması için ${SUPPORT_EMAIL} adresine kayıtlı e-postandan yaz; talebi 30 gün içinde sonuçlandırırız. Ekonomi defterinin
bütünlüğü gereği sayısal toplamlar kimliksiz olarak kalır — bu, silme değil kimliksizleştirme olarak politikada tanımlanır.`,
      en: `You can manage your profile, drafts and published content inside the application. For removal of your account and server data,
write to ${SUPPORT_EMAIL} from your registered email; we close requests within 30 days. Because of the integrity of the economy
ledger, numeric totals remain without identifiers — the policy calls that anonymisation rather than deletion.`
    }
  }
]

export const ABOUT_DOCUMENT: PolicyDocument = {
  kind: 'about',
  title: { tr: 'Hakkında', en: 'About' },
  summary: {
    tr: `Bağımsız bir topluluk aracı, iki hukuki metin ve bir sınır: oyunun içine girmeyiz, senin yazdığına bakarız.`,
    en: `An independent community tool, two legal documents and one boundary: we do not enter the game, we look at what you wrote.`
  },
  sections: ABOUT_SECTIONS
}

/* ---------------------------------------------------------------- privacy */

const PRIVACY_SECTIONS: PolicySection[] = [
  {
    id: 'scope',
    title: { tr: '1. Kapsam, amaç ve tanımlar', en: '1. Scope, purpose and definitions' },
    body: {
      tr: `Bu politika, TDS Companion masaüstü uygulamasını ("Uygulama") kullanan kişilerin verilerinin nasıl işlendiğini
belgeler. "Hesap" kayıt olduğunda kimlik sağlayıcısında oluşan hesabı, "İçerik" senin yayınladığın strateji, yorum ve profil
alanlarını, "Ölçüm" ise adım/oturum sayımlarını anlatır. Uygulama, oyunu otomatikleştirmek için değil, topluluk belgelerini
takip etmek için tasarlanmıştır; veri işleme kapsamı da bu amaçtan taşmaz.`,
      en: `This policy documents how the data of people using the TDS Companion desktop application ("the Application") is processed.
"Account" means the account created in the identity provider when you register, "Content" means the strategies, comments and profile
fields you publish, and "Measurement" means step and session counts. The Application is designed to follow community documents rather
than to automate the game, and its data processing does not reach beyond that purpose.`
    }
  },
  {
    id: 'controller',
    title: { tr: '2. Veri sorumlusu ve iletişim', en: '2. Data controller and contact' },
    body: {
      tr: `Veri sorumlusu, uygulamayı geliştiren bireysel proje sahibidir (ticari tüzel kişilik yoktur). Teknik altyapı için üç
hizmet kullanılır: Supabase (hesap, veritabanı, dosya depolama), Discord (isteğe bağlı giriş sağlayıcısı) ve GitHub (güncelleme
dağıtımı). Veri talepleri ve itirazlar: ${SUPPORT_EMAIL}.`,
      en: `The data controller is the individual project owner who develops the application (there is no corporate legal entity). Three
services are used for the technical stack: Supabase (accounts, database, file storage), Discord (an optional sign-in provider) and
GitHub (update distribution). Data requests and objections: ${SUPPORT_EMAIL}.`
    }
  },
  {
    id: 'account-data',
    title: { tr: '3. Hesap ve kimlik verisi', en: '3. Account and identity data' },
    body: {
      tr: `- **E-posta ile kayıt:** e-posta adresin ve şifrenin yalnızca doğrulanamaz özeti (hash) kimlik sağlayıcısında
tutulur; şifrenin kendisini hiçbir yerde okuyamayız.
- **Discord ile giriş:** genel profil bilgileri (kullanıcı adı, avatar kimliği, Discord kullanıcı kimliği) ve Discord
paylaşıyorsa e-posta adresi alınır.
- **Profil:** kullanıcı adı (handle), görünen ad, kısa biyografi, dil tercihi ve rolün. Görünen ad ve kullanıcı adı diğer
kullanıcılara açıktır; e-posta adresin kimseye gösterilmez.`,
      en: `- **Email registration:** your email address and only the non-reversible digest (hash) of your password are kept by the
identity provider; we cannot read the password itself anywhere.
- **Discord sign-in:** public profile fields (username, avatar id, Discord user id) and, if Discord shares it, your email address.
- **Profile:** handle, display name, short biography, language preference and role. The display name and handle are visible to other
users; your email address is never shown.`
    }
  },
  {
    id: 'content',
    title: { tr: '4. Yayınladığın içerik', en: '4. The content you publish' },
    body: {
      tr: `Strateji adı, açıklaması, etiketleri, adımları, envanteri, yerleşim görselleri ve künye bilgileri; yorum, puan ve
oyların profilinle ilişkilendirilmiş hali — bunlar onaylandıktan sonra herkese açık hale gelir. Özel taslakları yalnızca sen
görürsün. İçeriği kaldırırsen bağlantıları hesap bazında silinir; ancak başka bir kullanıcının alıntıladığı veya önbelleğe aldığı
kopyalar teknik olarak bizim erişimimizde kalmaz.`,
      en: `Strategy name, description, tags, steps, inventory, placement images and credit fields — plus your comments, ratings and
votes as linked to your profile — become public once approved. Private drafts are visible to you alone. If you remove content, its
links are deleted per account, but copies other users quoted or cached remain outside our access.`
    }
  },
  {
    id: 'measurement',
    title: { tr: '5. Kullanım ölçümü', en: '5. Usage measurement' },
    body: {
      tr: `Overlay'i kaç kez açtığın, hangi stratejide kaçıncı adıma kadar ilerlediğin, oturumun başlangıç/bitiş zamanı,
uygulama sürümü, işletim sistemi ve tuş kancasının hangi yöntemle çalıştığı tutulur. Hukuki dayanağımız, liderlik tablosu ve
otomatik rozetlerin bu sayılar olmadan çalışmıyor olmasıdır. Yayınlanan sıralamada senin adın değil stratejin ölçülür.
Ayarlar → "Oyun içi kullanım sayacı" ile kapatabilirsin; kapalıyken overlay çalışmaya devam eder ama hiçbir adım sayılmaz.`,
      en: `We keep how many times you opened the overlay, how far you advanced on a given strategy, session start/end times, the
application version, the operating system and which method the key hook used. Our lawful basis is that the leaderboard and automatic
badges cannot function without these numbers. Published rankings measure the strategy, not your name. You can switch it off under
Settings → "In-game usage counter"; while off, the overlay keeps working but no step is counted.`
    }
  },
  {
    id: 'keyboard',
    title: { tr: '6. Tuş ve girdi verisi', en: '6. Key and input data' },
    body: {
      tr: `Yazdığın metinler, tuş kombinasyonları, oyun içi sohbet veya panon kaydedilmez. Yalnızca senin atadığın üç tuşun
kimliği (ör. \`KeyF\`) ve o tuşla ilerlediğin adım numarası tutulur. Global izleme senin bağladığın tuşlarla sınırlıdır; diğer
tuşlar oyuna ve sisteme aynen geçer. Kancanın davranışı Ayarlar ekranında şeffaf biçimde yazılır.`,
      en: `We do not store the text you type, key combinations, in-game chat or clipboard. Only the identity of the three keys you
bind (for example \`KeyF\`) and the step number you advanced with them are kept. Global watching is limited to the keys you bind;
every other key goes to the game and the system unchanged. The hook's behaviour is stated transparently in Settings.`
    }
  },
  {
    id: 'imports',
    title: { tr: '7. İçe aktarma verisi ve geçici dosyalar', en: '7. Import data and temporary files' },
    body: {
      tr: `Bir belge bağlantısı veya dosya verdiğinde içeriği, ayrıştırma senin cihazında yapılsın diye uygulamanın kendi veri
klasörüne (\`%APPDATA%\`) geçici olarak yazılır. İçe aktarma aşamasında sunucuya ham belge yüklenmez: belge kimliği veya kaynak
bağlantısı, içerik özeti (sha256), sonuç durumu ve katalogda eşleşmeyen kule/harita etiketleri yazılır. Yayınladığında ise onayladığın
adım planı — adımların orijinal metniyle birlikte — sürüm kaydına dönüşür ve topluluğa açık hale gelir.`,
      en: `When you give a document link or a file, its content is written temporarily into the application's own data folder
(\`%APPDATA%\`) so that the parsing happens on your machine. No raw document is uploaded during an import: the server records the
document id or source link, a content digest (sha256), the outcome, and the tower/map labels that did not match the catalogue. When
you publish, the step plan you approved — including the original text of each step — becomes the version record and is public.`
    }
  },
  {
    id: 'providers',
    title: { tr: '8. Hizmet sağlayıcılar ve veri aktarımı', en: '8. Service providers and transfers' },
    body: {
      tr: `- **Supabase:** hesap, profil, içerik, Ölçüm ve ekonomi verileri (veritabanı + dosya depolama).
- **Google:** herkese açık bir Docs bağlantısını içe aktardığında o belgenin genel dışa aktarma uç noktasına istek gider;
senin Google oturum çerezlerin kullanılmaz, yalnızca herkese açık belgeler çalışır.
- **Discord:** yalnızca giriş akışında, standart OAuth2 görüşmesi.
- **GitHub:** güncelleme denetimi sırasında sürüm numaran ve IP adresin görünür; bu, kurulum dosyasını indirmek için
kaçınılmazdır ve oturum gerektirmez.
- **Sentry:** 10. maddedeki koşulla, yalnızca sen açarsan.
Bu hizmetler yurt dışında barındırılabilir; verilerin ülkeler arası taşınması bu maddenin kapsamındadır.`,
      en: `- **Supabase:** account, profile, content, Measurement and economy data (database plus file storage).
- **Google:** importing a public Docs link sends a request to that document's public export endpoint; your Google session
cookies are never used and only public documents work.
- **Discord:** only in the sign-in flow, as a standard OAuth2 exchange.
- **GitHub:** your version number and IP address become visible during an update check; this is unavoidable to download an
installer and needs no session.
- **Sentry:** under the condition in clause 10, and only if you switch it on.
These services may be hosted outside your country; the cross-border transfer of data is covered by this clause.`
    }
  },
  {
    id: 'security',
    title: { tr: '9. Güvenlik önlemleri', en: '9. Security measures' },
    body: {
      tr: `Sunucu erişimi yalnızca HTTPS ve satır-seviyesi güvenlik politikaları (RLS) üzerinden yapılır; ayrıcalıklı
işlemler istemcinin doğrudan yazamadığı, sunucu tarafında tanımlı fonksiyonlarla sınırlıdır. Oturum tokenları cihazının dışında
bir yere gitmez: uygulamanın veri klasöründe, işletim sisteminin şifreleme deposu (safeStorage) ile şifrelenmiş bir dosyada
tutulur. Bu depoya ulaşılamayan kurulumlarda dosya şifrelenmeden yazılır, bu yüzden ortak kullanılan bilgisayarlarda pencereyi
kapatmak değil, çıkış yapmak gerekir.`,
      en: `Server access happens only over HTTPS and through row-level security policies (RLS); privileged operations are limited to
server-side functions the client cannot write to directly. Session tokens never leave your device: they are kept in the application's
data folder, encrypted with the operating system's secure storage (safeStorage). Where that storage cannot be reached the file is written
unencrypted, which is why on a shared computer you should sign out rather than only close the window.`
    }
  },
  {
    id: 'crash-reports',
    title: { tr: '10. Çökme raporları (isteğe bağlı)', en: '10. Crash reports (optional)' },
    body: {
      tr: `Ayarlar → "Onay verildiğinde çökme raporu gönder" kapalıyken hiçbir hata bildirimi sunucuya ulaşmaz. Açtığında hata mesajı, yığın izi,
uygulama sürümü ve işletim sistemi bilgisi Sentry'ye gönderilir; oturum tokenları ve parola alanları gönderilmeden önce
temizlenir, kimlik olarak yalnızca hesap numaran eklenir (adın veya e-postan değil). Kapatırsan sonraki olaylar gönderilmez.`,
      en: `While Settings → "Send crash reports once opted in" is off, no error notification reaches a server. When on, the error message, stack trace,
application version and operating system are sent to Sentry; session tokens and password fields are stripped before sending, and
only your account number is attached as an identifier (not your name or email). If you switch it off, later events are not sent.`
    }
  },
  {
    id: 'not-collected',
    title: { tr: '11. Tarafımızca toplanmayan veriler', en: '11. What we do not collect' },
    body: {
      tr: `Roblox hesap bilgisi, Roblox şifresi, oturum çerezi veya oyun içi envanter; IP tabanlı konum, cihaz parmak izi,
pano içeriği, ekran görüntüsü; yazdığın metinler ve tuş kayıtları (6. maddedeki istisna hariç); ses veya görüntü kaydı
toplanmaz. Bu liste "şimdilik yok" değil, ürün mimarisinin bir sınırıdır.`,
      en: `We do not collect Roblox account details, Roblox passwords, session cookies or in-game inventory; IP-based location, device
fingerprinting, clipboard content or screenshots; the text you type or key logs (except the narrow case in clause 6); or audio and
video recording. This list is not "not for now" — it is a limit of the product architecture.`
    }
  },
  {
    id: 'retention',
    title: { tr: '12. Saklama süresi ve yedekler', en: '12. Retention and backups' },
    body: {
      tr: `Hesap ve içerik verisi, hesabın açık kaldığı süre tutulur. Ölçüm satırları, ekonomi defteriyle birlikte
denetlenebilirliği korumak için yalnızca-eklenen olarak birikir. Hesabını sildirdiğinde kimliğinle ilişkili satırların
bağları kopar (ad, e-posta, profil ve içerik kaldırılır); sayısal toplamların geri alınması defter bütünlüğü nedeniyle
mümkün değildir ve bu işlem kimliksizleştirme olarak adlandırılır. Yedek sistemlerdeki kopyalar daha uzun kalabilir; bu
süre aynı başvuruyla teyit edilir.`,
      en: `Account and content data are kept while the account exists. Measurement rows accumulate append-only alongside the economy
ledger, to preserve auditability. When you have your account deleted, the links to rows tied to your identity are cut (name, email,
profile and content are removed); rolling back numeric totals is impossible for ledger-integrity reasons, and that operation is
called anonymisation. Copies in backup systems may live longer; that period is confirmed through the same request.`
    }
  },
  {
    id: 'rights',
    title: { tr: '13. Hakların ve başvuru yolu', en: '13. Your rights and how to exercise them' },
    body: {
      tr: `İşlenip işlenmediğini öğrenme, işlenmişse bilgi ve kopya isteme, düzeltme, silme, kimliksizleştirme, itiraz ve
otomatik sistemlerle aleyhine çıkan sonuca karşı inceleme talep hakları sana aittir. Taleplerini ${SUPPORT_EMAIL} adresine
kayıtlı e-postanla ilet; 30 gün içinde sonuçlandırırız. Uygulama içinden de profilini düzenleyebilir, taslaklarını
silebilir ve vitrinindeki rozetleri kapatabilirsin. KVKK ve benzeri rejimlerdeki başvuru yolları saklıdır.`,
      en: `You hold the rights to learn whether your data is processed, to obtain information and a copy, to rectify, to erase, to be
anonymised, to object, and to request review of an outcome produced against you by automated systems. Send requests to
${SUPPORT_EMAIL} from your registered email; we close them within 30 days. Inside the application you can also edit your profile,
delete drafts and choose which badges your showcase displays. Statutory routes under KVKK and comparable regimes remain available to you.`
    }
  },
  {
    id: 'children',
    title: { tr: '14. Yaş sınırı ve veli onayı', en: '14. Age limit and parental consent' },
    body: {
      tr: `Bu araç oyunun kendisinin hedeflediği taban yaşı (13 ve üzeri) esas alır. 13 yaşından küçüksen hesabı velinin
bilgisi ve onayı ile aç. Yaş doğrulaması yapmıyoruz; bu maddeye uyum sana ve veline aittir. Reklam veya profil
zenginleştirme gibi ticari işleme amaçlarımız yoktur, bu yüzden çocuk verisine ayrı bir pazarlama izni de satmayız.`,
      en: `The tool follows the age the game itself targets (13 and above). If you are under 13, open an account with your
guardian's knowledge and consent. We perform no age verification, so compliance with this clause rests with you and your guardian.
We have no commercial processing purposes such as advertising or profile enrichment, so we also do not sell a separate marketing
consent for children's data.`
    }
  },
  {
    id: 'changes',
    title: { tr: '15. Değişiklikler ve yeniden onay', en: '15. Changes and re-consent' },
    body: {
      tr: `Bu metni güncellersek sürüm numarası değişir ve uygulamayı ilk açtığında yeni metni tekrar onaylamadan
özellikler devam etmez. Onayladığın sürüm, onay zamanı ve onay sırasında kullandığın arayüz diliyle birlikte saklanır.
Kritik bir değişiklikte (amaç, saklama süresi veya üçüncü taraf aktarımı gibi) yalnızca sürüm numarasına güvenmek
yerine uygulama içinde bir kez daha dikkatine sunarız.`,
      en: `If we update this text, the version number changes and features do not continue until you re-accept the new text on first
launch. The version you accepted is stored together with the acceptance time and the interface language you used at that moment. For a
material change (purpose, retention or third-party transfer, for example) we do not rely on the version number alone: we bring it to
your attention once more inside the application.`
    }
  },
  {
    id: 'contact',
    title: { tr: '16. İletişim', en: '16. Contact' },
    body: {
      tr: `Görüntüleme, düzeltme, silme, itiraz, telif ve şikayet talepleri: ${SUPPORT_EMAIL}. Başvurunda hangi
hesabı (kullanıcı adını) ve hangi işlemi istediğini yazman, süreyi kısaltır.`,
      en: `For access, rectification, erasure, objection, copyright and complaints: ${SUPPORT_EMAIL}. Including which account
(your handle) and which operation you are requesting shortens the process.`
    }
  }
]

export const PRIVACY_DOCUMENT: PolicyDocument = {
  kind: 'privacy',
  title: { tr: 'Gizlilik Politikası', en: 'Privacy Policy' },
  summary: {
    tr: `Oyun hesabını, şifreni veya yazdığın metni istemiyoruz. Tuttuğumuz şey üç tür: hesabını, yayınladığın içeriği ve
liderlik ile rozetlerin ihtiyaç duyduğu sayımları.`,
    en: `We do not ask for your game account, your password or the text you type. What we keep is three things: your account, the
content you publish, and the counts that the leaderboard and badges need.`
  },
  sections: PRIVACY_SECTIONS
}

/* ---------------------------------------------------------------- terms */

const TERMS_SECTIONS: PolicySection[] = [
  {
    id: 'scope',
    title: { tr: '1. Kapsam ve kabul', en: '1. Scope and acceptance' },
    body: {
      tr: `Bu koşulları kabul ederek uygulamayı kullanmaya başlarsın; kayıt sırasında ve politika sürümü değiştiğinde bu
kabul yeniden alınır. Özet: araç bir not ve takip aracıdır, hile değildir; içeriğini sen sahiplenirsin ama başkasınınkini
yayınarken künye vermek zorundasın; sanal para gerçek para değildir; ve hiçbirimiz Roblox'un ban vermeyeceğini garanti
edemeyiz.`,
      en: `By accepting these terms you start using the application; that acceptance is taken again at registration and whenever the
policy version changes. In short: the tool is a note and tracking aid, not a cheat; you own your content but must attribute someone
else's when you publish it; virtual currency is not real money; and none of us can guarantee that Roblox will not ban you.`
    }
  },
  {
    id: 'account',
    title: { tr: '2. Hesap ve hesap güvenliği', en: '2. Accounts and account security' },
    body: {
      tr: `Bir hesap bir kişidir. Hesabı satmak, kiralamak, paylaşmak veya toplu/otomatik kayıtla açmak yasaktır.
Erişim sağladığın cihazlarda oturumunu kapattığından emin ol; oturum tokenı o cihazda uygulamanın veri klasöründe tutulur.
Hesabının yaptığı işlemlerden ve paylaştığın erişimlerden sen sorumlusun.`,
      en: `One account is one person. Selling, renting, sharing an account or opening accounts in bulk or automatically is prohibited.
Make sure you sign out on devices you use; the session token lives in that device's application data folder. You are responsible for
the actions your account performs and for any access you share.`
    }
  },
  {
    id: 'acceptable-use',
    title: { tr: '3. Kabul edilebilir kullanım', en: '3. Acceptable use' },
    body: {
      tr: `Uygulama topluluk belgelerini takip etmek içindir. Bu amaç dışındaki her kullanım — giriş üretimi, otomasyon,
oyunun veri akışına dokunma, veri kazıma — bu koşulların ihlalidir. Sunucu arayüzlerini doğrudan çağırarak doğrulama,
limit veya onay akışlarını atlatmaya çalışmak da yasaktır.`,
      en: `The application exists to follow community documents. Any use outside that purpose — input generation, automation,
touching the game's data flow, scraping — is a breach of these terms. Calling server interfaces directly to bypass validation,
limits or approval flows is prohibited on the same grounds.`
    }
  },
  {
    id: 'fair-play',
    title: { tr: '4. Ölçüm dürüstlüğü', en: '4. Fairness of measurement' },
    body: {
      tr: `Liderlik, rozet ve coin sistemlerini otomasyon, sahte oturum, tekrarlayan yapay ölçüm veya birden fazla hesapla
şişirmek yasaktır. Bu tür bir kazanç, teknik olarak tespit edildiğinde geri alınır; ekonomi defterinde iptal ayrı bir kayıt
olarak görünür. Şüpheli kalıpları inceleyen moderasyon kararı denetim izine yazılır.`,
      en: `Inflating the leaderboard, badges or coin systems through automation, fake sessions, repeated artificial measurement or
multiple accounts is prohibited. Such gains are revoked when detected technically; in the economy ledger the reversal appears as a
separate record. Moderation decisions that review suspicious patterns are written into the audit trail.`
    }
  },
  {
    id: 'content-licence',
    title: { tr: '5. İçeriğin, sahipliğin ve lisans', en: '5. Your content, ownership and licence' },
    body: {
      tr: `Yayınladığın strateji senin eserindir veya senin topladığın bir derlemedir. Yayınladığında bize bu içeriği
barındırma, gösterme, önbelleğe alma, dizine ekleme ve arama sonuçlarına dahil etme amaçlarıyla ücretsiz, devredilemez,
dünya genelinde bir lisans verirsin; hesabını sildiğinde bu lisans sona erer. Yayınlayacağın içerik üzerinde hakka
sahip olmak veya izin almak senin sorumluluğundadır.`,
      en: `The strategy you publish is your work or a compilation you assembled. By publishing it you grant us a free,
non-transferable, worldwide licence to host, display, cache, index and include that content in search results; the licence ends when
you delete your account. Holding the rights to, or permission for, the content you publish is your responsibility.`
    }
  },
  {
    id: 'attribution-takedown',
    title: { tr: '6. Başkasının belgesi, künye ve kaldırma bildirimi', en: "6. Other people's documents, attribution and takedown" },
    body: {
      tr: `Başkasının belgesini yayınlarken künye alanını doldurmak ve yazarın bağlantısını korumak zorunludur. İzinsiz
yayın bildirimi (takedown) uygulama içinden veya ${SUPPORT_EMAIL} üzerinden yapılabilir; talep edenden belge sahipliğine
dair beyan ve erişilebilir bir e-posta isteriz. Bildirilen içerik incelemeye alınana kadar gizlenebilir; itiraz hakkın saklıdır.
Telif süreleri ve kaldırma usulü, uygulamanın tabi olduğu tüketici ve içerik mevzuatına göre yürür.`,
      en: `When publishing someone else's document you must fill the credit field and keep the author's link. A notice about an
unauthorised publication (takedown) can be filed in-app or through ${SUPPORT_EMAIL}; we ask the notice sender for a statement of
ownership and a reachable email address. Reported content may be hidden until reviewed; you keep the right to counter-notice.
Copyright terms and removal procedure run under the consumer and intermediary legislation the application is subject to.`
    }
  },
  {
    id: 'virtual-economy',
    title: { tr: '7. Sanal ekonomi', en: '7. The virtual economy' },
    body: {
      tr: `Coin yalnızca uygulama içinde kazanılır ve yalnızca uygulama içinde harcanır; gerçek para, kripto veya takas
karşılığında alınıp satılmaz, nakde çevrilmez ve devredilmez. Kazanç oranları, fiyatlar ve kısıtlar denge amacıyla
değiştirilebilir; bir değişiklik geriye dönük bakiyeyi silmez, yalnızca gelecek kazançları etkiler. Ödeme alınmadığı için
iade kavramı da yoktur; bir coin harcaması satın alma değil, bir eşik değişimidir.`,
      en: `Coins are earned only inside the application and spent only inside it; they are not bought or sold for real money, crypto or
barter, cannot be cashed out and cannot be transferred. Earning rates, prices and limits may change for balance reasons; a change
never erases a historical balance, it affects only future earnings. Because no payment is taken there is no refund concept either —
spending is a threshold, not a purchase.`
    }
  },
  {
    id: 'badges-leaderboard',
    title: { tr: '8. Rozetler ve liderlik', en: '8. Badges and leaderboard' },
    body: {
      tr: `Rozetler istatistiklerinden otomatik hesaplanır; eşiği kaybettiğinde vitrininden kalkabilir. Liderlik tablosu
zamanla seyreltilen ağırlıklarla yeniden hesaplanır; sıralaman kalıcı bir unvan veya kazanılmış hak değildir. Ölçüm
kurallarını değiştirdiğimizde sıralamalar ve rozet durumları yeniden hesaplanabilir; bu bir ceza değil, aynı cetvelin
yeniden çizilmesidir.`,
      en: `Badges are computed automatically from your statistics; if you fall below a threshold it may leave your showcase. The
leaderboard is recomputed with weights that decay over time; your rank is not a permanent title or an earned entitlement. When we
change measurement rules, rankings and badge states may be recomputed — that is not a penalty, it is redrawing the same ruler.`
    }
  },
  {
    id: 'third-party-risk',
    title: { tr: '9. Oyun tarafı riski ve ban garantisi vermeyiz', en: '9. Game-side risk; no ban guarantee' },
    body: {
      tr: `Uygulama oyunun belleğine dokunmaz ve kod enjekte etmez; yalnızca kendi penceresini ekranda tutar ve senin
bağladığın tuşları izler. Roblox'un kullandığı koruma sistemlerinin davranışı bizim kontrolümüzde değildir ve değişebilir.
Bu nedenle **hiçbir ban verilmeyeceğinin garantisini vermeyiz.** Bu riski anladığını ve hesabınla ilgili kararı kendi
sorumluluğunda verdiğini kabul edersin. Oyun tarafında doğan kayıplar için tazminat talebi bu koşullar kapsamında yoktur.`,
      en: `The application does not touch game memory or inject code; it keeps its own window on screen and watches the keys you bind.
The behaviour of Roblox's protection systems is not under our control and can change. Therefore **we give no guarantee that you will
not be banned.** You accept that you understand this risk and decide about your account on your own responsibility. Losses arising on
the game side carry no compensation claim under these terms.`
    }
  },
  {
    id: 'service-level',
    title: { tr: '10. Hizmet seviyesi, güncellemeler ve ALPHA', en: '10. Service level, updates and ALPHA' },
    body: {
      tr: `Uygulama "olduğu gibi" ve "mevcut olduğu kadarıyla" sunulur; kesintisiz çalışma veya belirli bir performans
sözleşmesi yoktur. ALPHA aşamasında hatalar, veri modeli değişiklikleri ve geçici erişilemezlikler olabilir. Güncellemeler
GitHub Releases üzerinden dağıtılır ve imzasızdır; Windows "tanınmayan yayıncı" uyarısı gösterebilir. Yanlış ayrıştırılmış
bir strateji yüzünden kaybettiğin zamandan veya bozulan bir koşudan sorumlu değiliz; hataları bildirirsen düzeltmek
isteriz.`,
      en: `The application is provided "as is" and "as available"; there is no undertaking of uninterrupted operation or of a specific
performance level. In ALPHA there may be defects, data-model changes and temporary unavailability. Updates are distributed through
GitHub Releases and are unsigned, so Windows may show an "unknown publisher" warning. We are not responsible for time lost or a run
ruined because a strategy was parsed wrongly; report defects and we will want to fix them.`
    }
  },
  {
    id: 'ip',
    title: { tr: '11. Fikri mülkiyet', en: '11. Intellectual property' },
    body: {
      tr: `Uygulamanın kodu, arayüzü, logosu ve metinleri bize aittir; bu koşulların sana verdiği lisans, kişisel ve
ticari olmayan kullanım içindir, devredilemez ve kopyalama/tersine mühendislik hakkı içermez. Roblox, Tower Defense
Simulator ve Related Games / Fun Labs markaları ilgili sahiplerine aittir; bu proje onların onayladığı veya sponsor
olduğu bir ürün değildir.`,
      en: `The code, interface, logo and text of the application belong to us; the licence these terms grant you is personal,
non-commercial, non-transferable, and contains no right to copy or reverse-engineer. Roblox, Tower Defense Simulator and Related
Games / Fun Labs marks belong to their owners; this project is not endorsed or sponsored by them.`
    }
  },
  {
    id: 'liability',
    title: { tr: '12. Sorumluluk sınırı', en: '12. Limitation of liability' },
    body: {
      tr: `Yasal olarak izin verilen azami ölçüde; dolaylı zararlar, veri kaybı, kâr kaybı, hesap kaybı, oyun içi
kayıplar ve kesintiler için sorumluluk kabul etmeyiz. Bir tüketicinin zorunlu yasal hakları ve kasten verilen zararlar bu
madde ile kısıtlanmaz. Uygulama ücretsiz olduğundan, bu sorumluluk reddi kaydı ücretsiz sunulan bir yazılımın doğal
sonucudur.`,
      en: `To the maximum extent the law allows, we accept no liability for indirect damages, data loss, lost profit, lost accounts,
in-game losses or interruptions. A consumer's mandatory statutory rights and damages caused intentionally are not limited by this
clause. Since the application is free, this limitation is the natural consequence of software provided without charge.`
    }
  },
  {
    id: 'termination',
    title: { tr: '13. Askıya alma ve hesabın sonlandırılması', en: '13. Suspension and termination' },
    body: {
      tr: `Koşulları ihlal ettiğinde içeriği kaldırabilir, hesabı askıya alabilir veya kapatabiliriz; erişebildiğimiz
kanal üzerinden bildiririz ve itirazını ${SUPPORT_EMAIL} adresine yazarak iletebilirsin. Kendi hesabını sildirmek
istediğinde Gizlilik Politikası'nın 13. maddesindeki başvuru akışı işler. Kapatma sonrası kazanılmış coin ve rozetler geri
yüklenmez.`,
      en: `If you breach the terms we may remove content, suspend or close the account; we notify you through the channel we can reach
and you can object by writing to ${SUPPORT_EMAIL}. To delete your own account, the request flow in clause 13 of the Privacy Policy
applies. Coins and badges earned before a closure are not restored.`
    }
  },
  {
    id: 'changes',
    title: { tr: '14. Koşulların değişmesi', en: '14. Changing these terms' },
    body: {
      tr: `Koşulları güncelleyebiliriz. Önemli değişikliklerde yeni sürüm numarasıyla birlikte uygulama içinden tekrar
onayını isteriz; onaylamadan devam edemezsin. Onay kayıtların (hangi sürümü ne zaman ve hangi arayüz diliyle kabul
ettiğin) saklanır. Küçük düzeltimlerde (yazım, çapraz referans) sürüm numarası değişmeyebilir.`,
      en: `We may update these terms. For material changes we ask your acceptance again inside the application with a new version
number, and nothing continues until you accept. Your acceptance records (which version, when, and in which interface language) are
kept. Minor editorial fixes (wording, cross-references) may not change the version number.`
    }
  },
  {
    id: 'law',
    title: { tr: '15. Uygulanacak hukuk ve yetki', en: '15. Governing law and venue' },
    body: {
      tr: `Bu koşullar Türkiye Cumhuriyeti hukukuna tabidir. Zorunlu tüketici hakların ve ikamet ettiğin ülkenin
hukuku saklıdır; bu madde o hakları daraltmaz. Uyuşmazlıklarda önce ${SUPPORT_EMAIL} üzerinden çözüm aramak
her iki tarafın da menfaatinedir.`,
      en: `These terms are governed by the law of the Republic of Turkey. Mandatory consumer rights and the law of your country of
residence remain reserved; this clause does not narrow them. Before a dispute escalates, seeking a resolution through
${SUPPORT_EMAIL} serves both sides.`
    }
  }
]

export const TERMS_DOCUMENT: PolicyDocument = {
  kind: 'terms',
  title: { tr: 'Kullanım Koşulları', en: 'Terms of Use' },
  summary: {
    tr: `Aracı kullanan kişi, ölçümü şişirmez, başkasının belgesini künyesiz yayınlamaz ve oyun tarafındaki riski
bilerek kullanır. Karşılığında hesabı, içeriği ve sanal ekonomisiyle çalışan bir topluluk aracı alır.`,
    en: `A person using the tool does not inflate measurement, does not publish someone else's document without credit, and accepts the
game-side risk knowingly. In return they get a community tool with accounts, content and a virtual economy.`
  },
  sections: TERMS_SECTIONS
}

/* ---------------------------------------------------------------- registry */

export const LEGAL_DOCUMENTS: readonly PolicyDocument[] = [ABOUT_DOCUMENT, PRIVACY_DOCUMENT, TERMS_DOCUMENT]
/** The consent-gated documents only: a product page is not something a user accepts. */
export const POLICY_DOCUMENTS: readonly PolicyDocument[] = [PRIVACY_DOCUMENT, TERMS_DOCUMENT]
export const DEFAULT_POLICY_DOCUMENT = PRIVACY_DOCUMENT

export function policyDocument(kind: PolicyKind): PolicyDocument {
  return LEGAL_DOCUMENTS.find((document) => document.kind === kind) ?? DEFAULT_POLICY_DOCUMENT
}

/**
 * The same document as one markdown file, for the download and the consent transcript. Section titles
 * already carry their clause number, so the export needs no extra numbering.
 */
export function policyToMarkdown(document: PolicyDocument, language: PolicyLanguage, faq: readonly FaqEntry[] = []): string {
  const lines: string[] = [
    `# ${text(document.title, language)}`,
    '',
    `${language === 'tr' ? 'Sürüm' : 'Version'}: ${POLICY_VERSION} · ${text(POLICY_EFFECTIVE_DATE, language)}`,
    '',
    text(document.summary, language),
    ''
  ]

  for (const section of document.sections) {
    lines.push(`## ${text(section.title, language)}`, '', text(section.body, language), '')
  }

  if (faq.length > 0) {
    lines.push(`## ${language === 'tr' ? 'Sık sorulanlar' : 'Frequently asked questions'}`, '')
    for (const entry of faq) lines.push(`### ${text(entry.q, language)}`, '', text(entry.a, language), '')
  }

  return `${lines.join('\n').trim()}\n`
}
