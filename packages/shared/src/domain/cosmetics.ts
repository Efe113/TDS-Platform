/**
 * Cosmetics registry. The database stores keys (`profiles.frame_key`, `profiles.active_title` and
 * `spend_catalog.ref_code`); the look lives here so a purchased item always renders, and adding a
 * frame later is one entry rather than a migration plus a switch statement.
 */

export type FrameEffect = 'heat' | 'rainbow' | 'aurora' | 'void' | 'toxic' | 'gold'

/**
 * The five surfaces every frame is built from, painted in that order.
 *
 * Five is the product rule (0.3.5): `halo` is the light the frame throws onto the page, `core` is the
 * body of the ring, `spin` is the light that travels around it, `spark` is the particulate that lives
 * on the ring, and `mark` is the one thing only this frame does. A frame with four layers is a ring
 * with decorations; a frame with five is a small machine, and the shelf lists them by name.
 */
export type FrameLayerKey = 'halo' | 'core' | 'spin' | 'spark' | 'mark'

export interface FrameLayer {
  key: FrameLayerKey
  labelTr: string
  labelEn: string
}

export interface FrameSkin {
  key: string
  labelTr: string
  labelEn: string
  /** Ring colour and its glow, written as CSS colours so the profile can paint them directly. */
  ring: string
  glow: string
  effect: FrameEffect
  /** Seconds for one revolution of the travelling light, so no two frames share a tempo. */
  turnSeconds: number
  layers: readonly FrameLayer[]
}

/**
 * Five name pairs, one per layer, in paint order. A tuple rather than an array so a frame written
 * with four layers or six is a type error rather than a runtime surprise - the five-layer rule is a
 * product promise, and the shelf lists the layers by name.
 */
type LayerNames = readonly [
  readonly [string, string],
  readonly [string, string],
  readonly [string, string],
  readonly [string, string],
  readonly [string, string]
]

function frameLayers([halo, core, spin, spark, mark]: LayerNames): readonly FrameLayer[] {
  return [
    { key: 'halo', labelTr: halo[0], labelEn: halo[1] },
    { key: 'core', labelTr: core[0], labelEn: core[1] },
    { key: 'spin', labelTr: spin[0], labelEn: spin[1] },
    { key: 'spark', labelTr: spark[0], labelEn: spark[1] },
    { key: 'mark', labelTr: mark[0], labelEn: mark[1] }
  ]
}

export const FRAME_SKINS: FrameSkin[] = [
  {
    key: 'ember',
    labelTr: 'Ocak çerçevesi',
    labelEn: 'Forge frame',
    ring: '#ff8a3d',
    glow: 'rgba(255, 122, 47, 0.62)',
    effect: 'heat',
    turnSeconds: 5.2,
    layers: frameLayers([
      ['Kor halesi', 'Ember halo'],
      ['Erimiş halka', 'Molten band'],
      ['Dikiş gibi yürüyen ışık', 'Seam of travelling light'],
      ['Yükselen kıvılcımlar', 'Rising sparks'],
      ['Tutuşan kömür patlaması', 'Coal flare pop']
    ])
  },
  {
    key: 'void',
    labelTr: 'Boşluk çerçevesi',
    labelEn: 'Void frame',
    ring: '#9d7bff',
    glow: 'rgba(124, 58, 237, 0.6)',
    effect: 'void',
    turnSeconds: 12,
    layers: frameLayers([
      ['Lens halesi', 'Lensing halo'],
      ['Olay ufku', 'Event horizon'],
      ['Dönen birikim diski', 'Turning accretion disc'],
      ['İçe düşen yıldız tozu', 'Infalling dust'],
      ['Yırtıktan sızan ışık', 'Light leaking from the rift']
    ])
  },
  {
    key: 'aurora',
    labelTr: 'Kutup çerçevesi',
    labelEn: 'Aurora frame',
    ring: '#4fd2ff',
    glow: 'rgba(79, 210, 255, 0.6)',
    effect: 'aurora',
    turnSeconds: 8.4,
    layers: frameLayers([
      ['Kutup parıltısı', 'Polar bloom'],
      ['Buz bandı', 'Ice band'],
      ['Işık perdesi taraması', 'Curtain sweep'],
      ['Kutup yıldızları', 'Polar stars'],
      ['Ters akan şerit', 'Counter ribbon']
    ])
  },
  {
    key: 'gold',
    labelTr: 'Altın çerçevesi',
    labelEn: 'Gold frame',
    ring: '#e6c15a',
    glow: 'rgba(230, 193, 90, 0.55)',
    effect: 'gold',
    turnSeconds: 16,
    layers: frameLayers([
      ['Sıcak hale', 'Warm aura'],
      ['Fırçalanmış metal', 'Brushed metal'],
      ['Ölçülü parlama', 'Specular sweep'],
      ['Altın tozu', 'Gold dust'],
      ['Kazınmış kılcal çizgi', 'Engraved hairline']
    ])
  },
  {
    key: 'rainbow',
    labelTr: 'Gökkuşağı çerçevesi',
    labelEn: 'Rainbow frame',
    ring: '#f472b6',
    glow: 'rgba(244, 114, 182, 0.6)',
    effect: 'rainbow',
    turnSeconds: 10,
    layers: frameLayers([
      ['Spektrum halesi', 'Spectrum aura'],
      ['Tam spektrum bandı', 'Full spectrum band'],
      ['Prizma taraması', 'Prism sweep'],
      ['Yörüngedeki kıvılcımlar', 'Orbiting sparks'],
      ['İç kılcal halka', 'Inner hairline ring']
    ])
  },
  {
    key: 'toxic',
    labelTr: 'Toksik çerçevesi',
    labelEn: 'Toxic frame',
    ring: '#84f95c',
    glow: 'rgba(132, 249, 92, 0.6)',
    effect: 'toxic',
    turnSeconds: 7.6,
    layers: frameLayers([
      ['Asit buğusu', 'Acid fume'],
      ['Kayan asit bandı', 'Boiling acid band'],
      ['Yüzeyde yürüyen köpük', 'Foam running on the surface'],
      ['Zehir kabarcıkları', 'Toxic bubbles'],
      ['Sarkan damla', 'Oozing drip']
    ])
  }
]

