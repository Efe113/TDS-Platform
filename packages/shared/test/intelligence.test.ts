import { describe, expect, it } from 'vitest'
import {
  discoverFacetsSchema,
  formatDuration,
  myJourneySchema,
  recentStrategySchema,
  stepHealthSchema,
  strategyStatsSchema,
  trendDelta
} from '../src/index'

describe('intelligence helpers', () => {
  it('formats durations without false precision', () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(0)).toBeNull()
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(180)).toBe('3dk')
    expect(formatDuration(200)).toBe('3dk 20s')
  })

  it('treats a missing baseline as no percentage rather than infinity', () => {
    expect(trendDelta(12, 0)).toEqual({ percent: null, up: true })
    expect(trendDelta(0, 0)).toEqual({ percent: null, up: false })
    expect(trendDelta(30, 20).percent).toBe(50)
    expect(trendDelta(10, 20)).toEqual({ percent: -50, up: false })
  })

  it('parses an empty server result into a usable zero state', () => {
    // The RPCs return '{}' when there is no ledger yet; every panel still has to render.
    const stats = strategyStatsSchema.parse({})
    expect(stats).toMatchObject({ runs: 0, completionPercent: 0, medianSeconds: null })

    const journey = myJourneySchema.parse({})
    expect(journey).toEqual({ runs: 0, bestStep: 0, lastRunAt: null, bestSeconds: null })

    expect(stepHealthSchema.parse(undefined)).toEqual([])
    expect(discoverFacetsSchema.parse({}).total).toBe(0)
  })

  it('accepts the shapes the 0023 RPCs actually emit', () => {
    const health = stepHealthSchema.parse([
      { stepNo: 4, backs: 12, resets: 2, worked: 3, stuck: 7 },
      { stepNo: 9, backs: 0, resets: 0, worked: 1, stuck: 0 }
    ])
    expect(health[0]?.backs).toBe(12)
    expect(health[1]?.stepNo).toBe(9)

    const recent = recentStrategySchema.parse({
      strategyId: '3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8',
      name: 'Crater 4p',
      slug: 'crater-4p',
      totalSteps: 32,
      bestStep: 11,
      runs: 3,
      qualifiedRuns: 1,
      lastRunAt: '2026-10-24T09:00:00Z'
    })
    expect(recent.bestStep).toBe(11)
  })

  it('counts facet buckets for the filter chips', () => {
    const facets = discoverFacetsSchema.parse({
      total: 7,
      maps: [{ key: 'crater', count: 5 }, { key: 'ice', count: 2 }],
      difficulties: [{ key: 'hard', count: 7 }],
      modes: [{ key: 'standard', count: 6 }]
    })
    expect(facets.maps[0]?.count).toBe(5)
    expect(facets.modes).toHaveLength(1)
  })
})
