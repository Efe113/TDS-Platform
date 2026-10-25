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

/**
 * 0038: what a rule earns *for* (business kind) is separated from how it books into the ledger
 * (`ledger_kind`), because the ledger CHECK is a fixed vocabulary the wallet already colours with.
 * The lists here mirror the CHECK constraints in 0038 exactly; a value outside them is rejected by
 * `admin_upsert_rule`, so the admin form and the database cannot drift.
 */
export const CURRENCY_RULE_KINDS = [
  'usage', 'publish', 'approval', 'badge', 'event', 'streak', 'milestone',
  'community', 'referral', 'challenge', 'support', 'grant'
] as const

export const RULE_LEDGER_KINDS = ['usage', 'publish', 'approval', 'badge', 'grant'] as const

/** Also the CHECK list in 0038. `per_event` is the DB default and the fallback. */
export const CURRENCY_RULE_UNITS = [
  'per_event', 'per_qualifying_session', 'per_approved_version', 'per_first_approval', 'per_badge',
  'per_session', 'per_run', 'per_day', 'per_hour', 'per_step', 'per_wave', 'per_percent',
  'per_report', 'per_comment', 'per_vote', 'per_invite', 'flat_once'
] as const

export type CurrencyRuleKind = (typeof CURRENCY_RULE_KINDS)[number]
export type RuleLedgerKind = (typeof RULE_LEDGER_KINDS)[number]
export type CurrencyRuleUnit = (typeof CURRENCY_RULE_UNITS)[number]

/**
 * Which units a kind can be paid on. `flat_once` is always available so a one-off campaign rule is
 * expressible; the rest keep the picker honest instead of letting an admin invent `per_hour` on a
 * publish bonus and wonder why nothing changes.
 */
export const UNITS_BY_KIND: Record<CurrencyRuleKind, readonly CurrencyRuleUnit[]> = {
  usage: ['per_qualifying_session', 'per_session', 'per_run', 'per_hour', 'per_step', 'per_wave', 'flat_once'],
  publish: ['per_approved_version', 'per_event', 'flat_once'],
  approval: ['per_first_approval', 'per_approved_version', 'flat_once'],
  badge: ['per_badge', 'flat_once'],
  event: ['per_event', 'per_wave', 'flat_once'],
  streak: ['per_day', 'flat_once'],
  milestone: ['per_step', 'per_run', 'flat_once'],
  community: ['per_comment', 'per_vote', 'per_report', 'flat_once'],
  referral: ['per_invite', 'flat_once'],
  challenge: ['per_run', 'per_wave', 'flat_once'],
  support: ['per_report', 'flat_once'],
  grant: ['flat_once', 'per_percent']
}

export const currencyRuleRowSchema = z.object({
  code: z.string().min(2),
  kind: z.enum(CURRENCY_RULE_KINDS),
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
  desc_en: z.string().nullable().optional().default(null),
  // 0038: the column existed since 0029 with no writer and no reader; both arrive now.
  icon: z.string().nullable().optional().default(null),
  ledger_kind: z.enum(RULE_LEDGER_KINDS).optional().default('usage')
})

export const badgeDefinitionRowSchema = z.object({
  code: z.string().min(2),
  name_tr: z.string().min(1),
  name_en: z.string().nullable(),
  desc_tr: z.string().nullable(),
  /**
   * 0038: this column finally means something. It holds either an absolute https URL or a
   * `strategy-media` object path (`badges/<code>.webp`); the client resolves it through `storageUrl`,
   * which passes absolute URLs through untouched.
   */
  icon_path: z.string().nullable(),
  tier: z.enum(['bronze', 'silver', 'gold', 'special']).default('bronze'),
  conditions: z.record(z.string(), z.unknown()),
  award_mode: z.enum(['auto', 'manual']).default('auto'),
  currency_reward: z.number().int().min(0).default(0),
  active: z.boolean().default(true)
})

/** Row shape of public.admin_user_badges(): every definition plus whether this member holds it. */
export const memberBadgeRowSchema = z.object({
  code: z.string(),
  name: z.string().nullable().default(null),
  nameEn: z.string().nullable().default(null),
  desc: z.string().nullable().default(null),
  tier: z.enum(['bronze', 'silver', 'gold', 'special']).default('bronze'),
  awardMode: z.enum(['auto', 'manual']).default('auto'),
  reward: z.coerce.number().int().nonnegative().default(0),
  iconPath: z.string().nullable().default(null),
  active: z.boolean().default(true),
  awarded: z.boolean().default(false),
  awardedAt: z.string().nullable().default(null),
  awardedBy: z.string().nullable().default(null)
})

export type MemberBadgeRow = z.infer<typeof memberBadgeRowSchema>

/** Manual admin money moves: the error prefixes the console can translate. */
export function economyErrorKey(
  message: string
): 'admin.errNote' | 'admin.errDelta' | 'admin.errSelf' | 'admin.errRule' | 'admin.errFunds' | 'admin.errOrder' | 'admin.errVip' | 'admin.errGeneric' {
  if (message.startsWith('NOTE_REQUIRED') || message.startsWith('NOTE_LONG')) return 'admin.errNote'
  if (message.startsWith('DELTA_INVALID') || message.startsWith('USER_REQUIRED')) return 'admin.errDelta'
  if (message.startsWith('SELF_FORBIDDEN')) return 'admin.errSelf'
  if (message.startsWith('UNKNOWN_RULE') || message.startsWith('UNKNOWN_BADGE') || message.startsWith('NOT_FOUND')) {
    return 'admin.errRule'
  }
  if (message.startsWith('INSUFFICIENT_FUNDS')) return 'admin.errFunds'
  // 0041: a refund is the one money action that can be attempted twice on the same receipt.
  if (message.startsWith('ORDER_REQUIRED') || message.startsWith('ALREADY_REVERSED')) return 'admin.errOrder'
  if (message.startsWith('NO_VIP_SKU') || message.startsWith('ALREADY_OWNED')) return 'admin.errVip'
  return 'admin.errGeneric'
}

export const appFlagRowSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  updated_at: z.string()
})

/** Admin navigation is gated on this, not on a locally stored flag. */
export const isAdminRole = (role: string | null | undefined): boolean => role === 'admin'
export const isModeratorRole = (role: string | null | undefined): boolean => role === 'admin' || role === 'moderator'
