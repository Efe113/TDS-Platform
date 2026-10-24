import { z } from 'zod'

/** Windows accepted by public.get_leaderboard — mirrors the leaderboard_config rows. */
export const LEADERBOARD_WINDOWS = ['all_time', 'weekly', 'daily'] as const
export type LeaderboardWindow = (typeof LEADERBOARD_WINDOWS)[number]

export function isLeaderboardWindow(value: string | null | undefined): value is LeaderboardWindow {
  return value !== undefined && value !== null && (LEADERBOARD_WINDOWS as readonly string[]).includes(value)
}

/** Row shape of public.get_leaderboard, snake_case exactly as PostgREST returns it. */
export const leaderboardRowSchema = z.object({
  rank: z.number().int(),
  strategy_id: z.string().uuid(),
  name: z.string(),
  score: z.coerce.number(),
  is_event_strategy: z.boolean(),
  map_key: z.string().nullable()
})

export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>

export const LEADERBOARD_PAGE_SIZE = 50

/** 0033: the hub can rank strategies or the people behind them. */
export const LEADERBOARD_BOARDS = ['strategies', 'players'] as const
export type LeaderboardBoard = (typeof LEADERBOARD_BOARDS)[number]

/** Player boards use one of these window metrics as the score. */
export const PLAYER_METRICS = ['sessions', 'steps', 'coins', 'publishes'] as const
export type PlayerMetric = (typeof PLAYER_METRICS)[number]

export const LEADERBOARD_LEAGUES = ['diamond', 'gold', 'silver', 'bronze'] as const
export type LeaderboardLeague = (typeof LEADERBOARD_LEAGUES)[number]

export const leaderboardBadgeSchema = z.object({
  code: z.string(),
  name: z.string(),
  tier: z.enum(['bronze', 'silver', 'gold', 'special'])
})

export const leaderboardHubRowSchema = z.object({
  entityId: z.string().uuid(),
  kind: z.enum(['strategy', 'player']),
  rank: z.number().int(),
  previousRank: z.number().int().nullable().default(null),
  /** Positive means the row climbed; null when the previous window has no such row. */
  movement: z.number().int().nullable().default(null),
  score: z.coerce.number(),
  name: z.string(),
  playerId: z.string().uuid().nullable().default(null),
  handle: z.string().nullable().default(null),
  displayName: z.string().nullable().default(null),
  avatarPath: z.string().nullable().default(null),
  frameKey: z.string().nullable().default(null),
  titleName: z.string().nullable().default(null),
  vip: z.boolean().default(false),
  badges: z.array(leaderboardBadgeSchema).default([]),
  badgeCount: z.number().int().default(0),
  topStrategyId: z.string().uuid().nullable().default(null),
  topStrategyName: z.string().nullable().default(null),
  mapKey: z.string().nullable().default(null),
  isEvent: z.boolean().default(false),
  sessions: z.number().int().default(0),
  steps: z.number().int().default(0),
  coins: z.number().int().default(0),
  publishes: z.number().int().default(0),
  streak: z.number().int().default(0),
  activeDays: z.number().int().default(0),
  /** The best strategy-board rank this player ever reached (career context). */
  bestRank: z.number().int().nullable().default(null)
})

export const leaderboardHubMeSchema = leaderboardHubRowSchema.extend({
  percentile: z.number().int().nullable().default(null),
  gapToNext: z.number().nullable().default(null)
})

export const leaderboardHubSchema = z.object({
  board: z.enum(LEADERBOARD_BOARDS),
  metric: z.enum(PLAYER_METRICS),
  window: z.enum(LEADERBOARD_WINDOWS),
  previousWindow: z.enum(LEADERBOARD_WINDOWS).nullable().default(null),
  bucket: z.string(),
  windowStart: z.string().nullable().default(null),
  generatedAt: z.string(),
  total: z.number().int().default(0),
  rows: z.array(leaderboardHubRowSchema).default([]),
  me: leaderboardHubMeSchema.nullable().default(null),
  nearMe: z.array(leaderboardHubRowSchema).default([]),
  movers: z
    .object({
      climbers: z.array(leaderboardHubRowSchema).default([]),
      fallers: z.array(leaderboardHubRowSchema).default([])
    })
    .default({ climbers: [], fallers: [] })
})

export type LeaderboardHubRow = z.infer<typeof leaderboardHubRowSchema>
export type LeaderboardHubMe = z.infer<typeof leaderboardHubMeSchema>
export type LeaderboardHub = z.infer<typeof leaderboardHubSchema>

/**
 * Scores are weighted sums (users * w + decayed uses * w), so they are meaningless as raw numbers:
 * shown with one decimal and only ever compared to their neighbours.
 */
export function formatLeaderboardScore(score: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(score)
}

/** Top 1% / 5% / 15% become diamond / gold / silver; the rest is bronze. */
export function leagueForRank(rank: number | null, total: number): LeaderboardLeague | null {
  if (rank === null || total <= 0 || rank < 1 || rank > total) return null
  // A one-person board must still put its only player in diamond; percentage cut-offs alone would
  // make the leader bronze.
  const diamondCut = Math.max(1, Math.ceil(total * 0.01))
  const goldCut = Math.max(diamondCut + 1, Math.ceil(total * 0.05))
  const silverCut = Math.max(goldCut + 1, Math.ceil(total * 0.15))
  if (rank <= diamondCut) return 'diamond'
  if (rank <= goldCut) return 'gold'
  if (rank <= silverCut) return 'silver'
  return 'bronze'
}

/** Player metrics are counts, not weighted scores: no decimals, compact only when the number is huge. */
export function formatMetricValue(metric: PlayerMetric, value: number): string {
  const compact = (metric === 'coins' || metric === 'steps') && value >= 100_000
  return new Intl.NumberFormat(undefined, compact
    ? { notation: 'compact', maximumFractionDigits: 1 }
    : { maximumFractionDigits: 0 }).format(value)
}
