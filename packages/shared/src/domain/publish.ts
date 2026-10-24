import { z } from 'zod'
import type { TranslationKey } from '../i18n/tr'

export const REVIEW_DECISIONS = ['approve', 'needs_changes', 'reject', 'archive', 'feature'] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]

export const STRATEGY_STATUSES = [
  'draft',
  'imported',
  'submitted',
  'needs_changes',
  'approved',
  'rejected',
  'archived',
  'featured'
] as const

/**
 * `submit_strategy` (and the two functions it wraps) raise these codes; the UI maps them to
 * localized text instead of showing a raw Postgres message.
 */
export const PUBLISH_ERROR_KEYS: Record<string, TranslationKey> = {
  ANONYMOUS: 'auth.signedOut',
  NO_STEPS: 'publish.errorSteps',
  NO_INVENTORY: 'publish.errorInventory',
  TOO_MANY_TOWERS: 'publish.errorTowers',
  NO_CREDIT: 'publish.errorCredit',
  NO_DRAFT: 'publish.errorDraft',
  FORBIDDEN: 'publish.errorForbidden',
  NOT_PUBLISHED: 'detail.notPublished'
}

export function publishErrorKey(message: string | undefined): TranslationKey {
  if (!message) return 'publish.errorUnknown'
  const code = Object.keys(PUBLISH_ERROR_KEYS).find((candidate) => message.includes(candidate))
  return code ? (PUBLISH_ERROR_KEYS[code] ?? 'publish.errorUnknown') : 'publish.errorUnknown'
}

export const queueRowSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(STRATEGY_STATUSES),
  difficulty: z.string(),
  game_mode: z.string(),
  player_count: z.string(),
  map_key: z.string().nullable(),
  is_event_strategy: z.boolean(),
  event_key: z.string().nullable(),
  wave_from: z.number().int().nullable(),
  wave_to: z.number().int().nullable(),
  times_used: z.number().int(),
  rating_avg: z.coerce.number().nullable(),
  rating_count: z.number().int(),
  credit_creator: z.string().nullable(),
  credit_url: z.string().nullable(),
  is_author_own: z.boolean(),
  owner_id: z.string().uuid().nullable(),
  current_version_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  profiles: z.object({ handle: z.string(), display_name: z.string().nullable() }).nullable(),
  strategy_versions: z
    .array(z.object({ id: z.string().uuid(), version_no: z.number().int(), published_at: z.string().nullable() }))
    .default([])
})

export type QueueRow = z.infer<typeof queueRowSchema>

export const versionSnapshotSchema = z.object({
  id: z.string().uuid(),
  strategy_id: z.string().uuid(),
  version_no: z.number().int(),
  content: z.unknown(),
  changelog: z.string().nullable(),
  published_at: z.string().nullable()
})

export const auditRowSchema = z.object({
  id: z.number().int(),
  action: z.string(),
  entity: z.string(),
  entity_id: z.string().nullable(),
  before_data: z.unknown(),
  after_data: z.unknown(),
  created_at: z.string(),
  profiles: z.object({ handle: z.string() }).nullable()
})

export type AuditRow = z.infer<typeof auditRowSchema>

export const unmatchedRowSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  kind: z.enum(['icon', 'tower', 'mutator', 'map', 'section']),
  sample: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string()
})

export type UnmatchedRow = z.infer<typeof unmatchedRowSchema>

export const mapCatalogRowSchema = z.object({
  key: z.string().min(2).max(60),
  name_en: z.string().min(1),
  name_tr: z.string().min(1),
  image_path: z.string().nullable().default(null),
  is_event: z.boolean().default(false)
})

export const towerCatalogRowSchema = z.object({
  key: z.string().min(2).max(60),
  name_en: z.string().min(1),
  name_tr: z.string().min(1),
  alias: z.array(z.string()).default([]),
  icon_path: z.string().nullable().default(null)
})

export const mutatorCatalogRowSchema = z.object({
  key: z.string().min(2).max(60),
  name_en: z.string().min(1),
  name_tr: z.string().min(1),
  alias: z.array(z.string()).default([]),
  grp: z.string().nullable().default(null),
  /** Reward/score coefficient: 1.30 means +30%. Null for cosmetic modifiers. */
  multiplier: z.number().positive().nullable().default(null),
  icon_path: z.string().nullable().default(null)
})

export const tagCatalogRowSchema = z.object({
  key: z.string().min(2).max(60),
  kind: z.enum(['mode', 'map', 'style', 'difficulty', 'event', 'grind']),
  name_tr: z.string().min(1),
  name_en: z.string().min(1)
})

export const currencyRuleRowSchema = z.object({
  code: z.string().min(2),
  kind: z.enum(['usage', 'publish', 'approval', 'badge', 'grant']),
  amount: z.number().int(),
  unit: z.string().default('per_event'),
  daily_cap: z.number().int().nullable(),
  weekly_cap: z.number().int().nullable(),
  min_qualifying_seconds: z.number().int().nullable(),
  min_steps: z.number().int().nullable(),
  enabled: z.boolean().default(true),
  params: z.record(z.string(), z.unknown()).default({}),
  // 0029: corporate copy so a custom rule is not just a code in the ledger.
  name_tr: z.string().nullable().optional().default(null),
  name_en: z.string().nullable().optional().default(null),
  desc_tr: z.string().nullable().optional().default(null),
  desc_en: z.string().nullable().optional().default(null)
})

export const badgeDefinitionRowSchema = z.object({
  code: z.string().min(2),
  name_tr: z.string().min(1),
  name_en: z.string().nullable(),
  desc_tr: z.string().nullable(),
  icon_path: z.string().nullable(),
  tier: z.enum(['bronze', 'silver', 'gold', 'special']).default('bronze'),
  conditions: z.record(z.string(), z.unknown()),
  award_mode: z.enum(['auto', 'manual']).default('auto'),
  currency_reward: z.number().int().min(0).default(0),
  active: z.boolean().default(true)
})

export const appFlagRowSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  updated_at: z.string()
})

/** Admin navigation is gated on this, not on a locally stored flag. */
export const isAdminRole = (role: string | null | undefined): boolean => role === 'admin'
export const isModeratorRole = (role: string | null | undefined): boolean => role === 'admin' || role === 'moderator'
