import { z } from 'zod'

/**
 * Campaigns (0051): earning with a beginning and an end.
 *
 * The server owns the money. `app.campaign_overlay_for_rule()` decides which live campaign speaks for
 * a rule and `award_currency()` pays through it, so the multiplier is never a number the client can
 * suggest. What this file adds is the other half of the same rule: the member's banner has to say the
 * thing the ledger will do, and a band that promises "×2 until Monday" while the server is past
 * `ends_at` is a lie about money.
 *
 * So the window arithmetic is written twice on purpose — `app.campaign_state()` in SQL and
 * `campaignStateOf()` here, over the same `starts_at` / `ends_at` / `enabled` triple the reader already
 * ships — and a test compares them. The client evaluates the row it was given; it does not trust a
 * second answer, and it does not ask the server what time it is every second just to draw a countdown.
 *
 * Two surfaces, one meaning: `banner` is a band across the top of the app with the short line and a
 * door to the detail; `modal` opens on its own. The operator picks one, because the difference is
 * how much of the member's attention the campaign is allowed to take.
 */

export const CAMPAIGN_SURFACES = ['banner', 'modal'] as const
export type CampaignSurface = (typeof CAMPAIGN_SURFACES)[number]

export const CAMPAIGN_STATES = ['off', 'upcoming', 'live', 'ended'] as const
export type CampaignState = (typeof CAMPAIGN_STATES)[number]

/** One rule inside a campaign: the base rule's own numbers, plus what the campaign makes of them. */
export const campaignRuleSchema = z.object({
  code: z.string(),
  nameTr: z.string().nullable().default(null),
  nameEn: z.string().nullable().default(null),
  kind: z.string(),
  unit: z.string(),
  /** What the rule says on an ordinary day. */
  baseAmount: z.coerce.number().int(),
  /** What one qualifying event pays right now, computed in SQL so the banner and the ledger agree. */
  effectiveAmount: z.coerce.number().int(),
  multiplier: z.coerce.number().default(1),
  dailyCap: z.coerce.number().int().nullable().default(null),
  noteTr: z.string().nullable().default(null),
  noteEn: z.string().nullable().default(null),
  /** True when the rule exists only for this campaign, rather than being boosted by it. */
  own: z.boolean().default(false)
})

export type CampaignRule = z.infer<typeof campaignRuleSchema>

/** The row `active_campaigns()` ships, already narrowed to live and soon-to-open campaigns. */
export const activeCampaignSchema = z.object({
  key: z.string(),
  nameTr: z.string(),
  nameEn: z.string(),
  descTr: z.string(),
  descEn: z.string(),
  bodyTr: z.string().nullable().default(null),
  bodyEn: z.string().nullable().default(null),
  startsAt: z.string(),
  endsAt: z.string(),
  state: z.enum(CAMPAIGN_STATES).catch('live'),
  surface: z.enum(CAMPAIGN_SURFACES).catch('banner'),
  accent: z.string().nullable().default(null),
  imagePath: z.string().nullable().default(null),
  actionLabelTr: z.string().nullable().default(null),
  actionLabelEn: z.string().nullable().default(null),
  actionUrl: z.string().nullable().default(null),
  rules: z.array(campaignRuleSchema).default([])
})

export type ActiveCampaign = z.infer<typeof activeCampaignSchema>

export const activeCampaignsSchema = z.array(activeCampaignSchema)

