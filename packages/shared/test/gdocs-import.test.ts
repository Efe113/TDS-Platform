import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildStrategyIr } from '../src/import/build-ir'
import { strategyIrSchema } from '../src/ir/strategy-ir'
import { splitImageDefinitions, unescapeMarkdown } from '../src/import/markdown'
import { extractDocId, gdocsExportUrl, isBlockedExportResponse } from '../src/import/gdocs'

const fixtureUrl = new URL('./fixtures/teehee_01.md', import.meta.url)
const fixture = readFileSync(fileURLToPath(fixtureUrl), 'utf8')

const FORBIDDEN_KEYS = ['totalcost', 'enemyroster', 'enemies', 'enemylist', 'cost', 'wavescost']

function collectKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((entry, index) => collectKeys(entry, `${path}[${index}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => [...collectKeys(entry, `${path}.${key}`), `${path}.${key}`])
  }
  return []
}

describe('real Google Docs strategy fixture', () => {
  const result = buildStrategyIr({
    markdown: fixture,
    source: 'gdocs-md',
    sourceUrl: 'https://docs.google.com/document/d/1ZW3vM8qrDyfPkrf6kcFZqwFrzbgKdH8U_nQhZVVlFSg/edit'
  })

  it('parses without throwing and yields a valid IR', () => {
    expect(result.report.errors).toEqual([])
    expect(result.ir).not.toBeNull()
    expect(result.draft?.ir.formatVersion).toBe('tds.strategy.ir/v1')
  })

  it('reads title, subtitle and credits', () => {
    expect(result.ir?.meta.name).toBe('Teehee')
    expect(result.ir?.meta.subtitle).toMatch(/solo .*grind/i)
    expect(result.ir?.meta.credit.creator).toContain('myuuuu')
    expect(result.ir?.meta.credit.contributors.join(' ')).toContain('yunwanjia2027')
    expect(result.ir?.meta.credit.sourceUrl).toContain('docs.google.com')
  })

  it('resolves exactly five towers with alternatives', () => {
    const keys = (result.ir?.inventory ?? []).map((slot) => slot.towerKey)
    expect(keys).toEqual(['operator', 'shotgunner', 'commander', 'dj-booth', 'juggernaut'])
    expect(result.ir?.inventory.every((slot) => !slot.unresolved)).toBe(true)
    expect(result.ir?.inventory[1]?.alternatives).toContain('executioner')
    expect(result.ir?.inventory[2]?.alternatives).toContain('merc-base')
  })

  it('splits every arrow into its own overlay step and keeps wave context', () => {
    const steps = result.ir?.steps ?? []
    expect(steps.length).toBeGreaterThanOrEqual(10)
    expect(steps.some((step) => step.action === 'max')).toBe(true)
    expect(steps.some((step) => step.action === 'upgrade')).toBe(true)
    expect(steps.some((step) => step.spec?.includes('Green Track'))).toBe(true)
    expect(steps.some((step) => step.waveFrom === 21)).toBe(true)
    expect(steps[0]?.raw).not.toMatch(/\\\w/)
    expect(new Set(steps.map((step) => step.stepNo)).size).toBe(steps.length)
  })

  it('captures TDS requirements out of the notes', () => {
    const requirements = result.ir?.requirements ?? []
    const byKind = new Map(requirements.map((entry) => [entry.kind, entry]))
    expect(byKind.get('skill-tree')?.value).toBe('not-needed')
    expect(byKind.has('timescale')).toBe(true)
    expect(byKind.has('group')).toBe(true)
    expect(byKind.get('consumable')?.value).toBe('not-needed')
    expect(byKind.get('timescale')?.value).toBe('not-recommended')
    // The detail page prints value and detail side by side, so a value must stay a compact token.
    expect(requirements.every((entry) => entry.value.split(/\s+/).length <= 2)).toBe(true)
    const xp = requirements.filter((entry) => entry.kind === 'tower-xp')
    expect(xp.map((entry) => entry.value)).toEqual(expect.arrayContaining(['operator', 'juggernaut']))
  })

  it('keeps proofs and hall of fame, drops nothing the contract allows', () => {
    expect((result.ir?.proofs ?? []).length).toBeGreaterThan(0)
    expect(result.ir?.proofs.some((proof) => Boolean(proof.bestTime))).toBe(true)
    expect((result.ir?.hallOfFame ?? []).length).toBeGreaterThan(0)
    expect(result.ir?.mutatorRule?.minCount).toBe(5)
    expect((result.ir?.mutators ?? []).length).toBeGreaterThanOrEqual(6)
    expect(result.ir?.mutators.every((mutator) => mutator.matchedBy === 'none')).toBe(true)
    // Icon-only modifiers must not carry the document's leftover emphasis markers as a label.
    expect(
      result.ir?.mutators.every((mutator) => mutator.note === undefined || !/^[*_\s]+$/.test(mutator.note))
    ).toBe(true)
    expect(result.ir?.meta.waveRange).toEqual([1, 40])
    expect(result.ir?.placement.imageRef).toBeTruthy()
    expect(result.report.warnings.some((issue) => issue.code === 'modifiersUnmatched' || issue.code === 'modifiersPending')).toBe(
      false
    )
  })

  it('never emits the banned total-cost or enemy-roster fields', () => {
    const keys = collectKeys(result.ir).map((key) => key.toLowerCase())
    for (const banned of FORBIDDEN_KEYS) {
      expect(keys.some((key) => key.includes(banned))).toBe(false)
    }
  })

  it('flags the fields a human must confirm', () => {
    const codes = result.report.issues.map((issue) => issue.code)
    expect(codes).toContain('eventConfirmationNeeded')
    expect(codes).toContain('mapKeyMissing')
    expect(codes).toContain('gameModeMissing')
    expect(result.report.stats.images).toBe(19)
  })

  it('does not keep base64 payloads in the parsed body', () => {
    const source = splitImageDefinitions(fixture)
    expect(source.imageDefs.size).toBe(19)
    expect(source.body).not.toContain('base64')
    const defBytes = [...source.imageDefs.values()].reduce((total, definition) => total + definition.byteLength, 0)
    expect(defBytes).toBeGreaterThan(0)
    expect(fixture.length - source.body.length).toBeGreaterThan(defBytes / 2)
    expect(unescapeMarkdown('Waves: 1 \\- 20 \\> Max \\$100')).toBe('Waves: 1 - 20 > Max $100')
  })
})

describe('import contract guards', () => {
  it('rejects more than five towers', () => {
    const base = strategyIrSchema.safeParse({
      format: { source: 'manual' },
      meta: {
        name: 'Test',
        difficulty: 'hard',
        gameMode: { key: 'classic', raw: 'classic', resolved: true },
        playerCount: 'solo',
        credit: { creator: 'me' }
      },
      inventory: Array.from({ length: 6 }, (_unused, index) => ({
        towerKey: `t${index}`,
        rawLabel: `t${index}`,
        alternatives: [],
        unresolved: false
      })),
      steps: [{ stepNo: 1, action: 'place', towerKey: 't0', raw: 'Place t0', alternatives: [], unresolved: false }]
    })
    expect(base.success).toBe(false)
  })

  it('surfaces an error instead of throwing on an unrecognised document', () => {
    const result = buildStrategyIr({ markdown: 'just some prose with no structure at all\n\nsecond line', source: 'paste' })
    expect(result.ir).toBeNull()
    expect(result.report.errors.map((issue) => issue.code)).toContain('noSteps')
    expect(result.draft).not.toBeNull()
  })

  it('survives fuzzy markdown input', () => {
    const samples = ['', '|', '| |\n| |', '### \n* ', '![][](' , '[][][]:<>', '# \n| a | b |\n| --- | --- |\n| 1 | 2 |']
    for (const sample of samples) {
      expect(() => buildStrategyIr({ markdown: sample, source: 'paste' })).not.toThrow()
    }
  })

  it('extracts doc ids and detects non-public documents', () => {
    const link = 'https://docs.google.com/document/d/1ZW3vM8qrDyfPkrf6kcFZqwFrzbgKdH8U_nQhZVVlFSg/edit?pli=1&tab=t.0'
    expect(extractDocId(link)?.docId).toBe('1ZW3vM8qrDyfPkrf6kcFZqwFrzbgKdH8U_nQhZVVlFSg')
    expect(gdocsExportUrl('abc', 'md')).toBe('https://docs.google.com/document/d/abc/export?format=md')
    expect(extractDocId('https://docs.google.com/spreadsheets/d/1abc/edit')).toBeUndefined()
    expect(isBlockedExportResponse(404, 'text/html; charset=utf-8')).toBe(true)
    expect(isBlockedExportResponse(200, 'text/markdown; charset=utf-8')).toBe(false)
  })
})
