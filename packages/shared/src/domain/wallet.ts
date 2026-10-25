import { z } from 'zod'

/**
 * Contract for public.wallet_summary() and public.buy_boost(). Both return one jsonb value rather
 * than `returns table`, because OUT parameter names are plpgsql variables and would collide with
 * columns of the same name (that collision cost a whole milestone in flush_usage).
 */

export const LEDGER_KINDS = ['usage', 'publish', 'approval', 'badge', 'spend', 'refund', 'grant', 'reverse'] as const
export const SPEND_KINDS = ['badge', 'theme', 'boost', 'cosmetic', 'title', 'frame', 'vip'] as const

/** The one SKU that grants VIP. Membership is derived from its filled order, never a profile flag. */
export const VIP_SKU = 'vip_lifetime'

/** 0037: the disabled catalog row a verified promotion credit records itself against. */
export const VERIFIED_BOOST_SKU = 'boost_verified_72h'

export const walletRuleSchema = z.object({
  code: z.string(),
  kind: z.string(),
  amount: z.number().int(),
  dailyCap: z.number().int().nullable(),
  weeklyCap: z.number().int().nullable(),
  earnedToday: z.number().int().default(0),
  earnedWeek: z.number().int().default(0),
  // 0038: the payload has carried the copy for a long time; the schema used to drop it, which forced
  // the wallet to hardcode a name and an icon per code. Optional so an un-migrated database parses.
  unit: z.string().optional().default('per_event'),
  ledgerKind: z.string().optional().default('usage'),
  icon: z.string().nullable().optional().default(null),
  name: z.string().nullable().optional().default(null),
  nameEn: z.string().nullable().optional().default(null),
  desc: z.string().nullable().optional().default(null),
  descEn: z.string().nullable().optional().default(null)
})

export const walletEntrySchema = z.object({
  delta: z.number().int(),
  kind: z.enum(LEDGER_KINDS),
  ruleCode: z.string().nullable(),
  refType: z.string().nullable(),
  // 0038: the reason an admin moved coins, shown where the member will look for it — the ledger row.
  note: z.string().nullable().optional().default(null),
  at: z.string()
})

export const walletItemSchema = z.object({
  sku: z.string(),
  kind: z.enum(SPEND_KINDS),
  price: z.number().int().nonnegative(),
  refCode: z.string().nullable(),
  durationHours: z.number().int().nullable(),
  /** Theme display name (Turkish), its English form, and the accent color; null for non-themes. */
  name: z.string().nullable().default(null),
  nameEn: z.string().nullable().default(null),
  accent: z.string().nullable().default(null),
  // 0025: the shop copy lives in the database so the admin can edit it.
  desc: z.string().nullable().default(null),
  descEn: z.string().nullable().default(null),
  perks: z.array(z.string()).default([]),
  sortOrder: z.number().int().default(100),
  // 0027: the shelf price and the till price are different things.
  finalPrice: z.number().int().nullable().default(null),
  discountPercent: z.number().int().min(0).max(90).default(0),
  discountEndsAt: z.string().nullable().default(null),
  tag: z.enum(['none', 'new', 'soon', 'vip', 'verified']).default('none'),
  owned: z.boolean().default(false)
})

export const walletBoostSchema = z.object({
  strategyId: z.string().uuid(),
  strategyName: z.string(),
  sku: z.string().nullable(),
  endsAt: z.string()
})

export const walletSummarySchema = z.object({
  balance: z.number().int(),
  cached: z.number().int().nullable(),
  /** False means the cached column and the ledger disagree; the page must say so, not hide it. */
  reconciled: z.boolean().default(false),
  /** The profile's active theme key and its accent color, both null while the default applies. */
  theme: z.string().nullable().default(null),
  themeAccent: z.string().nullable().default(null),
  rules: z.array(walletRuleSchema).default([]),
  entries: z.array(walletEntrySchema).default([]),
  catalog: z.array(walletItemSchema).default([]),
  boosts: z.array(walletBoostSchema).default([]),
  // 0034: VIP state and the background path the shell paints behind every screen.
  vip: z.boolean().default(false),
  vipBackgroundPath: z.string().nullable().default(null),
  // 0037: the verified tier — staff-granted, with an expiring discount and promotable credits.
  verified: z.boolean().optional().default(false),
  verifiedDiscountEndsAt: z.string().nullable().optional().default(null),
  verifiedBoostCredits: z.number().int().nonnegative().optional().default(0)
})

export type WalletSummary = z.infer<typeof walletSummarySchema>
export type WalletItem = z.infer<typeof walletItemSchema>
export type WalletRule = z.infer<typeof walletRuleSchema>

export const buyBoostResultSchema = z.object({
  replayed: z.boolean().default(false),
  boostId: z.string().uuid().nullable().default(null),
  strategyId: z.string().uuid().nullable().default(null),
  endsAt: z.string().nullable().default(null),
  pricePaid: z.number().int().nullable().default(null),
  balance: z.number().int()
})

export type BuyBoostResult = z.infer<typeof buyBoostResultSchema>

/** Null cap means unlimited; otherwise the headroom left today/this week, never negative. */
export function capRemaining(earned: number, cap: number | null): number | null {
  if (cap === null) return null
  return Math.max(0, cap - earned)
}

export function formatCoin(amount: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(amount)
}

/** Error prefixes the wallet UI can translate instead of showing a raw Postgres message. */
export function spendErrorKey(message: string): 'wallet.errFunds' | 'wallet.errAlready' | 'wallet.errNotPublished' | 'wallet.errGeneric' {
  if (message.startsWith('INSUFFICIENT_FUNDS')) return 'wallet.errFunds'
  // A verified-only benefit, a missing credit or an unverified account is all "not yours to spend".
  if (
    message.startsWith('ALREADY_BOOSTED') ||
    message.startsWith('ALREADY_OWNED') ||
    message.startsWith('BENEFIT_ONLY') ||
    message.startsWith('NOT_VERIFIED') ||
    message.startsWith('NO_CREDIT')
  ) {
    return 'wallet.errAlready'
  }
  if (message.startsWith('NOT_PUBLISHED') || message.startsWith('NOT_FOUND') || message.startsWith('NOT_OWNER')) {
    return 'wallet.errNotPublished'
  }
  return 'wallet.errGeneric'
}
