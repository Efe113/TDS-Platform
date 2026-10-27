import { z } from 'zod'
import {
  appFlagRowSchema,
  auditRowSchema,
  badgeDefinitionRowSchema,
  currencyRuleRowSchema,
  mapCatalogRowSchema,
  memberBadgeRowSchema,
  mutatorCatalogRowSchema,
  queueRowSchema,
  tagCatalogRowSchema,
  towerCatalogRowSchema,
  unmatchedRowSchema,
  versionSnapshotSchema,
  maintenanceState,
  campaignAdminRowSchema,
  campaignDraftPayload,
  campaignRulesPayload,
  type AuditRow,
  type CampaignAdminRow,
  type CampaignDraft,
  type CampaignRuleDraft,
  type MaintenanceMode,
  type MaintenanceState,
  type MemberBadgeRow,
  type QueueRow,
  type ReviewDecision,
  type UnmatchedRow
} from '@tds/shared'
import { supabase } from '../../lib/supabase'
import { NotConfiguredError } from '../../lib/discovery-api'
import type { BulkCatalogKind, BulkCatalogRow } from './catalog-bulk'

export const QUEUE_STATUSES = ['submitted', 'needs_changes'] as const

const QUEUE_SELECT =
  'id,slug,name,status,difficulty,game_mode,player_count,map_key,is_event_strategy,event_key,' +
  'wave_from,wave_to,times_used,rating_avg,rating_count,credit_creator,credit_url,is_author_own,' +
  'owner_id,current_version_id,created_at,updated_at,' +
  'profiles!owner_id(handle,display_name),' +
  'strategy_versions!strategy_id(id,version_no,published_at)'

const AUDIT_SELECT =
  'id,action,entity,entity_id,before_data,after_data,created_at,profiles!admin_id(handle)'

const VERSION_SELECT = 'id,strategy_id,version_no,content,changelog,published_at'

/** Storage layout from migration 0007: `maps/<key>.webp`, `towers/<key>.webp`, `mutators/<key>.webp`. */
export const CATALOG_KINDS = ['maps', 'towers', 'mutators', 'tags'] as const
export type CatalogKind = (typeof CATALOG_KINDS)[number]

export type VersionSnapshot = z.infer<typeof versionSnapshotSchema>
export type CurrencyRuleRow = z.infer<typeof currencyRuleRowSchema>
export type BadgeDefinitionRow = z.infer<typeof badgeDefinitionRowSchema>
export type AppFlagRow = z.infer<typeof appFlagRowSchema>

/** `spend_catalog` and `badge_metrics` have no shared schema yet; the panel only reads both. */
export const spendCatalogRowSchema = z.object({
  sku: z.string(),
  kind: z.string(),
  price: z.number().int(),
  ref_code: z.string().nullable(),
  enabled: z.boolean()
})
export type SpendCatalogRow = z.infer<typeof spendCatalogRowSchema>

export const badgeMetricRowSchema = z.object({
  metric: z.string(),
  source_table: z.string(),
  operators: z.array(z.string()).default([]),
  description: z.string().nullable()
})
export type BadgeMetricRow = z.infer<typeof badgeMetricRowSchema>

/** One editor shape for all four catalogs; unused fields stay neutral for the kind. */
export interface CatalogEntry {
  key: string
  nameEn: string
  nameTr: string
  kind: string
  grp: string
  alias: string[]
  isEvent: boolean
  /** Reward/score coefficient for mutators; 1.30 = +30%. */
  multiplier: number | null
  imagePath: string
}

export const EMPTY_CATALOG_ENTRY: CatalogEntry = {
  key: '',
  nameEn: '',
  nameTr: '',
  kind: '',
  grp: '',
  alias: [],
  isEvent: false,
  multiplier: null,
  imagePath: ''
}

const CATALOG_SELECT: Record<CatalogKind, string> = {
  maps: 'key,name_en,name_tr,image_path,is_event',
  towers: 'key,name_en,name_tr,alias,icon_path',
  mutators: 'key,name_en,name_tr,alias,grp,multiplier,icon_path',
  tags: 'key,kind,name_tr,name_en'
}

