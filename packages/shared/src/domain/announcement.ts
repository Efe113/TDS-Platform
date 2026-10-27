import { z } from 'zod'
import { CAMPAIGN_KEY_PATTERN } from './campaign'

/**
 * Announcements (0052): the platform's other voice.
 *
 * Maintenance says "writing is frozen" and nothing else. A balance repair, a moderation delay, a rule
 * change, the fact that an event opens on Friday — all of those needed a channel, and the shell only had
 * one band position. So notices come with a weight and a surface, and the shell decides with one rule:
 * maintenance, then the heaviest notice, then the campaign.
 *
 * Two surfaces because the content is genuinely different. A band is a sentence and a type chip; a modal
 * is a picture and a story. The editor refuses to save a modal with neither, because that is a band that
 * interrupts instead of informing.
 *
 * `critical` earns its name one way only: `ackRequired` removes the corner cross and leaves a single
 * "Anladım". Anything else can be dismissed, and a dismissal is stored against the account
 * (`announcement_reads`) so it survives a reinstall — the one behaviour a member means by "kapat".
 */

export const ANNOUNCEMENT_SEVERITIES = ['info', 'warn', 'critical'] as const
export type AnnouncementSeverity = (typeof ANNOUNCEMENT_SEVERITIES)[number]

export const NOTICE_SURFACES = ['banner', 'modal'] as const
export type NoticeSurface = (typeof NOTICE_SURFACES)[number]

export const NOTICE_STATES = ['off', 'upcoming', 'live', 'ended'] as const
export type NoticeState = (typeof NOTICE_STATES)[number]

/** The three tones the shell's Banner already paints, so a notice never brings its own colours. */
export const NOTICE_TONES: Record<AnnouncementSeverity, 'info' | 'warn' | 'danger'> = {
  info: 'info',
  warn: 'warn',
  critical: 'danger'
}

/**
 * The same three weights in the chip's vocabulary. `Banner` takes `info`, `Chip` takes `brand`, and
 * pretending they are one scale is how a notice ends up drawn in a colour no token defines.
 */
export const NOTICE_CHIP_TONES: Record<AnnouncementSeverity, 'brand' | 'warn' | 'danger'> = {
  info: 'brand',
  warn: 'warn',
  critical: 'danger'
}

/** Heaviest first: the shell shows one band, and it should be the one that matters. */
export const NOTICE_WEIGHT: Record<AnnouncementSeverity, number> = { critical: 0, warn: 1, info: 2 }

export const activeAnnouncementSchema = z.object({
  key: z.string(),
  severity: z.enum(ANNOUNCEMENT_SEVERITIES).catch('info'),
  surface: z.enum(NOTICE_SURFACES).catch('banner'),
  titleTr: z.string(),
  titleEn: z.string(),
  shortTr: z.string(),
  shortEn: z.string(),
  bodyTr: z.string().nullable().default(null),
  bodyEn: z.string().nullable().default(null),
  imagePath: z.string().nullable().default(null),
  actionLabelTr: z.string().nullable().default(null),
  actionLabelEn: z.string().nullable().default(null),
  actionUrl: z.string().nullable().default(null),
  startsAt: z.string(),
  endsAt: z.string(),
  updatedAt: z.string(),
  ackRequired: z.boolean().default(false),
  state: z.enum(NOTICE_STATES).catch('live'),
  /** The caller's own dismissal, answered by the server so it follows the account, not the device. */
  dismissed: z.boolean().default(false),
  readAt: z.string().nullable().default(null)
})

export type ActiveAnnouncement = z.infer<typeof activeAnnouncementSchema>

export const adminAnnouncementSchema = activeAnnouncementSchema
  .omit({ dismissed: true, readAt: true })
  .extend({
    enabled: z.boolean().default(true),
    readCount: z.coerce.number().int().default(0),
    dismissCount: z.coerce.number().int().default(0)
  })

export type AdminAnnouncement = z.infer<typeof adminAnnouncementSchema>