export function frameSkin(key: string | null | undefined): FrameSkin | null {
  if (!key) return null
  return FRAME_SKINS.find((frame) => frame.key === key) ?? null
}

/** Titles are free text shown next to the name; the key is what the purchase grants. */
export const TITLE_LIMITS = { min: 2, max: 24 } as const

/** VIP-only title; the database grants it as an entitlement, not as an order. */
export const VIP_TITLE_REF = 'vip_rainbow'

/** Staff-granted tier: the green title arrives with verification, never with a purchase. */
export const VERIFIED_TITLE_REF = 'verified_green'

/** 0040: the organisation title. It replaces the green one on the same account, never beside it. */
export const CORPORATE_TITLE_REF = 'corporate'

export type TitleEffect = 'vip-rainbow' | 'verified-green' | 'corporate'

export function titleEffect(ref: string | null | undefined): TitleEffect | null {
  if (ref === VIP_TITLE_REF) return 'vip-rainbow'
  if (ref === VERIFIED_TITLE_REF) return 'verified-green'
  if (ref === CORPORATE_TITLE_REF) return 'corporate'
  return null
}

export function titleIsValid(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= TITLE_LIMITS.min && trimmed.length <= TITLE_LIMITS.max
}

/**
 * Profile themes (0043) paint the profile itself rather than the app: the banner ground, the avatar
 * ring, the name's edge and the motion layers under them. Discord sells this as its own product, and
 * so does the tier ladder — the flagship `aurum` arrives with VIP, `onyx` with a corporate account,
 * `slate` with verification, and `nebula`/`abyss` are bought with coins.
 *
 * The keys are the same vocabulary `app.profile_theme_unlocked()` carries; a test compares the two so
 * the list cannot drift the way the frame registry did (a skin with no catalog row could never be
 * equipped).
 *
 * 0.3.6 rebuilt these on the contract the frames got in 0049: a theme **is** five named surfaces.
 * Before that the painter hard-coded four child spans and switched on `key === 'nebula'` to add a
 * fifth, which meant `slate` was a ground and a sweep, `onyx` was a ground with two gold lines, and
 * the registry could not tell you what a theme actually contains. Now the registry lists the surfaces,
 * the painter draws whatever is listed, and the shelf sells those five names — so the catalogue row,
 * the vitrine and the pixels are one vocabulary, and a theme that is short a layer cannot compile.
 */
export type ProfileThemeSource = 'vip' | 'verified' | 'corporate' | 'purchase'

/**
 * The surface vocabulary. A key names one CSS recipe in `global.css`, not one colour: `fan` is light
 * engraved from a point below the card, `brush` is a metal band, `caustic` is banded water light.
 */
