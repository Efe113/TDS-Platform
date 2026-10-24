import { z } from 'zod'

/**
 * Contract for the M8b discussion RPCs (0020). Every one of them returns a single jsonb value rather
 * than `returns table`, for the same reason the wallet ones do: OUT parameter names are plpgsql
 * variables and would collide with columns of the same name.
 *
 * The server is the only place the rules live (one vote per user per comment, one level of threading,
 * 2..1000 characters, 20s cooldown, ratings only on published strategies). These schemas describe the
 * result of those rules, they do not re-enforce them.
 */

export const VOTE_DIRECTIONS = ['up', 'down'] as const
export const REPORT_TARGETS = ['strategy', 'comment', 'profile'] as const
export const REPORT_REASONS = ['spam', 'harassment', 'not_mine', 'wrong_strategy', 'other'] as const
export const REPORT_STATUSES = ['pending', 'resolved', 'dismissed'] as const

export const voteDirectionSchema = z.enum(VOTE_DIRECTIONS)
export const reportTargetSchema = z.enum(REPORT_TARGETS)
export const reportReasonSchema = z.enum(REPORT_REASONS)
export const reportStatusSchema = z.enum(REPORT_STATUSES)

export type VoteDirection = z.infer<typeof voteDirectionSchema>
export type ReportTarget = z.infer<typeof reportTargetSchema>
export type ReportReason = z.infer<typeof reportReasonSchema>

export const replyCommentSchema = z.object({
  id: z.string().uuid(),
  /** Null once the comment is soft-deleted; `deleted` is the flag the UI should branch on. */
  body: z.string().nullable().default(null),
  deleted: z.boolean().default(false),
  createdAt: z.string(),
  authorId: z.string().uuid(),
  authorHandle: z.string(),
  authorDisplayName: z.string().nullable().default(null),
  /**
   * `t.user_id = auth.uid()` is NULL, not false, for a signed-out reader, and the probe against the
   * live database caught exactly that. Coerce instead of defaulting: a missing key is a contract
   * break worth failing on, a null here is just "nobody is signed in".
   */
  mine: z.boolean().nullish().transform((value) => value === true),
  up: z.number().int().default(0),
  down: z.number().int().default(0),
  myVote: voteDirectionSchema.nullable().default(null)
})

export const threadCommentSchema = replyCommentSchema.extend({
  replies: z.array(replyCommentSchema).default([])
})

export const discussionSchema = z.object({
  strategyId: z.string().uuid(),
  /** Non-deleted comments, replies included; the list itself is capped at the 100 newest threads. */
  total: z.number().int().default(0),
  /** The two app_flags kill switches, read server-side so turning discussion off needs no release. */
  ratingsEnabled: z.boolean().default(true),
  commentsEnabled: z.boolean().default(true),
  ratingAvg: z.number().nullable().default(null),
  ratingCount: z.number().int().default(0),
  myScore: z.number().int().nullable().default(null),
  items: z.array(threadCommentSchema).default([])
})

export const rateResultSchema = z.object({
  strategyId: z.string().uuid().nullable().default(null),
  myScore: z.number().int().nullable().default(null),
  ratingAvg: z.number().nullable().default(null),
  ratingCount: z.number().int().default(0)
})

export const voteResultSchema = z.object({
  commentId: z.string().uuid().nullable().default(null),
  up: z.number().int().default(0),
  down: z.number().int().default(0),
  mine: voteDirectionSchema.nullable().default(null)
})

export const reportResultSchema = z.object({
  reportId: z.string().uuid().nullable().default(null),
  /** True when an open report for the same target already existed; nothing new was queued. */
  duplicate: z.boolean().default(false)
})

export const moderationReportSchema = z.object({
  id: z.string().uuid(),
  targetType: reportTargetSchema,
  targetId: z.string(),
  reason: reportReasonSchema,
  detail: z.string().nullable().default(null),
  status: reportStatusSchema.default('pending'),
  createdAt: z.string(),
  reporter: z.string().nullable().default(null),
  targetLabel: z.string().nullable().default(null)
})

