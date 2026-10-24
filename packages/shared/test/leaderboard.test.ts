import { describe, expect, it } from 'vitest'
import { formatMetricValue, leagueForRank, leaderboardHubSchema } from '../src/domain/leaderboard'

const ROW = {
  entityId: '50857675-9030-4464-a38c-e21c1ff31a42',
  kind: 'player',
  rank: 1,
  score: 42,
  name: 'Efe',
  handle: 'efe'
}

describe('leaderboard hub contract', () => {
  it('parses a minimal payload and fills the optional columns', () => {
    const parsed = leaderboardHubSchema.parse({
      board: 'players',
      metric: 'sessions',
      window: 'weekly',
      bucket: '2026-43',
      generatedAt: '2026-10-24T18:00:00Z',
      total: 1,
      rows: [ROW]
    })
    expect(parsed.rows[0]?.movement).toBeNull()
    expect(parsed.rows[0]?.vip).toBe(false)
    expect(parsed.me).toBeNull()
    expect(parsed.nearMe).toEqual([])
    expect(parsed.movers.climbers).toEqual([])
    expect(parsed.previousWindow).toBeNull()
  })

  it('accepts a VIP-tagged frame row with cosmetics', () => {
    const parsed = leaderboardHubSchema.parse({
      board: 'strategies',
      metric: 'sessions',
      window: 'all_time',
      bucket: 'all',
      generatedAt: '2026-10-24T18:00:00Z',
      total: 1,
      rows: [
        {
          ...ROW,
          kind: 'strategy',
          frameKey: 'rainbow',
          titleName: 'Kurucu',
          vip: true,
          badges: [{ code: 'first_steps', name: 'İlk Adımlar', tier: 'bronze' }],
          badgeCount: 1
        }
      ]
    })
    expect(parsed.rows[0]?.frameKey).toBe('rainbow')
    expect(parsed.rows[0]?.badges[0]?.tier).toBe('bronze')
  })

  it('maps rank percentiles to leagues, including a one-person board', () => {
    expect(leagueForRank(1, 1)).toBe('diamond')
    expect(leagueForRank(1, 200)).toBe('diamond')
    expect(leagueForRank(3, 200)).toBe('gold')
    expect(leagueForRank(11, 200)).toBe('silver')
    expect(leagueForRank(31, 200)).toBe('bronze')
    expect(leagueForRank(null, 200)).toBeNull()
    expect(leagueForRank(1, 0)).toBeNull()
    expect(leagueForRank(201, 200)).toBeNull()
  })

  it('formats player counts without decimals', () => {
    expect(formatMetricValue('sessions', 1234)).not.toContain('.')
    expect(formatMetricValue('publishes', 0)).toBe('0')
  })
})
