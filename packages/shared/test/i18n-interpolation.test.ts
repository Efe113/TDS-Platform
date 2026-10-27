import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * i18next interpolates `{{name}}`, and a single-brace `{name}` is not an error — it is a string the
 * member reads literally. That is how the event band shipped "Ends in {time}" and the wallet chip
 * "During {name}" (and, since an earlier round, the members panel "{name} badges"), so the copy looked
 * finished in review and unfinished on screen.
 *
 * Nothing in the toolchain could see it: the key exists, the type checks, the value is a valid string.
 * These two rules are the whole guard — a brace that is not a pair, and a placeholder whose name
 * disagrees between the two languages.
 */

const here = dirname(fileURLToPath(import.meta.url))
const dictionary = (name: string) => readFileSync(join(here, '../../../apps/desktop/src/renderer/src/i18n', name), 'utf8')

/** `key: 'value'` pairs. Values with embedded quotes are rare enough to skip rather than mis-parse. */
function entries(source: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const match of source.matchAll(/^\s*'([^']+)':\s*'([^']*)',$/gm)) {
    const key = match[1]
    const value = match[2]
    if (key !== undefined && value !== undefined) out.set(key, value)
  }
  return out
}

/**
 * A lone `{word}`. `{{word}}` is a pair and legal; `${word}` is a template hole in code, not copy, so
 * the character before the brace may not be `$` or another brace.
 */
const LONE_BRACE = /(?<![$\{])\{([a-zA-Z]\w*)\}(?!\})/g

const TR = 'extra-tr.ts'
const EN = 'extra-en.ts'

describe('i18n interpolation syntax', () => {
  it('never ships a single-brace placeholder', () => {
    for (const file of [TR, EN]) {
      const offenders: string[] = []
      for (const [key, value] of entries(dictionary(file))) {
        LONE_BRACE.lastIndex = 0
        if (LONE_BRACE.test(value)) offenders.push(`${file} → ${key}: ${value}`)
      }
      expect(offenders, `${file} has placeholders i18next will print verbatim`).toEqual([])
    }
  })

  it('uses the same placeholder names in both languages', () => {
    const tr = entries(dictionary(TR))
    const en = entries(dictionary(EN))
    const vars = (value: string) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort().join(',')
    const mismatched: string[] = []

    for (const [key, value] of tr) {
      const names = vars(value)
      if (names.length === 0) continue
      const other = en.get(key)
      if (other === undefined) {
        mismatched.push(`${key}: interpolated in tr, missing in en`)
      } else if (vars(other) !== names) {
        mismatched.push(`${key}: tr="${names}" en="${vars(other)}"`)
      }
    }
    for (const [key, value] of en) {
      if (vars(value).length > 0 && !tr.has(key)) mismatched.push(`${key}: interpolated in en, missing in tr`)
    }

    expect(mismatched).toEqual([])
  })

  it('keeps the copies that carry a hole honest', () => {
    // The four strings this test exists because of. If one loses its `{{ }}` again, this fails loudly
    // with the sentence the member would actually read.
    const tr = entries(dictionary(TR))
    const en = entries(dictionary(EN))
    expect(tr.get('campaign.endsIn')).toBe('Bitmesine {{time}}')
    expect(en.get('campaign.endsIn')).toBe('Ends in {{time}}')
    expect(tr.get('wallet.campaignBoost')).toBe('{{name}} etkinliğinde')
    expect(en.get('wallet.campaignBoost')).toBe('During {{name}}')
    expect(tr.get('admin.noticeReads')).toBe('{{count}} kişi okudu')
    expect(tr.get('admin.badgesOf')).toBe('{{name}} rozetleri')
  })
})
