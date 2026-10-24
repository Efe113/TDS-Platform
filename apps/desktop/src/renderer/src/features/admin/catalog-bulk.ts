export type BulkCatalogKind = 'maps' | 'towers' | 'mutators'

export interface BulkCatalogRow {
  line: number
  key: string
  nameTr: string
  nameEn: string
  aliases: string[]
  isEvent: boolean
  group: string
  multiplier: number | null
}

export type BulkCatalogIssueCode = 'key' | 'name' | 'duplicate' | 'multiplier'

export interface BulkCatalogIssue {
  line: number
  code: BulkCatalogIssueCode
  key?: string
}

export interface BulkCatalogParse {
  rows: BulkCatalogRow[]
  issues: BulkCatalogIssue[]
}

const TURKISH: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u'
}

/** One slug rule for typed keys and derived keys, so `Merc Base` and `merc-base` land on one row. */
export function catalogKeyFromName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüâîû]/g, (character) => TURKISH[character] ?? character)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function titleFromKey(key: string): string {
  return key
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(' ')
}

function addAlias(output: string[], seen: Set<string>, value: string): void {
  const trimmed = value.trim()
  if (trimmed.length === 0) return
  const normalized = trimmed.toLocaleLowerCase()
  if (seen.has(normalized)) return
  seen.add(normalized)
  output.push(trimmed)
}

function autoAliases(nameEn: string, nameTr: string, explicit: string[]): string[] {
  const output: string[] = []
  const seen = new Set<string>()
  for (const value of explicit) addAlias(output, seen, value)
  for (const name of [nameEn, nameTr]) {
    const normalized = name.trim().toLocaleLowerCase()
    addAlias(output, seen, normalized)
    const compact = normalized.replace(/\s+/g, '')
    if (compact !== normalized) addAlias(output, seen, compact)
  }
  return output
}

function eventField(value: string | undefined): boolean {
  if (!value) return false
  return /^(1|true|yes|evet|event|etkinlik|x|✓)$/i.test(value.trim())
}

/**
 * Accepts `1.3`, `1.3x`, `+30%` and `30%`. A percentage is converted to the game's coefficient
 * (1 + pct / 100), so the admin sees the same number the catalog row stores.
 */
function multiplierField(value: string | undefined): number | null | 'invalid' {
  const raw = (value ?? '').trim()
  if (raw.length === 0 || /^(none|yok|-|—)$/i.test(raw)) return null
  const normalized = raw.replace(/,/g, '.').replace(/\s+/g, '').replace(/^[×x]/i, '')
  const percent = /^\+?(\d+(?:\.\d+)?)%$/.exec(normalized)
  if (percent?.[1]) {
    const valueNumber = Number(percent[1]) / 100
    return valueNumber > 0 ? 1 + valueNumber : 'invalid'
  }
  const factor = /^(\d+(?:\.\d+)?)(?:x|×)?$/i.exec(normalized)
  if (factor?.[1]) {
    const valueNumber = Number(factor[1])
    return valueNumber > 0 ? valueNumber : 'invalid'
  }
  return 'invalid'
}

/**
 * Bulk format, one record per line:
 * `key | name_tr | name_en | alias1, alias2 | event`
 *
 * A bare `name` line derives its key; a `key | name` line uses the name for both languages.
 * Tabs work too, so a spreadsheet selection can be pasted directly.
 */
export function parseCatalogBulk(kind: BulkCatalogKind, text: string): BulkCatalogParse {
  const rows: BulkCatalogRow[] = []
  const issues: BulkCatalogIssue[] = []
  const seenKeys = new Set<string>()

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = index + 1
    const cleaned = rawLine.replace(/^\s*[-*•]\s+/, '').trim()
    if (cleaned.length === 0 || cleaned.startsWith('#') || cleaned.startsWith('//')) return

    const separator = cleaned.includes('|') ? '|' : cleaned.includes('\t') ? '\t' : null
    const parts = separator ? cleaned.split(separator).map((part) => part.trim()) : [cleaned]
    const keySource = parts[0]?.trim() ?? ''
    let nameTr = parts[1]?.trim() ?? ''
    let nameEn = parts[2]?.trim() ?? ''
    const aliasField = kind === 'maps' ? '' : (parts[3] ?? '')
    const rawEvent = kind === 'maps' ? (parts[4] ?? parts[3] ?? '') : ''
    const group = kind === 'mutators' ? (parts[4] ?? '').trim() : ''

    if (!separator) {
      nameTr = cleaned
      nameEn = cleaned
    }
    if (nameTr.length === 0) nameTr = nameEn
    if (nameEn.length === 0) nameEn = nameTr

    const key = catalogKeyFromName(keySource.length > 0 ? keySource : nameEn.length > 0 ? nameEn : nameTr)
    if (nameTr.length === 0) nameTr = titleFromKey(key)
    if (nameEn.length === 0) nameEn = nameTr

    if (key.length < 2 || key.length > 60) {
      issues.push({ line, code: 'key', key })
      return
    }
    if (nameTr.length === 0 || nameEn.length === 0) {
      issues.push({ line, code: 'name', key })
      return
    }
    if (seenKeys.has(key)) {
      issues.push({ line, code: 'duplicate', key })
      return
    }
    const multiplier = kind === 'mutators' ? multiplierField(parts[5]) : null
    if (multiplier === 'invalid') {
      issues.push({ line, code: 'multiplier', key })
      return
    }
    seenKeys.add(key)

    const explicit = aliasField
      .split(/[,;/]/)
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0)

    rows.push({
      line,
      key,
      nameTr,
      nameEn,
      aliases: kind === 'maps' ? [] : autoAliases(nameEn, nameTr, explicit),
      isEvent: kind === 'maps' ? eventField(rawEvent) : false,
      group,
      multiplier
    })
  })

  return { rows, issues }
}
