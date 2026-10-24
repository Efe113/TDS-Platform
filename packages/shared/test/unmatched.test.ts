import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildStrategyIr } from '../src/import/build-ir'
import { collectUnmatched, unmatchedEntrySchema } from '../src/import/unmatched'
import type { StrategyIr } from '../src/ir/strategy-ir'
import type { ValidationReport } from '../src/import/report'

const fixture = readFileSync(fileURLToPath(new URL('./fixtures/teehee_01.md', import.meta.url)), 'utf8')

/** The collector only reads inventory and mutators, so a stub stays about gaps, not the IR schema. */
function stubIr(overrides: Partial<Pick<StrategyIr, 'inventory' | 'mutators'>>): StrategyIr {
  return { inventory: [], mutators: [], ...overrides } as StrategyIr
}

function stubReport(issues: Array<{ code: string; message: string; path?: string; sample?: string }>): ValidationReport {
  return {
    issues: issues.map((issue) => ({ level: 'warning', ...issue })),
    errors: [],
    warnings: issues.map((issue) => ({ level: 'warning', ...issue })),
    stats: { blocks: 0, sections: 0, images: 0, imageBytes: 0, steps: 0, unresolvedClauses: 0, inventory: 0, mediaSaved: 0 },
    ok: true
  } as ValidationReport
}

describe('gap collector (import_unmatched source)', () => {
  it('reports unresolved inventory slots and unmatched modifier icons', () => {
    const rows = collectUnmatched(
      stubIr({
        inventory: [
          { towerKey: 'mysterious-tower', rawLabel: 'Mysterious Tower', alternatives: [], unresolved: true },
          { towerKey: 'operator', rawLabel: 'Operator', alternatives: [], unresolved: false }
        ],
        mutators: [
          { matchedBy: 'none', raw: '', mediaRef: 'img-7', note: 'x2 coins' },
          { matchedBy: 'text', raw: 'no build time', note: 'no build time' }
        ]
      }),
      null
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ kind: 'tower', sample: { label: 'Mysterious Tower', source: 'inventory' } })
    expect(rows[1]?.kind).toBe('mutator')
    expect(rows[1]?.sample.icon).toBe('img-7')
  })

  it('merges a label found by both the IR and the report into one row', () => {
    const rows = collectUnmatched(
      stubIr({ inventory: [{ towerKey: 'unknown', rawLabel: 'Unknown', alternatives: [], unresolved: true }] }),
      stubReport([{ code: 'towerUnresolved', message: 'Kule adı katalogda bulunamadı', sample: 'Unknown' }])
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.sample.source).toBe('inventory')
  })

  it('keeps map and section gaps from the report', () => {
    const rows = collectUnmatched(
      null,
      stubReport([
        { code: 'mapKeyMissing', message: 'Harita adı metinde geçmiyor' },
        { code: 'placementMapMissing', message: 'Yerleşim haritası görseli bulunamadı' },
        { code: 'unmappedSection', message: 'Tanınmayan bölüm atlandı', path: 'Extra Notes', sample: 'first line' },
        { code: 'noSteps', message: 'not a catalog gap' }
      ])
    )

    expect(rows.map((row) => row.kind)).toEqual(['map', 'map', 'section'])
    expect(rows[2]?.sample).toEqual({ heading: 'Extra Notes', firstLine: 'first line' })
  })

  it('drops rows whose sample is empty and clips overlong values', () => {
    const rows = collectUnmatched(
      stubIr({
        mutators: [
          { matchedBy: 'none', raw: '', note: '' },
          { matchedBy: 'none', raw: '', mediaRef: 'y'.repeat(400) }
        ]
      }),
      null
    )

    expect(rows).toHaveLength(1)
    const icon = rows[0]?.sample.icon
    expect(icon).toBeDefined()
    expect(icon?.length).toBeLessThanOrEqual(200)
    expect(unmatchedEntrySchema.safeParse(rows[0]).success).toBe(true)
  })

  it('never floods the queue from one document', () => {
    const many = Array.from({ length: 60 }, (_unused, index) => ({
      matchedBy: 'none' as const,
      raw: '',
      mediaRef: `img-${String(index)}`
    }))
    const rows = collectUnmatched(stubIr({ mutators: many }), null)
    expect(rows.length).toBeLessThanOrEqual(25)
  })

  it('runs against the real fixture without inventing gaps', () => {
    const built = buildStrategyIr({ markdown: fixture, source: 'gdocs-md' })
    const rows = collectUnmatched(built.ir, built.report)

    // Every row must be something the admin can act on, and the fixture resolves all five towers,
    // so no tower labels may appear here.
    for (const row of rows) expect(row.kind).not.toBe('tower')
    expect(rows.filter((row) => row.kind === 'mutator').length).toBeGreaterThan(0)
  })
})