export function parseActiveAnnouncements(value: unknown): ActiveAnnouncement[] {
  if (!Array.isArray(value)) return []
  const out: ActiveAnnouncement[] = []
  for (const entry of value) {
    const parsed = activeAnnouncementSchema.safeParse(entry)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

function time(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function noticeStateOf(notice: { startsAt: string; endsAt: string }, nowMs: number): NoticeState {
  const starts = time(notice.startsAt)
  const ends = time(notice.endsAt)
  if (starts !== null && starts > nowMs) return 'upcoming'
  if (ends !== null && ends <= nowMs) return 'ended'
  return 'live'
}

/** A notice the member has not closed, inside its window, and worth interrupting for. */
export function noticeIsVisible(notice: ActiveAnnouncement, nowMs: number): boolean {
  if (notice.dismissed) return false
  const state = noticeStateOf(notice, nowMs)
  if (state === 'ended' || state === 'off') return false
  if (state === 'upcoming') {
    const starts = time(notice.startsAt)
    return starts !== null && starts - nowMs <= 2 * 24 * 60 * 60 * 1000
  }
  return true
}

/**
 * What the shell may show: at most one band and at most one modal, each the heaviest of its kind.
 *
 * Two bands stacked would push the content down every time an operator posted a note, and two modals is
 * a queue nobody reads. The campaign band loses to any notice on purpose — an announcement is about the
 * member's account, a campaign is about the shop.
 */
export function pickNotices(notices: ActiveAnnouncement[], nowMs: number): { band: ActiveAnnouncement | null; modal: ActiveAnnouncement | null } {
  const visible = notices
    .filter((notice) => noticeIsVisible(notice, nowMs))
    .sort((a, b) => NOTICE_WEIGHT[a.severity] - NOTICE_WEIGHT[b.severity] || (time(b.updatedAt) ?? 0) - (time(a.updatedAt) ?? 0))
  const band = visible.find((notice) => notice.surface === 'banner') ?? null
  const modal = visible.find((notice) => notice.surface === 'modal') ?? null
  return { band, modal }
}

/* ------------------------------------------------------------------ the operator's draft */

export interface NoticeDraft {
  key: string
  severity: AnnouncementSeverity
  surface: NoticeSurface
  titleTr: string
  titleEn: string
  shortTr: string
  shortEn: string
  bodyTr: string
  bodyEn: string
  imagePath: string | null
  actionLabelTr: string
  actionLabelEn: string
  actionUrl: string
  startsAt: string
  endsAt: string
  ackRequired: boolean
  enabled: boolean
}

export function emptyNoticeDraft(key = ''): NoticeDraft {
  return {
    key,
    severity: 'info',
    surface: 'banner',
    titleTr: '',
    titleEn: '',
    shortTr: '',
    shortEn: '',
    bodyTr: '',
    bodyEn: '',
    imagePath: null,
    actionLabelTr: '',
    actionLabelEn: '',
    actionUrl: '',
    startsAt: '',
    endsAt: '',
    ackRequired: false,
    enabled: true
  }
}

export function noticeAdminToDraft(row: AdminAnnouncement): NoticeDraft {
  return {
    key: row.key,
    severity: row.severity,
    surface: row.surface,
    titleTr: row.titleTr,
    titleEn: row.titleEn,
    shortTr: row.shortTr,
    shortEn: row.shortEn,
    bodyTr: row.bodyTr ?? '',
    bodyEn: row.bodyEn ?? '',
    imagePath: row.imagePath,
    actionLabelTr: row.actionLabelTr ?? '',
    actionLabelEn: row.actionLabelEn ?? '',
    actionUrl: row.actionUrl ?? '',
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    ackRequired: row.ackRequired,
    enabled: row.enabled
  }
}

/** Same rule as campaigns: the link is only as free as the CHECK constraint lets it be. */
export const NOTICE_ACTION_PATTERN = /^(https:\/\/|tdsapp:\/\/)/

/**
 * Everything `admin_upsert_announcement` refuses, named before the request. The modal rule is the one
 * an operator would otherwise learn by trial and error: a modal with no story is a band that interrupts.
 */
export function noticeDraftErrors(draft: NoticeDraft, nowMs: number): string[] {
  const problems: string[] = []

  if (!CAMPAIGN_KEY_PATTERN.test(draft.key.trim().toLowerCase())) problems.push('admin.notice.errKey')
  if (!draft.titleTr.trim() || !draft.titleEn.trim()) problems.push('admin.notice.errTitle')
  if (!draft.shortTr.trim() || !draft.shortEn.trim()) problems.push('admin.notice.errShort')

  const starts = time(draft.startsAt)
  const ends = time(draft.endsAt)
  if (starts === null || ends === null) problems.push('admin.notice.errWindow')
  else if (ends <= starts) problems.push('admin.notice.errOrder')
  else if (ends <= nowMs) problems.push('admin.notice.errPast')

  if (draft.surface === 'modal' && !draft.bodyTr.trim() && !draft.bodyEn.trim() && draft.imagePath === null) {
    problems.push('admin.notice.errModalEmpty')
  }
  if (draft.actionUrl.trim() && !NOTICE_ACTION_PATTERN.test(draft.actionUrl.trim())) problems.push('admin.notice.errAction')
  if (draft.actionUrl.trim() && !draft.actionLabelTr.trim() && !draft.actionLabelEn.trim()) problems.push('admin.notice.errActionLabel')

  return [...new Set(problems)]
}

export function noticeDraftPayload(draft: NoticeDraft): Record<string, unknown> {
  return {
    p_key: draft.key.trim().toLowerCase(),
    p_severity: draft.severity,
    p_surface: draft.surface,
    p_title_tr: draft.titleTr.trim(),
    p_title_en: draft.titleEn.trim(),
    p_short_tr: draft.shortTr.trim(),
    p_short_en: draft.shortEn.trim(),
    p_body_tr: draft.bodyTr.trim() || null,
    p_body_en: draft.bodyEn.trim() || null,
    p_image_path: draft.imagePath,
    p_action_label_tr: draft.actionLabelTr.trim() || null,
    p_action_label_en: draft.actionLabelEn.trim() || null,
    p_action_url: draft.actionUrl.trim() || null,
    p_starts_at: draft.startsAt || null,
    p_ends_at: draft.endsAt || null,
    p_ack_required: draft.ackRequired,
    p_enabled: draft.enabled
  }
}
