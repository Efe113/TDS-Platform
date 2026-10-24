import { z } from 'zod'

/** Badge criteria stay declarative: metric + operator + value inside all_of / any_of. */
export const CRITERION_GROUPS = ['all_of', 'any_of'] as const
export type CriterionGroup = (typeof CRITERION_GROUPS)[number]

export interface CriterionRow {
  group: CriterionGroup
  metric: string
  op: string
  value: number
}

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
