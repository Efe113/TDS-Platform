const HUMAN_TOWER_LABELS: Record<string, string> = {
  'dj-booth': 'DJ Booth',
  'merc-base': 'Merc Base',
  'field-medic': 'Field Medic'
}

/** Mirrors main/overlay/labels.ts prettifyTowerKey so the review screen can label towerKey values. */
export function humanTowerLabel(key: string | undefined): string | undefined {
  if (!key) return undefined
  const known = HUMAN_TOWER_LABELS[key]
  if (known) return known
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export interface WaveValue {
  from: number
  to?: number
}

/** The overlay card only carries a label string, so recover the numbers for localised chips. */
export function parseWave(label: string | undefined): WaveValue | null {
  if (!label) return null
  const range = /(\d{1,3})\s*[-–—]\s*(\d{1,3})/.exec(label)
  if (range?.[1] && range[2]) return { from: Number.parseInt(range[1], 10), to: Number.parseInt(range[2], 10) }
  const single = /(\d{1,3})/.exec(label)
  if (!single?.[1]) return null
  const value = Number.parseInt(single[1], 10)
  return Number.isNaN(value) ? null : { from: value }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const MODIFIER_CODES: readonly string[] = [
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'NumLock',
  'ScrollLock'
]

export function isModifierOnly(code: string): boolean {
  return MODIFIER_CODES.includes(code)
}

const KEY_PREFIXES = ['Key', 'Digit', 'Numpad', 'Arrow', 'Page'] as const

/** event.code values are developer strings; show the readable part to the user. */
/**
 * "3 gün önce" rather than a timestamp: the discover and detail lists compare ages, and an absolute
 * date forces the reader to do the subtraction. Intl does the wording, so no copy keys are needed.
 */
const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60]
]

export function relativeTime(iso: string, locale: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const diff = (then - Date.now()) / 1000
  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= seconds) return formatter.format(Math.round(diff / seconds), unit)
  }
  return formatter.format(Math.round(diff), 'second')
}

export function formatKeyCode(code: string | null): string {
  if (!code) return ''
  for (const prefix of KEY_PREFIXES) {
    if (code.startsWith(prefix)) return code.slice(prefix.length).toUpperCase()
  }
  return code
}
