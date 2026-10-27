import { z } from 'zod'
import type { MessageKey } from '../i18n/resources'
import type { Translate } from '../i18n/use-t'

/**
 * Badge criteria stay declarative: metric + operator + value inside all_of / any_of.
 *
 * The same object is read by the console editor (0038) and by the member's catalogue page (0053), so the
 * sentence a person sees and the rule the engine awards from are built by one module. That is the point:
 * a badge is the only economy in this app whose condition is prose, and prose written twice drifts.
 */

export const CRITERION_GROUPS = ['all_of', 'any_of'] as const
export type CriterionGroup = (typeof CRITERION_GROUPS)[number]

export interface CriterionRow {
  group: CriterionGroup
  metric: string
  op: string
  value: number
}

/** The metrics `stat_user_rollup` carries, so the editor has a fallback list on an un-migrated database. */
export const BADGE_METRICS = [
  'sessions_qualified',
  'steps_completed',
  'strategies_published',
  'imports_completed',
  'approvals_received',
  'distinct_maps',
  'usage_rank_best',
  'active_days',
  'streak',
  'comments_count',
  'upvotes_received',
  'runs_total'
] as const

/**
 * app.criterion_met (0019) only ever satisfies gte, lte and eq, and badge_metrics.operators defaults to
 * exactly those three. The editor offers a metric's own list, so this is the fallback for a metric the
 * table does not describe — never a longer list, because an operator the engine cannot read is a badge
 * nobody can win.
 */
export const DEFAULT_CRITERION_OPS = ['gte', 'lte', 'eq'] as const

const criterionSchema = z.object({
  metric: z.string().min(1),
  op: z.string().min(1),
  value: z.coerce.number().int()
})

const conditionsSchema = z
  .object({
    all_of: z.array(z.unknown()).default([]),
    any_of: z.array(z.unknown()).default([])
  })
  .passthrough()

/** `null` means the stored JSON is not the declarative shape, so the builder must not overwrite it. */
export function readCriteria(value: unknown): CriterionRow[] | null {
  const parsed = conditionsSchema.safeParse(value)
  if (!parsed.success) return null
  const rows: CriterionRow[] = []
  for (const group of CRITERION_GROUPS) {
    const list = parsed.data[group]
    for (const item of list) {
      const criterion = criterionSchema.safeParse(item)
      if (!criterion.success) return null
      rows.push({ group, metric: criterion.data.metric, op: criterion.data.op, value: criterion.data.value })
    }
  }
  return rows
}

export function writeCriteria(rows: readonly CriterionRow[]): Record<string, unknown> {
  const conditions: Record<string, unknown> = {}
  for (const group of CRITERION_GROUPS) {
    const items = rows
      .filter((row) => row.group === group)
      .map((row) => ({ metric: row.metric, op: row.op, value: row.value }))
    if (items.length > 0) conditions[group] = items
  }
  return conditions
}

export function isCriterionComplete(row: CriterionRow): boolean {
  return row.metric.length > 0 && row.op.length > 0 && Number.isInteger(row.value)
}

/** A key added by an admin for a metric we do not ship copy for must not print as `badgeMetric.foo`. */
function localized(t: Translate, key: string, fallback: string): string {
  const translated = t(key as MessageKey)
  return translated === key ? fallback : translated
}

export function humanMetric(t: Translate, metric: string): string {
  return localized(t, `badgeMetric.${metric}`, metric.replace(/[_-]+/g, ' '))
}

export function humanOp(t: Translate, op: string): string {
  return localized(t, `badgeOp.${op}`, op)
}

/**
 * Word order is a translation, not a concatenation: TR says "nitelikli koşu en az 10", EN says
 * "at least 10 qualified runs". `badges.criterion` carries each language's own order.
 */
function criterionClause(t: Translate, row: CriterionRow): string {
  return t('badges.criterion', { metric: humanMetric(t, row.metric), op: humanOp(t, row.op), value: String(row.value) })
}

export function criteriaSentence(t: Translate, rows: CriterionRow[]): string {
  if (rows.length === 0) return t('badges.noCriteria')
  const mixedGroups = rows.some((row) => row.group === 'all_of') && rows.some((row) => row.group === 'any_of')

  return CRITERION_GROUPS.flatMap((group) => {
    const items = rows.filter((row) => row.group === group)
    if (items.length === 0) return []
    const joined = items.map((row) => criterionClause(t, row)).join(` ${t(group === 'all_of' ? 'badges.joinAnd' : 'badges.joinOr')} `)
    return [mixedGroups ? `(${joined})` : joined]
  }).join(` ${t('badges.joinAnd')} `)
}

export interface CriterionProgress {
  current: number | null
  met: boolean
}

/**
 * The mirror of app.criterion_met (0019) for the member's own numbers: an unknown metric or operator can
 * never satisfy a rule, and it never fakes progress either.
 */
export function criterionProgress(row: CriterionRow, metrics: Record<string, number>): CriterionProgress {
  const current = metrics[row.metric]
  if (current === undefined) return { current: null, met: false }
  switch (row.op) {
    case 'gte':
      return { current, met: current >= row.value }
    case 'lte':
      return { current, met: current <= row.value }
    case 'eq':
      return { current, met: current === row.value }
    default:
      return { current, met: false }
  }
}

/**
 * How far along a criterion is, 0..100. `lte` counts the other way — "en iyi liderlik sırası en az 3"
 * (rank at best within 3) is closer when the rank is smaller — so its ratio is the target over the value.
 */
export function progressRatio(row: CriterionRow, current: number | null): number {
  if (current === null) return 0
  if (criterionProgress(row, { [row.metric]: current }).met) return 100
  const ratio = row.op === 'lte' ? (current <= 0 ? 1 : row.value / current) : row.value <= 0 ? 1 : current / row.value
  return Math.max(0, Math.min(100, Math.round(ratio * 100)))
}
