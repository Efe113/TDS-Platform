import { z } from 'zod'
import type { StrategyIr } from '../ir/strategy-ir'
import type { ReportIssue, ValidationReport } from './report'

/**
 * The importer already knows which labels it could not resolve; this turns that knowledge into the
 * rows the admin gap queue reads. Without it `import_unmatched` stays empty forever and "kataloğa ekle"
 * has nothing to work from, which is exactly how it has been since 0002 created the table.
 *
 * Two sources, on purpose: report issues for things the parser could not place, and the IR itself for
 * things that were placed but never matched a catalog row (an inventory slot can be unresolved without
 * producing a warning, and a modifier icon carries matchedBy long before any issue is written).
 */

export const UNMATCHED_KINDS = ['icon', 'tower', 'mutator', 'map', 'section'] as const

export const unmatchedEntrySchema = z.object({
  kind: z.enum(UNMATCHED_KINDS),
  /** Values are truncated here so a long document line never becomes a giant row in the queue. */
  sample: z.record(z.string(), z.string().max(200))
})

export type UnmatchedKind = (typeof UNMATCHED_KINDS)[number]
export type UnmatchedEntry = z.infer<typeof unmatchedEntrySchema>

/** A queue that floods is a queue nobody opens; 25 rows per import is plenty to act on. */
const MAX_ROWS = 25
const MAX_VALUE = 200

const clip = (value: string): string => value.trim().slice(0, MAX_VALUE)

function sampleOf(fields: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    const text = clip(value ?? '')
    if (text.length > 0) out[key] = text
  }
  return out
}

function issueByCode(issues: ReportIssue[], code: string): ReportIssue[] {
  return issues.filter((issue) => issue.code === code)
}

function fromIr(ir: StrategyIr | null): UnmatchedEntry[] {
  if (!ir) return []

  const towers = ir.inventory
    .filter((slot) => slot.unresolved)
    .map((slot) => ({ kind: 'tower' as const, sample: sampleOf({ label: slot.rawLabel || slot.towerKey, source: 'inventory' }) }))

  const mutators = ir.mutators
    .filter((mutator) => mutator.matchedBy === 'none')
    .map((mutator) => ({
      kind: 'mutator' as const,
      // matchedBy is 'none' by construction, so repeating it would only make an icon with nothing to
      // show look like a row with content. mediaRef is the document's own handle for that icon.
      sample: sampleOf({ icon: mutator.mediaRef ?? '', note: mutator.note ?? '' })
    }))

  return [...towers, ...mutators]
}

function fromReport(report: ValidationReport | null): UnmatchedEntry[] {
  if (!report) return []
  const issues = report.issues

  const towers = issueByCode(issues, 'towerUnresolved').map((issue) => ({
    kind: 'tower' as const,
    sample: sampleOf({ label: issue.sample ?? '', path: issue.path ?? '', source: 'report' })
  }))

  const maps = issues
    .filter((issue) => issue.code === 'mapKeyMissing' || issue.code === 'placementMapMissing')
    .map((issue) => ({ kind: 'map' as const, sample: sampleOf({ reason: issue.code, detail: issue.message }) }))

  const sections = issueByCode(issues, 'unmappedSection').map((issue) => ({
    kind: 'section' as const,
    sample: sampleOf({ heading: issue.path ?? '', firstLine: issue.sample ?? '' })
  }))

  return [...towers, ...maps, ...sections]
}

/**
 * Deduplicated on the label text rather than the whole sample: the same unresolved tower can arrive
 * from the IR and from a report issue, and two rows for one catalog gap is noise the admin has to
 * read through.
 */
function keyText(sample: Record<string, string>): string {
  return sample.label ?? sample.icon ?? sample.reason ?? sample.heading ?? JSON.stringify(sample)
}

export function collectUnmatched(ir: StrategyIr | null, report: ValidationReport | null): UnmatchedEntry[] {
  const seen = new Set<string>()
  const rows: UnmatchedEntry[] = []

  for (const candidate of [...fromIr(ir), ...fromReport(report)]) {
    const parsed = unmatchedEntrySchema.safeParse(candidate)
    if (!parsed.success) continue
    if (Object.keys(parsed.data.sample).length === 0) continue

    const fingerprint = `${parsed.data.kind}:${keyText(parsed.data.sample)}`
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    rows.push(parsed.data)
    if (rows.length >= MAX_ROWS) break
  }

  return rows
}
