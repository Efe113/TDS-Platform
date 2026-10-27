import { describe, expect, it } from 'vitest'
import {
  PROFILE_METRICS,
  metricValue,
  profileMetricsSchema,
  profileShowcaseSchema,
  toggleShowcaseCode
} from '../src/domain/profile'

const USER = '50857675-9030-4464-a38c-e21c1ff31a42'

describe('profile showcase contract', () => {
  it('reads a full showcase payload', () => {
    const parsed = profileShowcaseSchema.parse({
      userId: USER,
      handle: 'efedemirkol61f398',
      displayName: null,
      bio: null,
      joinedAt: '2026-10-22T11:00:00Z',
      themeKey: 'toxic',
      themeName: 'Toksik',
      themeAccent: '#7ed957',
      metrics: { strategies_published: 1, sessions_qualified: 2, steps_completed: 34, distinct_maps: 0, active_days: 1, streak: 1, usage_rank_best: 1 },
      badges: [{ code: 'first_steps', name: 'İlk Adımlar', nameEn: 'First Steps', desc: 'x', tier: 'bronze', awardedAt: '2026-10-22T12:00:00Z', publicSlot: 1 }],
      showcase: [{ code: 'first_steps', slot: 1 }],
      strategies: [{ id: USER, slug: 'teehee-1616', name: 'Teehee', timesUsed: 1, status: 'approved', isEventStrategy: false }]
    })
    expect(metricValue(parsed.metrics, 'steps_completed')).toBe(34)
    expect(parsed.badges[0]?.publicSlot).toBe(1)
    expect(parsed.strategies[0]?.slug).toBe('teehee-1616')
  })

  it('falls back to zeroed metrics when the rollup row does not exist yet', () => {
    // The server always emits every key (json_build_object writes nulls), so only metrics/badges
    // may be empty here - the rest of the payload stays required.
    const parsed = profileShowcaseSchema.parse({
      userId: USER,
      handle: 'h',
      displayName: null,
      bio: null,
      joinedAt: 'x',
      themeKey: null,
      themeName: null,
      themeAccent: null,
      metrics: {},
      badges: [],
      showcase: [],
      strategies: []
    })
    expect(metricValue(parsed.metrics, 'streak')).toBe(0)
    expect(parsed.badges).toEqual([])
    expect(parsed.metrics.usage_rank_best).toBeNull()
  })

  it('carries VIP membership and the custom background it unlocks', () => {
    const parsed = profileShowcaseSchema.parse({
      userId: USER,
      handle: 'h',
      displayName: null,
      bio: null,
      joinedAt: 'x',
      themeKey: null,
      themeName: null,
      themeAccent: null,
      vip: true,
      customBackgroundPath: 'backgrounds/50857675-9030-4464-a38c-e21c1ff31a42/1.gif',
      metrics: {},
      badges: [],
      showcase: [],
      strategies: []
    })
    expect(parsed.vip).toBe(true)
    expect(parsed.customBackgroundPath).toContain('.gif')
  })

  it('keeps the showcase at four badges, the same rule the server enforces', () => {
    const four = ['a', 'b', 'c', 'd']
    expect(toggleShowcaseCode(four, 'e')).toEqual({ codes: four, rejected: true })
    expect(toggleShowcaseCode(['a', 'b'], 'c').codes).toEqual(['a', 'b', 'c'])
    expect(toggleShowcaseCode(['a', 'b'], 'a').codes).toEqual(['b'])
  })

  it('shows every metric the rollup computes, not the four that happened to fit', () => {
    // 0020 gave comments_count and upvotes_received real triggers, so hiding them stopped being honest.
    expect(PROFILE_METRICS).toContain('comments_count')
    expect(PROFILE_METRICS).toContain('upvotes_received')
    expect(new Set<string>(PROFILE_METRICS).size).toBe(PROFILE_METRICS.length)
    for (const key of Object.keys(profileMetricsSchema.shape)) expect(PROFILE_METRICS).toContain(key)
  })
})
