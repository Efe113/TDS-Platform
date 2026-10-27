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
 */
export type ProfileThemeSource = 'vip' | 'verified' | 'corporate' | 'purchase'

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
    descTr: 'Kazınmış altın ışınlar, kayan kıvılcım alanı ve parlayan avatar halkası.',
    descEn: 'Engraved gold rays, a drifting spark field and a lit avatar ring.'
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
    descTr: 'Mat yeşil metal zemin, doğrulanmış hesap için sakin bir parıltı.',
    descEn: 'A matte green metal ground with a calm sheen for verified accounts.'
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
    descTr: 'Siyah-altın kurum zemini: kalın kenarlık ve altın baskı çizgisi.',
    descEn: 'A black-and-gold corporate ground: heavy edge and a printed gold rule.'
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
    descTr: 'Mor-mavi bulut katmanları avatarın arkasında yavaşça sürüklenir.',
    descEn: 'Violet and blue cloud layers drifting slowly behind the avatar.'
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
    descTr: 'Yıldız tozlu boşluk zeminine derinlik hizası ve soğuk kenarlık.',
    descEn: 'A starfield void with a depth line and a cold rim.'
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