export const moderationTakedownSchema = z.object({
  id: z.string().uuid(),
  strategyId: z.string().uuid().nullable().default(null),
  strategyName: z.string().nullable().default(null),
  claimantName: z.string(),
  claimantEmail: z.string(),
  statement: z.string(),
  status: z.string().default('pending'),
  createdAt: z.string()
})

export const moderationQueueSchema = z.object({
  reports: z.array(moderationReportSchema).default([]),
  takedowns: z.array(moderationTakedownSchema).default([])
})

export type Discussion = z.infer<typeof discussionSchema>
export type ThreadComment = z.infer<typeof threadCommentSchema>
export type ReplyComment = z.infer<typeof replyCommentSchema>
export type RateResult = z.infer<typeof rateResultSchema>
export type VoteResult = z.infer<typeof voteResultSchema>
export type ReportResult = z.infer<typeof reportResultSchema>
export type ModerationQueue = z.infer<typeof moderationQueueSchema>
export type ModerationReport = z.infer<typeof moderationReportSchema>
export type ModerationTakedown = z.infer<typeof moderationTakedownSchema>

/** Keys the discussion UI can translate instead of surfacing a raw Postgres message. */
export type DiscussionErrorKey =
  | 'social.errAnonymous'
  | 'social.errRatingsDisabled'
  | 'social.errCommentsDisabled'
  | 'social.errBody'
  | 'social.errTooFast'
  | 'social.errTooDeep'
  | 'social.errNotFound'
  | 'social.errForbidden'
  | 'social.errSelfVote'
  | 'social.errNotPublished'
  | 'social.errClaimant'
  | 'social.errEmail'
  | 'social.errStatement'
  | 'social.errGeneric'

const ERROR_KEYS: Array<[string, DiscussionErrorKey]> = [
  ['ANONYMOUS', 'social.errAnonymous'],
  ['RATINGS_DISABLED', 'social.errRatingsDisabled'],
  ['COMMENTS_DISABLED', 'social.errCommentsDisabled'],
  ['BAD_BODY', 'social.errBody'],
  ['TOO_FAST', 'social.errTooFast'],
  ['TOO_DEEP', 'social.errTooDeep'],
  ['BAD_PARENT', 'social.errNotFound'],
  ['BAD_CLAIMANT', 'social.errClaimant'],
  ['BAD_EMAIL', 'social.errEmail'],
  ['BAD_STATEMENT', 'social.errStatement'],
  ['NOT_PUBLISHED', 'social.errNotPublished'],
  ['NOT_FOUND', 'social.errNotFound'],
  // Ordered before FORBIDDEN on purpose: both prefixes share their first nine characters and
  // discussionErrorKey matches with startsWith.
  ['FORBIDDEN_SELF', 'social.errSelfVote'],
  ['FORBIDDEN', 'social.errForbidden']
]

export function discussionErrorKey(message: string): DiscussionErrorKey {
  for (const [prefix, key] of ERROR_KEYS) {
    if (message.startsWith(prefix)) return key
  }
  return 'social.errGeneric'
}

/** "4,3 · 12 değerlendirme" - null average means nobody has rated yet, which is not zero stars. */
export function formatRating(average: number | null, count: number, locale: string): string | null {
  if (count <= 0 || average === null) return null
  return `${average.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} · ${String(count)}`
}

/** Net score drives the color: a comment at -3 is not the same as one at 0. */
export function voteScore(comment: { up: number; down: number }): number {
  return comment.up - comment.down
}

/** The 2..1000 character rule the database enforces, mirrored only to disable the send button early. */
export function isCommentBodyValid(body: string): boolean {
  const length = body.trim().length
  return length >= 2 && length <= 1000
}

export function isTakedownStatementValid(statement: string): boolean {
  return statement.trim().length >= 20
}
