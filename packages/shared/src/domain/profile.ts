import { z } from 'zod'

/**
 * Contract for public.profile_showcase(uuid) and public.set_public_badges(text[]) (0019).
 * The payload is jsonb built server-side, so keys are camelCase except the metrics object, which is
 * the stat_user_rollup row as-is and therefore snake_case.
 */

export const BADGE_TIERS = ['bronze', 'silver', 'gold', 'special'] as const
export type BadgeTier = (typeof BADGE_TIERS)[number]

export const profileBadgeSchema = z.object({
  code: z.string(),
  name: z.string(),
  nameEn: z.string(),
  desc: z.string().nullable(),
  tier: z.enum(BADGE_TIERS),
  awardedAt: z.string(),
  publicSlot: z.number().int().nullable().default(null)
})

export type ProfileBadge = z.infer<typeof profileBadgeSchema>

export const profileMetricsSchema = z.object({
  strategies_published: z.number().int().default(0),
  approvals_received: z.number().int().default(0),
  imports_completed: z.number().int().default(0),
  steps_completed: z.number().int().default(0),
  sessions_qualified: z.number().int().default(0),
  distinct_maps: z.number().int().default(0),
  usage_rank_best: z.number().int().nullable().default(null),
  active_days: z.number().int().default(0),
  streak: z.number().int().default(0),
  // Owned by M8b; present in the row but not yet computed.
  comments_count: z.number().int().default(0),
  upvotes_received: z.number().int().default(0)
})

export type ProfileMetrics = z.infer<typeof profileMetricsSchema>

export const profileStrategySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  timesUsed: z.number().int(),
  status: z.string(),
  isEventStrategy: z.boolean()
})

export const profileShowcaseSchema = z.object({
  userId: z.string().uuid(),
  handle: z.string(),
  displayName: z.string().nullable(),
  bio: z.string().nullable(),
  joinedAt: z.string(),
  themeKey: z.string().nullable(),
  themeName: z.string().nullable(),
  themeAccent: z.string().nullable(),
  // 0024 additions; optional so a database that has not run the migration still parses.
  avatarPath: z.string().nullable().optional().default(null),
  bannerPath: z.string().nullable().optional().default(null),
  bannerUnlocked: z.boolean().optional().default(false),
  // 0032: VIP membership and the custom hero background it unlocks.
  vip: z.boolean().optional().default(false),
  customBackgroundPath: z.string().nullable().optional().default(null),
  // 0037: the verified tier; credits stay private to the owner and admins.
  verified: z.boolean().optional().default(false),
  verifiedBoostCredits: z.number().int().nonnegative().nullable().optional().default(null),
  titleKey: z.string().nullable().optional().default(null),
  titleName: z.string().nullable().optional().default(null),
  frameKey: z.string().nullable().optional().default(null),
  isSelf: z.boolean().optional().default(false),
  // zod v4 types .default() against the output shape, so the empty-profile fallback is built by
  // parsing {} through the metric schema instead of writing every zero by hand.
  metrics: profileMetricsSchema.default(profileMetricsSchema.parse({})),
  badges: z.array(profileBadgeSchema).default([]),
  showcase: z.array(z.object({ code: z.string(), slot: z.number().int() })).default([]),
  strategies: z.array(profileStrategySchema).default([])
})

export type ProfileShowcase = z.infer<typeof profileShowcaseSchema>

export const PUBLIC_BADGE_SLOTS = 4

/** Metrics worth showing on a profile, in display order, with the copy key for each label. */
export const PROFILE_METRICS = [
  'strategies_published',
  'sessions_qualified',
  'steps_completed',
  'distinct_maps',
  'active_days',
  'streak'
] as const

export type ProfileMetricKey = (typeof PROFILE_METRICS)[number]

export function metricValue(metrics: ProfileMetrics, key: ProfileMetricKey): number {
  const value = metrics[key]
  return typeof value === 'number' ? value : 0
}

/**
 * Toggle helper for the showcase editor: adding a fifth badge is refused by the server, so the
 * client keeps the same rule and reports it instead of letting the click do nothing.
 */
export function toggleShowcaseCode(codes: string[], code: string, limit = PUBLIC_BADGE_SLOTS): { codes: string[]; rejected: boolean } {
  if (codes.includes(code)) return { codes: codes.filter((entry) => entry !== code), rejected: false }
  if (codes.length >= limit) return { codes, rejected: true }
  return { codes: [...codes, code], rejected: false }
}
