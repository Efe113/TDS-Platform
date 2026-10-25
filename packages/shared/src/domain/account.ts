import { z } from 'zod'

/**
 * Contract for the staff-granted verified tier: public.submit_account_request(),
 * public.my_account_requests(), public.admin_account_queue(), public.admin_review_account_request()
 * and public.claim_verified_boost().
 *
 * Verification is a judgement, not a purchase, so the truth lives in admin-pinned profile columns
 * (0037) rather than in a receipt. `kind` carries both tiers in one queue so the corporate page can
 * arrive later without a second table or a second review screen.
 */

export const ACCOUNT_REQUEST_KINDS = ['verified', 'corporate'] as const
export const ACCOUNT_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const
export const ACCOUNT_DECISIONS = ['approve', 'reject'] as const

export type AccountRequestKind = (typeof ACCOUNT_REQUEST_KINDS)[number]
export type AccountRequestStatus = (typeof ACCOUNT_REQUEST_STATUSES)[number]

/** Mirrors the check constraint on account_requests.message; the form must not accept what SQL rejects. */
export const ACCOUNT_MESSAGE_LIMITS = { min: 20, max: 2000 } as const
export const ACCOUNT_LINKS_LIMIT = 1000

/** The numbers the benefit copy quotes, kept next to the SQL defaults they mirror. */
export const VERIFIED_BENEFITS = {
  discountPercent: 10,
  discountDays: 30,
  boostHours: 72,
  boostSku: 'boost_verified_72h'
} as const

/** What a grant is worth, in the order the application page lists it. */
export const VERIFIED_PERK_KEYS = [
  'verified.perkBoost',
  'verified.perkTick',
  'verified.perkTitle',
  'verified.perkMark',
  'verified.perkSort',
  'verified.perkBanner',
  'verified.perkDiscount'
] as const

export const accountRequestSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(ACCOUNT_REQUEST_KINDS),
  status: z.enum(ACCOUNT_REQUEST_STATUSES),
  message: z.string(),
  links: z.string().nullable().default(null),
  strategyId: z.string().uuid().nullable().default(null),
  strategyName: z.string().nullable().default(null),
  createdAt: z.string(),
  decidedAt: z.string().nullable().default(null),
  decisionNote: z.string().nullable().default(null)
})

export type AccountRequest = z.infer<typeof accountRequestSchema>

export const submitRequestResultSchema = z.object({
  requestId: z.string().uuid().nullable().default(null),
  status: z.enum(ACCOUNT_REQUEST_STATUSES).default('pending'),
  replayed: z.boolean().default(false)
})

export const accountQueueRowSchema = accountRequestSchema.omit({ createdAt: true }).extend({
  userId: z.string().uuid(),
  handle: z.string(),
  displayName: z.string().nullable().default(null),
  createdAt: z.string(),
  alreadyVerified: z.boolean().default(false),
  published: z.coerce.number().int().nonnegative().default(0)
})

export type AccountQueueRow = z.infer<typeof accountQueueRowSchema>

export const claimBoostResultSchema = z.object({
  boostId: z.string().uuid().nullable().default(null),
  strategyId: z.string().uuid(),
  endsAt: z.string(),
  creditsLeft: z.coerce.number().int().nonnegative().default(0)
})

export type ClaimBoostResult = z.infer<typeof claimBoostResultSchema>

/** Error prefixes the verification UI translates instead of showing a raw Postgres message. */
export function accountErrorKey(message: string): 'verified.errShort' | 'verified.errOpen' | 'verified.errKind' | 'verified.errOwner' | 'verified.errAuth' | 'verified.errGeneric' {
  if (message.startsWith('MESSAGE_SHORT')) return 'verified.errShort'
  // A pending request of the same kind is the normal "already applied" path, not a failure.
  if (message.startsWith('ALREADY_DECIDED') || message.startsWith('ALREADY_REVIEWED')) return 'verified.errOpen'
  if (message.startsWith('BAD_KIND')) return 'verified.errKind'
  if (message.startsWith('NOT_OWNER')) return 'verified.errOwner'
  if (message.startsWith('ANONYMOUS') || message.startsWith('AUTH_REQUIRED')) return 'verified.errAuth'
  return 'verified.errGeneric'
}

export function accountMessageIsValid(value: string): boolean {
  const length = value.trim().length
  return length >= ACCOUNT_MESSAGE_LIMITS.min && length <= ACCOUNT_MESSAGE_LIMITS.max
}