/** A malformed row must not take the band down with it; one bad campaign is skipped, not fatal. */
export function parseActiveCampaigns(value: unknown): ActiveCampaign[] {
  if (!Array.isArray(value)) return []
  const out: ActiveCampaign[] = []
  for (const entry of value) {
    const parsed = activeCampaignSchema.safeParse(entry)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

function time(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * The same four lines as `app.campaign_state()`. An unknown or unparseable date reads as live rather
 * than as off: a campaign the operator can see in the shelf must not silently stop paying, and the
 * server's own row is the authority on money either way.
 */
export function campaignStateOf(
  campaign: { startsAt: string; endsAt: string },
  nowMs: number
): CampaignState {
  const starts = time(campaign.startsAt)
  const ends = time(campaign.endsAt)
  if (starts !== null && starts > nowMs) return 'upcoming'
  if (ends !== null && ends <= nowMs) return 'ended'
  return 'live'
}

export interface CampaignCountdown {
  state: CampaignState
  /** Milliseconds until it opens, when it has not opened yet. */
  startsInMs: number | null
  /** Milliseconds left, while it runs. */
  endsInMs: number | null
  /** Whole window, for "3 gün" in the admin list. */
  spansMs: number | null
}

export function campaignCountdown(campaign: { startsAt: string; endsAt: string }, nowMs: number): CampaignCountdown {
  const starts = time(campaign.startsAt)
  const ends = time(campaign.endsAt)
  const state = campaignStateOf(campaign, nowMs)
  return {
    state,
    startsInMs: state === 'upcoming' && starts !== null ? starts - nowMs : null,
    endsInMs: state === 'live' && ends !== null ? ends - nowMs : null,
    spansMs: starts !== null && ends !== null ? ends - starts : null
  }
}

/**
 * `×2` when the campaign multiplies, `600` when it fixes the amount, `''` for a plain rule.
 *
 * The multiplier is checked first because it is the cheaper thing to read: a member who sees 40 coin
 * in the ordinary list and 80 in the band learns more from "×2" than from the second number, and the
 * fixed amount only matters when nobody multiplied anything.
 */
export function campaignRuleBadge(rule: CampaignRule): string {
  if (rule.multiplier !== 1) {
    const label = Number.isInteger(rule.multiplier) ? String(rule.multiplier) : rule.multiplier.toFixed(1)
    return `×${label}`
  }
  if (rule.effectiveAmount !== rule.baseAmount) return String(rule.effectiveAmount)
  return ''
}

/** A campaign worth showing as a band: live, or opening within the two days the reader ships. */
export function campaignIsVisible(campaign: { startsAt: string; endsAt: string }, nowMs: number): boolean {
  const state = campaignStateOf(campaign, nowMs)
  if (state === 'live') return true
  if (state !== 'upcoming') return false
  const starts = time(campaign.startsAt)
  return starts !== null && starts - nowMs <= 2 * 24 * 60 * 60 * 1000
}

/** The detail door only exists when there is a story longer than the band's line. */
export function campaignHasDetail(campaign: ActiveCampaign): boolean {
  return (campaign.bodyTr ?? '').trim().length > 0 || (campaign.bodyEn ?? '').trim().length > 0
}

/* ------------------------------------------------------------------ the operator's draft */

/**
 * The editor's view of a rule, which is deliberately not the member's view. A band can show "×2 → 800";
 * the editor has to read back exactly what was saved — multiplier, fixed amount, cap override — so the
 * row it lists keeps the three inputs separate instead of the one computed number the member gets.
 */
export const campaignRuleAdminSchema = z.object({
  code: z.string(),
  multiplier: z.coerce.number().default(1),
  amountOverride: z.coerce.number().int().nullable().default(null),
  dailyCapOverride: z.coerce.number().int().nullable().default(null),
  noteTr: z.string().nullable().default(null),
  noteEn: z.string().nullable().default(null),
  ruleNameTr: z.string().nullable().default(null),
  ruleNameEn: z.string().nullable().default(null),
  ruleKind: z.string().default(''),
  ruleUnit: z.string().default(''),
  ruleAmount: z.coerce.number().int().default(0),
  own: z.boolean().default(false)
})

export type CampaignRuleAdmin = z.infer<typeof campaignRuleAdminSchema>

/** A campaign in any state, with its earning sheet: what `admin_list_campaigns()` ships. */
export const campaignAdminRowSchema = activeCampaignSchema
  .omit({ state: true })
  .extend({
    state: z.enum(CAMPAIGN_STATES).default('off'),
    enabled: z.boolean().default(true),
    rules: z.array(campaignRuleAdminSchema).default([]),
    boundRules: z
      .array(z.object({ code: z.string(), nameTr: z.string().nullable().default(null), nameEn: z.string().nullable().default(null), enabled: z.boolean().default(true) }))
      .default([])
  })

export type CampaignAdminRow = z.infer<typeof campaignAdminRowSchema>

/** Draft → RPC arguments. Empty strings become null so the server's own nullif() sees an absent value. */
export function campaignDraftPayload(draft: CampaignDraft): Record<string, unknown> {
  return {
    p_key: draft.key.trim().toLowerCase(),
    p_name_tr: draft.nameTr.trim(),
    p_name_en: draft.nameEn.trim(),
    p_desc_tr: draft.descTr.trim(),
    p_desc_en: draft.descEn.trim(),
    p_body_tr: draft.bodyTr.trim() || null,
    p_body_en: draft.bodyEn.trim() || null,
    p_starts_at: draft.startsAt || null,
    p_ends_at: draft.endsAt || null,
    p_surface: draft.surface,
    p_accent: draft.accent.trim() || null,
    p_image_path: draft.imagePath,
    p_action_label_tr: draft.actionLabelTr.trim() || null,
    p_action_label_en: draft.actionLabelEn.trim() || null,
    p_action_url: draft.actionUrl.trim() || null,
    p_enabled: draft.enabled
  }
}

/** The rule sheet as the server wants it: numbers, not the strings an input field carries. */
export function campaignRulesPayload(rules: CampaignRuleDraft[]): Record<string, unknown>[] {
  return rules
    .filter((rule) => rule.code.length > 0)
    .map((rule) => ({
      code: rule.code,
      multiplier: rule.multiplier,
      amountOverride: rule.amountOverride,
      dailyCapOverride: rule.dailyCapOverride,
      noteTr: rule.noteTr.trim(),
      noteEn: rule.noteEn.trim()
    }))
}

export function campaignAdminToDraft(row: CampaignAdminRow): CampaignDraft {
  return {
    key: row.key,
    nameTr: row.nameTr,
    nameEn: row.nameEn,
    descTr: row.descTr,
    descEn: row.descEn,
    bodyTr: row.bodyTr ?? '',
    bodyEn: row.bodyEn ?? '',
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    surface: row.surface,
    accent: row.accent ?? '',
    imagePath: row.imagePath,
    actionLabelTr: row.actionLabelTr ?? '',
    actionLabelEn: row.actionLabelEn ?? '',
    actionUrl: row.actionUrl ?? '',
    enabled: row.enabled,
    rules: row.rules.map((rule) => ({
      code: rule.code,
      multiplier: rule.multiplier,
      amountOverride: rule.amountOverride,
      dailyCapOverride: rule.dailyCapOverride,
      noteTr: rule.noteTr ?? '',
      noteEn: rule.noteEn ?? ''
    }))
  }
}


/** What the admin form edits, one campaign plus its earning sheet. */
export interface CampaignRuleDraft {
  code: string
  multiplier: number
  /** Empty means "no fixed amount"; a number replaces the rule's own per-event ceiling. */
  amountOverride: number | null
  dailyCapOverride: number | null
  noteTr: string
  noteEn: string
}

export interface CampaignDraft {
  key: string
  nameTr: string
  nameEn: string
  descTr: string
  descEn: string
  bodyTr: string
  bodyEn: string
  startsAt: string
  endsAt: string
  surface: CampaignSurface
  accent: string
  imagePath: string | null
  actionLabelTr: string
  actionLabelEn: string
  actionUrl: string
  enabled: boolean
  rules: CampaignRuleDraft[]
}

export const CAMPAIGN_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/
export const CAMPAIGN_ACCENT_PATTERN = /^#[0-9a-fA-F]{6}$/
/** The renderer puts this in a link, so only https and the app's own scheme. Mirrors campaigns_action_check. */
export const CAMPAIGN_ACTION_PATTERN = /^(https:\/\/|tdsapp:\/\/)/
export const CAMPAIGN_MULTIPLIER_LIMITS = { min: 0.1, max: 5 } as const
/** Two days of notice is what `active_campaigns()` ships, so the form must not offer more. */
export const CAMPAIGN_LEAD_DAYS = 2

/**
 * The validations the RPC enforces, run first so an operator reads "bitiş başlangıçtan sonra olmalı"
 * in the form instead of a server error in a toast. Message keys, not text: the form translates them.
 * Returns one entry per problem, ordered the way the form lays them out.
 */
export function campaignDraftErrors(draft: CampaignDraft, nowMs: number): string[] {
  const problems: string[] = []

  if (!CAMPAIGN_KEY_PATTERN.test(draft.key.trim().toLowerCase())) problems.push('admin.campaign.errKey')
  if (!draft.nameTr.trim() || !draft.nameEn.trim()) problems.push('admin.campaign.errName')
  if (!draft.descTr.trim() || !draft.descEn.trim()) problems.push('admin.campaign.errDesc')

  const starts = time(draft.startsAt)
  const ends = time(draft.endsAt)
  if (starts === null || ends === null) problems.push('admin.campaign.errWindow')
  else if (ends <= starts) problems.push('admin.campaign.errOrder')
  else if (ends <= nowMs) problems.push('admin.campaign.errPast')

  if (draft.accent.trim() && !CAMPAIGN_ACCENT_PATTERN.test(draft.accent.trim())) problems.push('admin.campaign.errAccent')
  if (draft.actionUrl.trim() && !CAMPAIGN_ACTION_PATTERN.test(draft.actionUrl.trim())) problems.push('admin.campaign.errAction')
  if (draft.actionUrl.trim() && !draft.actionLabelTr.trim() && !draft.actionLabelEn.trim()) {
    problems.push('admin.campaign.errActionLabel')
  }

  const seen = new Set<string>()
  for (const rule of draft.rules) {
    if (!rule.code) continue
    if (seen.has(rule.code)) problems.push('admin.campaign.errDuplicateRule')
    seen.add(rule.code)
    if (rule.multiplier < CAMPAIGN_MULTIPLIER_LIMITS.min || rule.multiplier > CAMPAIGN_MULTIPLIER_LIMITS.max) {
      problems.push('admin.campaign.errMultiplier')
    }
    if (rule.amountOverride !== null && rule.amountOverride <= 0) problems.push('admin.campaign.errAmount')
    if (rule.dailyCapOverride !== null && rule.dailyCapOverride < 0) problems.push('admin.campaign.errCap')
    if (rule.dailyCapOverride !== null && rule.amountOverride !== null && rule.dailyCapOverride < rule.amountOverride) {
      problems.push('admin.campaign.errCapBelow')
    }
  }

  return [...new Set(problems)]
}

/** A rule the overlay sheet can start with: one times, nothing else touched. */
export function emptyCampaignRule(code: string): CampaignRuleDraft {
  return { code, multiplier: 2, amountOverride: null, dailyCapOverride: null, noteTr: '', noteEn: '' }
}

export function emptyCampaignDraft(key = ''): CampaignDraft {
  return {
    key,
    nameTr: '',
    nameEn: '',
    descTr: '',
    descEn: '',
    bodyTr: '',
    bodyEn: '',
    startsAt: '',
    endsAt: '',
    surface: 'banner',
    accent: '',
    imagePath: null,
    actionLabelTr: '',
    actionLabelEn: '',
    actionUrl: '',
    enabled: true,
    rules: []
  }
}