export type ProfileLayer =
  /** The five signature grounds — one per theme, so the themes differ by shape before colour. */
  | 'fan' | 'brush' | 'facet' | 'cloud' | 'depth'
  /** Sheets that travel: a gas veil, water light, a verification rail. */
  | 'veil' | 'caustic' | 'circuit'
  /** Particle fields, each with its own direction: up, in place, in orbit, down. */
  | 'sparks' | 'stars' | 'dust' | 'motes'
  /** Light: one crossing sheen, and the glow the avatar sits in. */
  | 'sweep' | 'halo'
  /** The edges and texture that only paint. */
  | 'rule' | 'crown' | 'notch' | 'grain'

export interface ProfileThemeLayer {
  key: ProfileLayer
  labelTr: string
  labelEn: string
  /** Seconds for this surface's own cycle; still layers ignore it. */
  seconds: number
  /** How strong the surface is, published as `--pt-op` so one recipe serves five themes. */
  opacity: number
}

type ProfileLayerSpec = readonly [key: ProfileLayer, labelTr: string, labelEn: string, seconds: number, opacity: number]

/** Exactly five surfaces, in the order the painter stacks them. */
export function profileLayers(
  first: ProfileLayerSpec,
  second: ProfileLayerSpec,
  third: ProfileLayerSpec,
  fourth: ProfileLayerSpec,
  fifth: ProfileLayerSpec
): ProfileThemeLayer[] {
  return [first, second, third, fourth, fifth].map(([key, labelTr, labelEn, seconds, opacity]) => ({
    key,
    labelTr,
    labelEn,
    seconds,
    opacity
  }))
}

/** Surfaces that cost nothing per frame, so a weak machine keeps them and only loses the movers. */
export const STILL_PROFILE_LAYERS: readonly ProfileLayer[] = ['facet', 'brush', 'grain', 'rule', 'crown', 'notch', 'depth']

export function isStillProfileLayer(layer: ProfileLayer): boolean {
  return STILL_PROFILE_LAYERS.includes(layer)
}

export function movingProfileLayerCount(skin: ProfileThemeSkin): number {
  return skin.layers.filter((layer) => !isStillProfileLayer(layer.key)).length
}

export interface ProfileThemeSkin {
  key: string
  labelTr: string
  labelEn: string
  /** Three stops painted as the banner ground, darkest last. */
  stops: [string, string, string]
  /** Accent for the name edge, the depth line and the section rules. */
  accent: string
  /** Avatar ring colour, drawn over the frame. */
  ring: string
  source: ProfileThemeSource
  /** Coin price for purchased themes; null for the ones a tier hands out. */
  price: number | null
  descTr: string
  descEn: string
  /** The five surfaces this theme stacks, bottom first. */
  layers: ProfileThemeLayer[]
  /** Set by the 0.3.6 rebuild: every theme is now on the layer engine. */
  renewed: boolean
}

