/**
 * Cosmetics registry. The database stores keys (`profiles.frame_key`, `profiles.active_title` and
 * `spend_catalog.ref_code`); the look lives here so a purchased item always renders, and adding a
 * frame later is one entry rather than a migration plus a switch statement.
 */

export type FrameEffect = 'heat' | 'rainbow' | 'aurora' | 'void' | 'toxic'

export interface FrameSkin {
  key: string
  labelTr: string
  labelEn: string
  /** Ring colour and its glow, written as CSS colours so the profile can paint them directly. */
  ring: string
  glow: string
  /** Animated ring painted by the stylesheet. Absent means a static glow ring. */
  effect?: FrameEffect
}

export const FRAME_SKINS: FrameSkin[] = [
  { key: 'ember', labelTr: 'Kor çerçevesi', labelEn: 'Ember frame', ring: '#ff7a45', glow: 'rgba(255, 106, 43, 0.62)', effect: 'heat' },
  { key: 'void', labelTr: 'Boşluk çerçevesi', labelEn: 'Void frame', ring: '#7c3aed', glow: 'rgba(91, 33, 182, 0.6)', effect: 'void' },
  { key: 'aurora', labelTr: 'Kutup çerçevesi', labelEn: 'Aurora frame', ring: '#38bdf8', glow: 'rgba(56, 189, 248, 0.6)', effect: 'aurora' },
  { key: 'gold', labelTr: 'Altın çerçevesi', labelEn: 'Gold frame', ring: '#e6c15a', glow: 'rgba(230, 193, 90, 0.55)' },
  { key: 'rainbow', labelTr: 'Gökkuşağı çerçevesi', labelEn: 'Rainbow frame', ring: '#f472b6', glow: 'rgba(244, 114, 182, 0.6)', effect: 'rainbow' },
  { key: 'toxic', labelTr: 'Toksik çerçevesi', labelEn: 'Toxic frame', ring: '#7ed957', glow: 'rgba(126, 217, 87, 0.6)', effect: 'toxic' }
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
