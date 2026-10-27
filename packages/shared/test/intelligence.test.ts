import { describe, expect, it } from 'vitest'
import {
  creatorFeedItemSchema,
  creatorWatchRowSchema,
  discoverFacetsSchema,
  discoverFiltersSchema,
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

  it('leaves the 0054 deep filters unset unless the member sets them', () => {
    // An absent filter must stay null: the client only sends a parameter it actually has a value for,
    // because an unknown named parameter fails the whole search on an un-migrated database.
    const bare = discoverFiltersSchema.parse({ q: 'crater', offset: 0 })
    expect(bare.playerCount).toBeNull()
    expect(bare.waveFrom).toBeNull()
    expect(bare.waveTo).toBeNull()
    expect(bare.minUses).toBeNull()

    const deep = discoverFiltersSchema.parse({ q: '', offset: 24, playerCount: 'quad', waveFrom: 21, waveTo: 40, minUses: 50 })
    expect(deep.playerCount).toBe('quad')
    expect(deep.waveTo).toBe(40)
    expect(deep.minUses).toBe(50)
  })

  it('reads the author shelf even when the server answers nulls', () => {
    const row = creatorWatchRowSchema.parse({ creatorId: '3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8', handle: 'efe', verified: null })
    expect(row.verified).toBe(false)
    expect(row.newSinceLastSeen).toBe(0)
    expect(row.displayName).toBeNull()

    const item = creatorFeedItemSchema.parse({
      strategyId: '3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8',
      slug: 'crater-quad',
      name: 'Crater quad',
      createdAt: '2026-10-24T09:00:00Z',
      creatorId: '3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8',
      creator: 'Efe',
      fresh: null
    })
    expect(item.fresh).toBe(false)
    expect(item.mapKey).toBeNull()
  })
})