export const PROFILE_THEME_SKINS: ProfileThemeSkin[] = [
  {
    key: 'aurum',
    labelTr: 'Aurum',
    labelEn: 'Aurum',
    stops: ['#3a2a10', '#1a1206', '#0b0803'],
    accent: '#f2c14e',
    ring: '#ffd97a',
    source: 'vip',
    price: null,
    descTr: 'Kazınmış altın yelpazesi, yükselen kıvılcım, erimiş dikiş ve üzerinden geçen parlama.',
    descEn: 'An engraved gold fan, rising sparks, a molten seam and a sheen crossing all of it.',
    renewed: true,
    layers: profileLayers(
      ['fan', 'Kazınmış ışık yelpazesi', 'Engraved light fan', 46, 0.24],
      ['sparks', 'Yükselen kıvılcımlar', 'Rising sparks', 14, 0.72],
      ['halo', 'Avatar halesi', 'Avatar halo', 6.5, 0.5],
      ['sweep', 'Üzerinden geçen parlama', 'Specular sweep', 9, 1],
      ['rule', 'Erimiş altın dikiş', 'Molten gold seam', 0, 0.85]
    )
  },
  {
    key: 'slate',
    labelTr: 'Arduvaz',
    labelEn: 'Slate',
    stops: ['#0d2a20', '#07160f', '#040b08'],
    accent: '#3ecf8e',
    ring: '#8ff3c6',
    source: 'verified',
    price: null,
    descTr: 'Fırçalanmış yeşil metal, dişli alt hizası ve üzerinde yürüyen doğrulama rayı.',
    descEn: 'Brushed green metal, a notched base rule and a verification rail walking over it.',
    renewed: true,
    layers: profileLayers(
      ['brush', 'Fırçalanmış metal bandı', 'Brushed metal band', 0, 0.3],
      ['circuit', 'Yürüyen doğrulama rayı', 'Walking verification rail', 11, 0.55],
      ['sweep', 'Yavaş tek parlama', 'One slow sheen', 13, 1],
      ['notch', 'Dişli alt hizası', 'Notched base rule', 0, 0.7],
      ['grain', 'Mat tane dokusu', 'Matte grain', 0, 0.16]
    )
  },
  {
    key: 'onyx',
    labelTr: 'Oniks',
    labelEn: 'Onyx',
    stops: ['#161310', '#0a0908', '#030303'],
    accent: '#e8b64c',
    ring: '#f6d98a',
    source: 'corporate',
    price: null,
    descTr: 'Taş kesiti zemin, üstte altın baskı çizgisi, yörüngede altın tozu ve kalın alt hizası.',
    descEn: 'A cut-stone ground, a printed gold crown, gold dust in orbit and a heavy base rule.',
    renewed: true,
    layers: profileLayers(
      ['facet', 'Taş kesiti zemini', 'Cut-stone ground', 0, 0.4],
      ['crown', 'Altın baskı çizgisi', 'Printed gold crown', 0, 0.9],
      ['dust', 'Yörüngedeki altın tozu', 'Gold dust in orbit', 22, 0.5],
      ['sweep', 'Geniş düşük parlama', 'Wide low sweep', 16, 1],
      ['rule', 'Kalın alt hizası', 'Heavy base rule', 0, 0.85]
    )
  },
  {
    key: 'nebula',
    labelTr: 'Nebula',
    labelEn: 'Nebula',
    stops: ['#2b1a52', '#141033', '#070518'],
    accent: '#a78bfa',
    ring: '#c4b5fd',
    source: 'purchase',
    price: 1400,
    descTr: 'İki bulut farklı hızda sürükleniyor, altında gaz perdesi, üstünde seyrek yıldız ve çekirdek halesi.',
    descEn: 'Two clouds drift at different speeds over a gas veil, under sparse stars and a core halo.',
    renewed: true,
    layers: profileLayers(
      ['cloud', 'İki katman bulut', 'Two cloud layers', 28, 0.44],
      ['veil', 'Ters yönde gaz perdesi', 'Counter-direction gas veil', 44, 0.3],
      ['halo', 'Çekirdek parlaması', 'Core glow', 7.5, 0.4],
      ['stars', 'Seyrek yıldız alanı', 'Sparse star field', 5.5, 0.62],
      ['grain', 'Film greni', 'Film grain', 0, 0.14]
    )
  },
  {
    key: 'abyss',
    labelTr: 'Abiss',
    labelEn: 'Abyss',
    stops: ['#0a1a24', '#05101a', '#02070c'],
    accent: '#4cc9f0',
    ring: '#7bd88f',
    source: 'purchase',
    price: 2200,
    descTr: 'Derinlik ufku, bant bant su ışığı, süzülen zerreler ve soğuk yıldız alanı.',
    descEn: 'A depth horizon, banded caustic light, sinking motes and a cold star field.',
    renewed: true,
    layers: profileLayers(
      ['depth', 'Derinlik ufku', 'Depth horizon', 0, 0.7],
      ['caustic', 'Bant bant su ışığı', 'Banded caustic light', 12, 0.34],
      ['motes', 'Süzülen zerreler', 'Sinking motes', 9, 0.6],
      ['stars', 'Soğuk yıldız alanı', 'Cold star field', 6.5, 0.8],
      ['rule', 'Soğuk kenar hizası', 'Cold rim rule', 0, 0.75]
    )
  }
]

export const PROFILE_THEME_KEYS = PROFILE_THEME_SKINS.map((theme) => theme.key) as string[]

export function profileThemeSkin(key: string | null | undefined): ProfileThemeSkin | null {
  if (!key) return null
  return PROFILE_THEME_SKINS.find((theme) => theme.key === key) ?? null
}

/** Pronouns sit under the name, Discord-style: short, optional, and free-form. */
export const PRONOUNS_LIMITS = { min: 1, max: 60 } as const

export function pronounsIsValid(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return true
  return trimmed.length >= PRONOUNS_LIMITS.min && trimmed.length <= PRONOUNS_LIMITS.max
}

/** `Gece Kuşu` -> a safe catalogue ref code. */
export function cosmeticSlug(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
}