export const TAG_KIND_OPTIONS: readonly string[] = ['mode', 'map', 'style', 'difficulty', 'event', 'grind']
export const CURRENCY_RULE_KINDS: readonly string[] = ['usage', 'publish', 'approval', 'badge', 'grant']
export const BADGE_TIERS: readonly string[] = ['bronze', 'silver', 'gold', 'special']
export const BADGE_AWARD_MODES: readonly string[] = ['auto', 'manual']

function requireDb(): NonNullable<typeof supabase> {
  if (!supabase) throw new NotConfiguredError()
  return supabase
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function imageColumnValue(row: Record<string, unknown>): string {
  const stored = row.image_path ?? row.icon_path
  return typeof stored === 'string' ? stored : ''
}

function toEntry(kind: CatalogKind, row: Record<string, unknown>): CatalogEntry {
  return {
    key: String(row.key ?? ''),
    nameEn: String(row.name_en ?? ''),
    nameTr: String(row.name_tr ?? ''),
    kind: kind === 'tags' ? String(row.kind ?? '') : '',
    grp: kind === 'mutators' ? String(row.grp ?? '') : '',
    alias: kind === 'towers' || kind === 'mutators' ? toStringArray(row.alias) : [],
    isEvent: kind === 'maps' ? row.is_event === true : false,
    multiplier: kind === 'mutators' && typeof row.multiplier === 'number' ? row.multiplier : null,
    imagePath: kind === 'tags' ? '' : imageColumnValue(row)
  }
}

export async function fetchQueue(): Promise<QueueRow[]> {
  const db = requireDb()
  const { data, error } = await db
    .from('strategies')
    .select(QUEUE_SELECT)
    .in('status', [...QUEUE_STATUSES])
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  return queueRowSchema.array().parse(data ?? [])
}

export async function reviewStrategy(strategyId: string, decision: ReviewDecision, note: string | null): Promise<void> {
  const db = requireDb()
  const { error } = await db.rpc('admin_review_strategy', {
    p_strategy_id: strategyId,
    p_decision: decision,
    p_note: note && note.trim().length > 0 ? note.trim().slice(0, 500) : null
  })
  if (error) throw new Error(error.message)
}

/** Newest first; the diff card compares the two most recent versions. */
export async function fetchVersionSnapshots(strategyId: string): Promise<VersionSnapshot[]> {
  const db = requireDb()
  const { data, error } = await db
    .from('strategy_versions')
    .select(VERSION_SELECT)
    .eq('strategy_id', strategyId)
    .order('version_no', { ascending: false })
    .limit(10)
  if (error) throw new Error(error.message)
  return versionSnapshotSchema.array().parse(data ?? [])
}

export async function fetchAuditRows(): Promise<AuditRow[]> {
  const db = requireDb()
  const { data, error } = await db
    .from('admin_audit_log')
    .select(AUDIT_SELECT)
    .order('id', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return auditRowSchema.array().parse(data ?? [])
}

export async function fetchUnmatchedRows(): Promise<UnmatchedRow[]> {
  const db = requireDb()
  const { data, error } = await db
    .from('import_unmatched')
    .select('id,job_id,kind,sample,created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  return unmatchedRowSchema.array().parse(data ?? [])
}

/** Column drift should surface as a read error, not as a silently blank catalog row. */
function parseCatalogRows(kind: CatalogKind, rows: unknown): Record<string, unknown>[] {
  if (kind === 'maps') return mapCatalogRowSchema.array().parse(rows).map((row) => ({ ...row }))
  if (kind === 'towers') return towerCatalogRowSchema.array().parse(rows).map((row) => ({ ...row }))
  if (kind === 'mutators') return mutatorCatalogRowSchema.array().parse(rows).map((row) => ({ ...row }))
  return tagCatalogRowSchema.array().parse(rows).map((row) => ({ ...row }))
}

export async function fetchCatalog(kind: CatalogKind): Promise<CatalogEntry[]> {
  const db = requireDb()
  const { data, error } = await db.from(kind).select(CATALOG_SELECT[kind]).order('key')
  if (error) throw new Error(error.message)
  return parseCatalogRows(kind, data ?? []).map((row) => toEntry(kind, row))
}

/** Built through the shared schema, so a half-filled row never reaches PostgREST. */
export function buildCatalogPayload(kind: CatalogKind, entry: CatalogEntry): Record<string, unknown> {
  const key = entry.key.trim().toLowerCase()
  const nameEn = entry.nameEn.trim()
  const nameTr = entry.nameTr.trim()
  const imagePath = entry.imagePath.trim().length > 0 ? entry.imagePath.trim() : null

  if (kind === 'maps') {
    const parsed = mapCatalogRowSchema.parse({ key, name_en: nameEn, name_tr: nameTr, image_path: imagePath, is_event: entry.isEvent })
    return { ...parsed }
  }
  if (kind === 'towers') {
    const parsed = towerCatalogRowSchema.parse({ key, name_en: nameEn, name_tr: nameTr, alias: entry.alias, icon_path: imagePath })
    return { ...parsed }
  }
  if (kind === 'mutators') {
    const grp = entry.grp.trim()
    const parsed = mutatorCatalogRowSchema.parse({
      key,
      name_en: nameEn,
      name_tr: nameTr,
      alias: entry.alias,
      grp: grp.length > 0 ? grp : null,
      multiplier: entry.multiplier,
      icon_path: imagePath
    })
    return { ...parsed }
  }
  const parsed = tagCatalogRowSchema.parse({ key, kind: entry.kind, name_tr: nameTr, name_en: nameEn })
  return { ...parsed }
}

/** The editor validates before enabling save, so an invalid row is never sent to PostgREST. */
export function isCatalogEntryValid(kind: CatalogKind, entry: CatalogEntry): boolean {
  try {
    buildCatalogPayload(kind, entry)
    return true
  } catch {
    return false
  }
}

export async function saveCatalog(kind: CatalogKind, entry: CatalogEntry): Promise<void> {
  const db = requireDb()
  const { error } = await db.from(kind).upsert(buildCatalogPayload(kind, entry))
  if (error) throw new Error(error.message)
}

/**
 * Image columns are deliberately omitted: a bulk paste must not wipe icons uploaded from the
 * single-row editor. `ignoreDuplicates` gives the caller a merge/only-new switch without a
 * second insert path.
 */
export function buildBulkCatalogPayload(kind: BulkCatalogKind, row: BulkCatalogRow): Record<string, unknown> {
  if (kind === 'maps') {
    const parsed = mapCatalogRowSchema.parse({
      key: row.key,
      name_en: row.nameEn,
      name_tr: row.nameTr,
      image_path: null,
      is_event: row.isEvent
    })
    return {
      key: parsed.key,
      name_en: parsed.name_en,
      name_tr: parsed.name_tr,
      is_event: parsed.is_event
    }
  }
  if (kind === 'towers') {
    const parsed = towerCatalogRowSchema.parse({
      key: row.key,
      name_en: row.nameEn,
      name_tr: row.nameTr,
      alias: row.aliases,
      icon_path: null
    })
    return {
      key: parsed.key,
      name_en: parsed.name_en,
      name_tr: parsed.name_tr,
      alias: parsed.alias
    }
  }
  const parsed = mutatorCatalogRowSchema.parse({
    key: row.key,
    name_en: row.nameEn,
    name_tr: row.nameTr,
    alias: row.aliases,
    grp: row.group.length > 0 ? row.group : null,
    multiplier: row.multiplier,
    icon_path: null
  })
  return {
    key: parsed.key,
    name_en: parsed.name_en,
    name_tr: parsed.name_tr,
    alias: parsed.alias,
    grp: parsed.grp,
    multiplier: parsed.multiplier
  }
}

export async function saveCatalogBulk(
  kind: BulkCatalogKind,
  rows: BulkCatalogRow[],
  updateExisting: boolean
): Promise<number> {
  const db = requireDb()
  if (rows.length === 0) return 0
  const payloads = rows.map((row) => buildBulkCatalogPayload(kind, row))
  const { data, error } = await db.from(kind).upsert(payloads, {
    onConflict: 'key',
    ignoreDuplicates: !updateExisting
  }).select('key')
  if (error) throw new Error(error.message)
  // ignoreDuplicates skips existing rows server-side, so the representation is the real count.
  return Array.isArray(data) ? data.length : payloads.length
}

export async function deleteCatalog(kind: CatalogKind, key: string): Promise<void> {
  const db = requireDb()
  const { error } = await db.from(kind).delete().eq('key', key)
  if (error) throw new Error(error.message)
}

export function catalogImagePath(kind: CatalogKind, key: string): string {
  return `${kind}/${key.trim().toLowerCase()}.webp`
}

/** Overwrite is intentional: re-uploading the same key replaces the object in place. */
export async function uploadCatalogImage(kind: CatalogKind, key: string, file: File): Promise<string> {
  const db = requireDb()
  const path = catalogImagePath(kind, key)
  const { error } = await db.storage.from('strategy-media').upload(path, file, {
    upsert: true,
    contentType: file.type.length > 0 ? file.type : 'image/webp'
  })
  if (error) throw new Error(error.message)
  return path
}

export async function fetchCurrencyRules(): Promise<CurrencyRuleRow[]> {
  const db = requireDb()
  const { data, error } = await db.from('currency_rules').select('*').order('code')
  if (error) throw new Error(error.message)
  return currencyRuleRowSchema.array().parse(data ?? [])
}

export async function saveCurrencyRule(rule: CurrencyRuleRow): Promise<void> {
  const db = requireDb()
  const parsed = currencyRuleRowSchema.parse(rule)
  // 0003 revoked direct writes on currency_rules, so the only working path is the admin RPC.
  const { error } = await db.rpc('admin_upsert_rule', {
    p_code: parsed.code,
    p_kind: parsed.kind,
    p_amount: parsed.amount,
    p_unit: parsed.unit,
    p_daily_cap: parsed.daily_cap,
    p_weekly_cap: parsed.weekly_cap,
    p_min_seconds: parsed.min_qualifying_seconds,
    p_min_steps: parsed.min_steps,
    p_enabled: parsed.enabled,
    p_name_tr: parsed.name_tr ?? null,
    p_name_en: parsed.name_en ?? null,
    p_desc_tr: parsed.desc_tr ?? null,
    p_desc_en: parsed.desc_en ?? null,
    // 0038: the icon column had no writer for eleven migrations, and the ledger kind is what the
    // wallet colours by. Both are now explicit parameters instead of silently dropped.
    p_icon: parsed.icon ?? null,
    p_ledger_kind: parsed.ledger_kind,
    p_params: parsed.params
  })
  if (error) throw new Error(error.message)
}

export async function deleteCurrencyRule(code: string): Promise<void> {
  const db = requireDb()
  const { error } = await db.rpc('admin_delete_rule', { p_code: code })
  if (error) throw new Error(error.message)
}

export interface BalanceAdjustment {
  userId: string
  delta: number
  note: string
  idempotencyKey?: string | null
}

/** Manual coin movement. It is a ledger row with a reason, never an edit of the cached balance. */
export async function adjustBalance(input: BalanceAdjustment): Promise<{ balance: number }> {
  const db = requireDb()
  const { data, error } = await db.rpc('admin_adjust_balance', {
    p_user: input.userId,
    p_delta: input.delta,
    p_note: input.note.trim(),
    p_idempotency_key: input.idempotencyKey ?? null
  })
  if (error) throw new Error(error.message)
  const record = (data ?? {}) as Record<string, unknown>
  return { balance: typeof record.balance === 'number' ? record.balance : 0 }
}

export interface MemberOption {
  userId: string
  handle: string
  displayName: string | null
  balance: number
}

const memberOptionSchema = z.object({
  userId: z.string().uuid(),
  handle: z.string(),
  displayName: z.string().nullable().default(null),
  balance: z.number().int().default(0)
})

/** Member picker for the manual money panels; reuses admin_user_search so results match the table. */
export async function searchMembers(query: string): Promise<MemberOption[]> {
  const db = requireDb()
  const { data, error } = await db.rpc('admin_user_search', {
    p_query: query.trim().length > 0 ? query.trim() : null,
    p_limit: 12
  })
  if (error) throw new Error(error.message)
  return memberOptionSchema.array().parse(data ?? [])
}

export interface RuleAward {
  userId: string
  code: string
  amount: number | null
  ignoreLimits: boolean
  note: string
}

export async function awardRule(input: RuleAward): Promise<void> {
  const db = requireDb()
  const { error } = await db.rpc('admin_award_rule', {
    p_user: input.userId,
    p_code: input.code,
    p_amount: input.amount,
    p_ignore_limits: input.ignoreLimits,
    p_note: input.note.trim()
  })
  if (error) throw new Error(error.message)
}

export async function fetchMemberBadges(userId: string): Promise<MemberBadgeRow[]> {
  const db = requireDb()
  const { data, error } = await db.rpc('admin_user_badges', { p_user: userId })
  if (error) throw new Error(error.message)
  return memberBadgeRowSchema.array().parse(data ?? [])
}

export async function awardBadge(userId: string, code: string, payReward: boolean): Promise<void> {
  const db = requireDb()
  const { error } = await db.rpc('admin_award_badge', {
    p_user: userId,
    p_code: code,
    p_pay_reward: payReward
  })
  if (error) throw new Error(error.message)
}

export async function revokeBadge(userId: string, code: string): Promise<void> {
  const db = requireDb()
  const { error } = await db.rpc('admin_revoke_badge', { p_user: userId, p_code: code })
  if (error) throw new Error(error.message)
}

export const adminOrderRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  sku: z.string(),
  price_paid: z.number().int(),
  status: z.enum(['filled', 'reversed', 'failed']),
  grant_note: z.string().nullable().default(null),
  created_at: z.string(),
  profiles: z.object({ handle: z.string().nullable().default(null) }).nullable().default(null)
})
export type AdminOrderRow = z.infer<typeof adminOrderRowSchema>

/**
 * Recent receipts. The console reads the table directly because `orders_read` already lets an admin see
 * every row; only the refund itself is an RPC, since it moves coins and takes an entitlement back.
 */
export async function fetchSpendOrders(query: string | null, status: string | null): Promise<AdminOrderRow[]> {
  const db = requireDb()
  let request = db
    .from('spend_orders')
    .select('id,user_id,sku,price_paid,status,grant_note,created_at,profiles!user_id(handle)')
    .order('id', { ascending: false })
    .limit(60)
  if (status !== null && status !== '') request = request.eq('status', status)
  if (query !== null && query !== '') request = request.ilike('sku', `%${query}%`)
  const { data, error } = await request
  if (error) throw new Error(error.message)
  return adminOrderRowSchema.array().parse(data ?? [])
}

export interface OrderRefund {
  orderId: string
  note: string
  reclaim: boolean
}

export async function refundOrder(input: OrderRefund): Promise<void> {
  const db = requireDb()
  const { error } = await db.rpc('admin_refund_order', {
    p_order: input.orderId,
    p_note: input.note.trim(),
    p_reclaim: input.reclaim
  })
  if (error) throw new Error(error.message)
}

/** Cached balance repaired from the ledger (0041). Returns what the cache holds now. */
export async function reconcileBalance(userId: string, note: string | null): Promise<number> {
  const db = requireDb()
  const { data, error } = await db.rpc('admin_reconcile_balance', { p_user: userId, p_note: note })
  if (error) throw new Error(error.message)
  const record = (data ?? {}) as Record<string, unknown>
  return typeof record.balance === 'number' ? record.balance : 0
}

export async function reconcileDrift(): Promise<number> {
  const db = requireDb()
  const { data, error } = await db.rpc('admin_reconcile_drift', { p_limit: 200 })
  if (error) throw new Error(error.message)
  const record = (data ?? {}) as Record<string, unknown>
  return typeof record.repaired === 'number' ? record.repaired : 0
}

/** Membership granted or withdrawn by hand; withdrawal also takes the bundled frame and title off. */
export async function setVip(userId: string, on: boolean, note: string | null): Promise<void> {
  const db = requireDb()
  const { error } = await db.rpc('admin_set_vip', { p_user: userId, p_on: on, p_note: note })
  if (error) throw new Error(error.message)
}

export async function bulkReviewQueue(ids: string[], decision: 'approve' | 'reject', note: string | null): Promise<number> {
  const db = requireDb()
  const { data, error } = await db.rpc('admin_queue_bulk', {
    p_ids: ids,
    p_decision: decision,
    p_note: note && note.trim().length > 0 ? note.trim().slice(0, 500) : null
  })
  if (error) throw new Error(error.message)
  const record = (data ?? {}) as Record<string, unknown>
  return typeof record.processed === 'number' ? record.processed : ids.length
}

/** Badge art lives in the same public bucket as everything else; the column stores the path. */
export async function uploadBadgeImage(code: string, file: File): Promise<string> {
  const db = requireDb()
  const key = `badges/${code.trim().toLowerCase()}.webp`
  const { error } = await db.storage.from('strategy-media').upload(key, file, {
    upsert: true,
    contentType: file.type.length > 0 ? file.type : 'image/webp'
  })
  if (error) throw new Error(error.message)
  return key
}

export async function fetchSpendCatalog(): Promise<SpendCatalogRow[]> {
  const db = requireDb()
  const { data, error } = await db.from('spend_catalog').select('sku,kind,price,ref_code,enabled').order('sku')
  if (error) throw new Error(error.message)
  return spendCatalogRowSchema.array().parse(data ?? [])
}

export async function fetchAppFlags(): Promise<AppFlagRow[]> {
  const db = requireDb()
  const { data, error } = await db.from('app_flags').select('key,value,updated_at').order('key')
  if (error) throw new Error(error.message)
  return appFlagRowSchema.array().parse(data ?? [])
}

export async function saveAppFlag(key: string, value: unknown, updatedAt: string): Promise<void> {
  const db = requireDb()
  const parsed = appFlagRowSchema.parse({ key, value, updated_at: updatedAt })
  const { error } = await db
    .from('app_flags')
    .upsert({ key: parsed.key, value: parsed.value, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
}

export async function fetchBadgeMetrics(): Promise<BadgeMetricRow[]> {
  const db = requireDb()
  const { data, error } = await db.from('badge_metrics').select('metric,source_table,operators,description').order('metric')
  if (error) throw new Error(error.message)
  return badgeMetricRowSchema.array().parse(data ?? [])
}

export async function fetchBadgeDefinitions(): Promise<BadgeDefinitionRow[]> {
  const db = requireDb()
  const { data, error } = await db.from('badge_definitions').select('*').order('code')
  if (error) throw new Error(error.message)
  return badgeDefinitionRowSchema.array().parse(data ?? [])
}

export async function saveBadgeDefinition(badge: BadgeDefinitionRow): Promise<void> {
  const db = requireDb()
  const parsed = badgeDefinitionRowSchema.parse(badge)
  const { error } = await db.rpc('admin_upsert_badge', {
    p_code: parsed.code,
    p_name_tr: parsed.name_tr,
    p_name_en: parsed.name_en,
    p_desc_tr: parsed.desc_tr,
    p_tier: parsed.tier,
    p_award_mode: parsed.award_mode,
    p_currency_reward: parsed.currency_reward,
    p_conditions: parsed.conditions,
    p_active: parsed.active,
    p_icon_path: parsed.icon_path
  })
  if (error) throw new Error(error.message)
}

export async function deleteBadgeDefinition(code: string): Promise<void> {
  const db = requireDb()
  const { error } = await db.rpc('admin_delete_badge', { p_code: code })
  if (error) throw new Error(error.message)
}

/**
 * Maintenance is read straight off the flag row (app_flags is public-select) and evaluated by the
 * shared rule, which is the same window arithmetic the server runs inside its trigger. One row, one
 * rule, no RPC needed for a status the whole app has to agree on.
 */
export async function fetchMaintenance(): Promise<MaintenanceState> {
  const db = requireDb()
  const { data, error } = await db.from('app_flags').select('value').eq('key', 'maintenance_mode').maybeSingle()
  if (error) throw new Error(error.message)
  return maintenanceState((data as { value?: unknown } | null)?.value, Date.now())
}

export interface MaintenanceInput {
  on: boolean
  mode: MaintenanceMode
  title: string | null
  note: string | null
  startsAt: string | null
  endsAt: string | null
}

/** The RPC owns the flag row, so turning maintenance on is one audited write instead of an edit. */
export async function setMaintenance(input: MaintenanceInput): Promise<MaintenanceState> {
  const db = requireDb()
  const { error } = await db.rpc('admin_set_maintenance', {
    p_on: input.on,
    p_mode: input.mode,
    p_title: input.title,
    p_note: input.note,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt
  })
  if (error) throw new Error(error.message)
  return fetchMaintenance()
}

/**
 * Campaigns (0051). The member's band comes from `active_campaigns()`; the editor reads
 * `admin_list_campaigns()` because it has to see disabled and finished rows too, and it has to read
 * back the three separate inputs (multiplier, fixed amount, cap) rather than the one number the band
 * shows.
 *
 * Two writes, not one: the campaign's own text, then its earning sheet. Saving the sheet replaces it
 * wholesale, which is what a form with rows you can add and remove expects, and it means there is no
 * "which rows did this delete" question for the audit trail.
 */
export async function fetchCampaigns(): Promise<CampaignAdminRow[]> {
  const db = requireDb()
  const { data, error } = await db.rpc('admin_list_campaigns')
  if (error) throw new Error(error.message)
  return campaignAdminRowSchema.array().parse(data ?? [])
}

export async function saveCampaign(draft: CampaignDraft): Promise<string> {
  const db = requireDb()
  const { data, error } = await db.rpc('admin_upsert_campaign', campaignDraftPayload(draft))
  if (error) throw new Error(error.message)
  return String((data as { state?: string } | null)?.state ?? 'off')
}

export async function setCampaignRules(key: string, rules: CampaignRuleDraft[]): Promise<void> {
  const db = requireDb()
  const { error } = await db.rpc('admin_set_campaign_rules', { p_key: key, p_rules: campaignRulesPayload(rules) })
  if (error) throw new Error(error.message)
}

/**
 * Bind or detach a rule of the ordinary economy. The campaign editor offers this because a rule
 * minted for a campaign reads better in the wallet ("etkinliğe özel") than a boosted everyday rule, but
 * 0038's rule writer keeps its kind/unit validations — one editor, one writer.
 */
export async function setRuleCampaign(code: string, campaignKey: string | null): Promise<void> {
  const db = requireDb()
  const { error } = await db.rpc('admin_set_rule_campaign', { p_code: code, p_campaign_key: campaignKey })
  if (error) throw new Error(error.message)
}

export async function deleteCampaign(key: string): Promise<number> {
  const db = requireDb()
  const { data, error } = await db.rpc('admin_delete_campaign', { p_key: key })
  if (error) throw new Error(error.message)
  return Number((data as { rulesDisabled?: number } | null)?.rulesDisabled ?? 0)
}

/** One object per campaign, replaced in place, so re-uploading a poster never piles up versions. */
export function campaignImagePath(key: string): string {
  return `campaigns/${key.trim().toLowerCase()}.webp`
}

export async function uploadCampaignImage(key: string, file: File): Promise<string> {
  const db = requireDb()
  const path = campaignImagePath(key)
  const { error } = await db.storage.from('strategy-media').upload(path, file, {
    upsert: true,
    contentType: file.type.length > 0 ? file.type : 'image/webp'
  })
  if (error) throw new Error(error.message)
  return path
}

export function parseAlias(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

export function formatAlias(alias: readonly string[]): string {
  return alias.join(', ')
}

export function formatJson(value: unknown): string {
  try {
    const text = JSON.stringify(value, null, 2)
    return text === undefined ? 'null' : text
  } catch {
    return String(value)
  }
}

export function parseJsonField(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) as unknown }
  } catch {
    return { ok: false }
  }
}

/** `sample` is free-form jsonb; render scalars as `field: value` lines instead of a JSON blob. */
export function sampleLines(sample: Record<string, unknown>): string[] {
  const lines: string[] = []
  for (const [field, value] of Object.entries(sample)) {
    if (value === null) {
      lines.push(`${field}: null`)
    } else if (typeof value === 'string') {
      lines.push(`${field}: ${value}`)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${field}: ${String(value)}`)
    } else if (Array.isArray(value)) {
      const items = value.map((item) => (typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item)))
      lines.push(`${field}: ${items.join(', ')}`)
    } else {
      lines.push(`${field}: ${JSON.stringify(value)}`)
    }
  }
  return lines
}

const SAMPLE_TEXT_FIELDS: readonly string[] = ['text', 'raw', 'rawText', 'name', 'label', 'value', 'tower', 'mutator', 'map', 'key']

/** The most human-readable string in a gap sample, used to prefill a catalog form. */
export function sampleText(sample: Record<string, unknown>): string | null {
  for (const field of SAMPLE_TEXT_FIELDS) {
    const value = sample[field]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  for (const value of Object.values(sample)) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}
