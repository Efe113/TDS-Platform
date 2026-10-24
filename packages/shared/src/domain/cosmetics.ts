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

export function titleIsValid(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= TITLE_LIMITS.min && trimmed.length <= TITLE_LIMITS.max
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
