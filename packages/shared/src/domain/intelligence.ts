import { z } from 'zod'

/**
 * Types for the 0023 strategy-intelligence layer. Every shape here mirrors a `returns jsonb` RPC, so
 * the schemas are the contract: a column renamed server-side fails the parse loudly instead of
 * rendering an empty panel.
 */

export const strategyStatsSchema = z.object({
  runs: z.number().int().nonnegative().default(0),
  qualifiedRuns: z.number().int().nonnegative().default(0),
  uniquePeople: z.number().int().nonnegative().default(0),
  averageStepsReached: z.number().nonnegative().default(0),
  completionPercent: z.number().nonnegative().default(0),
  medianSeconds: z.number().nonnegative().nullable().default(null),
  weekUses: z.number().int().nonnegative().default(0),
  previousWeekUses: z.number().int().nonnegative().default(0)
})

export type StrategyStats = z.infer<typeof strategyStatsSchema>

export const stepHealthEntrySchema = z.object({
  stepNo: z.number().int().positive(),
  backs: z.number().int().nonnegative().default(0),
  resets: z.number().int().nonnegative().default(0),
  worked: z.number().int().nonnegative().default(0),
  stuck: z.number().int().nonnegative().default(0)
})

export type StepHealthEntry = z.infer<typeof stepHealthEntrySchema>

export const stepHealthSchema = z.array(stepHealthEntrySchema).default([])

export const myJourneySchema = z.object({
  runs: z.number().int().nonnegative().default(0),
  bestStep: z.number().int().nonnegative().default(0),
  lastRunAt: z.string().nullable().default(null),
  bestSeconds: z.number().nonnegative().nullable().default(null)
})

export type MyJourney = z.infer<typeof myJourneySchema>

export const stepMarkSchema = z.object({
  stepNo: z.number().int().positive(),
  note: z.string()
})

export const stepMarksSchema = z.array(stepMarkSchema).default([])

export type StepMark = z.infer<typeof stepMarkSchema>

export const watchUpdateSchema = z.object({
  strategyId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  fromVersion: z.number().int().nullable().default(null),
  toVersion: z.number().int().nullable().default(null),
  changedAt: z.string().nullable().default(null)
})

export type WatchUpdate = z.infer<typeof watchUpdateSchema>

export const recentStrategySchema = z.object({
  strategyId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  totalSteps: z.number().int().nonnegative().default(0),
  bestStep: z.number().int().nonnegative().default(0),
  runs: z.number().int().nonnegative().default(0),
  qualifiedRuns: z.number().int().nonnegative().default(0),
  lastRunAt: z.string().nullable().default(null)
})

export type RecentStrategy = z.infer<typeof recentStrategySchema>

export const facetBucketSchema = z.object({
  key: z.string(),
  count: z.number().int().nonnegative()
})

export const discoverFacetsSchema = z.object({
  total: z.number().int().nonnegative().default(0),
  // 0040: the tier buckets count the population the filter itself produces, so the chip's number and
  // the list under it can never disagree. Optional so an un-migrated database still parses.
  verified: z.number().int().nonnegative().optional().default(0),
  corporate: z.number().int().nonnegative().optional().default(0),
  maps: z.array(facetBucketSchema).default([]),
  difficulties: z.array(facetBucketSchema).default([]),
  modes: z.array(facetBucketSchema).default([])
})

export type DiscoverFacets = z.infer<typeof discoverFacetsSchema>
export type FacetBucket = z.infer<typeof facetBucketSchema>

/** Formats a duration the way the rest of the app does it: whole minutes, no false precision. */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || seconds <= 0) return null
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes === 0) return `${String(rest)}s`
  if (rest === 0) return `${String(minutes)}dk`
  return `${String(minutes)}dk ${String(rest)}s`
}

/** Percentage change with a floor for the "no data last week" case, which is not an infinity. */
export function trendDelta(current: number, previous: number): { percent: number | null; up: boolean } {
  if (previous <= 0) return { percent: null, up: current > 0 }
  const percent = Math.round(((current - previous) / previous) * 100)
  return { percent, up: percent >= 0 }
}
