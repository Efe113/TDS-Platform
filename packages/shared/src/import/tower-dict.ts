export interface TowerAliasEntry {
  key: string
  aliases: string[]
  labelTr?: string
}

/**
 * Bundled fallback subset, kept in sync with the curated `towers` catalog seed. The
 * authoritative list lives in the database (`alias jsonb`) and is injected via `extraTowers`;
 * a tower that is not in the game must stay out here, or imports invent keys the FK rejects.
 */
export const BUNDLED_TOWERS: TowerAliasEntry[] = [
  { key: 'operator', aliases: ['operator', 'operators'] },
  { key: 'shotgunner', aliases: ['shotgunner', 'shotgunners'] },
  { key: 'executioner', aliases: ['executioner', 'executioners'] },
  { key: 'commander', aliases: ['commander', 'commanders'] },
  { key: 'merc-base', aliases: ['merc base', 'merc bases', 'mercbase', 'merc'] },
  { key: 'dj-booth', aliases: ['dj booth', 'djbooth', 'dj'] },
  { key: 'juggernaut', aliases: ['juggernaut', 'juggernauts'] },
  { key: 'soldier', aliases: ['soldier', 'soldiers'] },
  { key: 'sniper', aliases: ['sniper', 'snipers'] },
  { key: 'ranger', aliases: ['ranger', 'rangers'] },
  { key: 'minigunner', aliases: ['minigunner', 'minigunners', 'minigun'] },
  { key: 'engineer', aliases: ['engineer', 'engineers'] },
  { key: 'medic', aliases: ['medic', 'medics'] }
]

const normalizeKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, '-')
    .replace(/[\s.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

const singularize = (value: string): string =>
  value
    .split('-')
    .map((word) => (word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.endsWith('es') ? word.slice(0, -2) : word.endsWith('s') ? word.slice(0, -1) : word))
    .join('-')

export class TowerDictionary {
  private readonly byAlias = new Map<string, string>()

  constructor(entries: TowerAliasEntry[] = BUNDLED_TOWERS) {
    for (const entry of entries) {
      this.register(entry.key, entry.key)
      for (const alias of entry.aliases) this.register(alias, entry.key)
    }
  }

  add(key: string, aliases: string[] = []): void {
    this.register(key, key)
    for (const alias of aliases) this.register(alias, key)
  }

  private register(alias: string, key: string): void {
    const normalized = normalizeKey(alias)
    if (!normalized) return
    if (!this.byAlias.has(normalized)) this.byAlias.set(normalized, key)
    const singular = singularize(normalized)
    if (singular && !this.byAlias.has(singular)) this.byAlias.set(singular, key)
  }

  lookup(raw: string): string | undefined {
    const normalized = normalizeKey(raw)
    if (!normalized) return undefined
    return this.byAlias.get(normalized) ?? this.byAlias.get(singularize(normalized))
  }
}

export const defaultTowerDictionary = new TowerDictionary()

/** Splits `Shotgunners/Executioners` style labels into the raw alternatives. */
export function splitAlternatives(raw: string): string[] {
  return raw
    .split(/\s*\/\s*/g)
    .map((part) => part.trim())
    .filter(Boolean)
}

const LEVEL_TOKEN_RE = /\b(?:lv|lvl|level|seviye)\s*\.?\s*\d*\b/gi
const DIGIT_RE = /\b\d+\b/g

function tokenize(value: string): string[] {
  return value
    .replace(LEVEL_TOKEN_RE, ' ')
    .replace(DIGIT_RE, ' ')
    .toLowerCase()
    .split(/[^a-zçğıöşü]+/i)
    .filter(Boolean)
}

/** Scans free text for every catalog tower, longest alias window first. */
export function findTowers(text: string, dictionary: TowerDictionary): string[] {
  const words = tokenize(text)
  const keys: string[] = []
  let index = 0

  while (index < words.length) {
    let matched = false
    for (let window = 3; window >= 1; window -= 1) {
      if (index + window > words.length) continue
      const candidate = words.slice(index, index + window).join('-')
      const key = dictionary.lookup(candidate)
      if (key) {
        if (!keys.includes(key)) keys.push(key)
        index += window
        matched = true
        break
      }
    }
    if (!matched) index += 1
  }

  return keys
}

export interface TowerMatch {
  key?: string
  keys: string[]
  raw: string
  alternatives: string[]
  resolved: boolean
}

export function matchTowerLabel(rawLabel: string, dictionary: TowerDictionary): TowerMatch {
  const alternatives = splitAlternatives(rawLabel)
  const keys: string[] = []

  for (const alternative of alternatives) {
    for (const key of findTowers(alternative, dictionary)) {
      if (!keys.includes(key)) keys.push(key)
    }
  }

  const primary = keys[0]
  return {
    key: primary,
    keys,
    raw: rawLabel.trim(),
    alternatives: keys.slice(1),
    resolved: Boolean(primary)
  }
}
