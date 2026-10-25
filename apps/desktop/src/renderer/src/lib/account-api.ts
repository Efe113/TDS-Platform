import {
  accountErrorKey,
  accountQueueRowSchema,
  accountRequestSchema,
  claimBoostResultSchema,
  submitRequestResultSchema,
  type AccountQueueRow,
  type AccountRequest,
  type ClaimBoostResult
} from '@tds/shared'
import { NotConfiguredError } from './discovery-api'
import { supabase } from './supabase'
import { whenSessionReady } from './session'

/**
 * Client for the verified-account tier (0037). Every call goes straight to Supabase because the
 * server owns the truth: an admin-pinned column plus definer RPCs, never a client flag.
 *
 * The read helpers stay quiet when the database has not run 0037 yet — a board must degrade to
 * "nobody looks verified", not to an error screen.
 */

function db(): NonNullable<typeof supabase> {
  if (!supabase) throw new NotConfiguredError()
  return supabase
}

export interface AuthorFlag {
  verified: boolean
  corporate: boolean
  titleKey: string | null
}

const NOT_VERIFIED: AuthorFlag = { verified: false, corporate: false, titleKey: null }

/** Verification of the authors a page already shows, in one round-trip over public profile reads. */
export async function fetchVerificationFlags(userIds: string[]): Promise<Record<string, AuthorFlag>> {
  const ids = [...new Set(userIds.filter((id) => id.length > 0))]
  if (ids.length === 0 || !supabase) return {}
  const { data, error } = await supabase
    .from('profiles')
    .select('id, is_verified, is_corporate, active_title')
    .in('id', ids)
  // A missing column means an unmigrated database, not a network problem: answer "nothing verified".
  if (error) return {}
  const flags: Record<string, AuthorFlag> = {}
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    if (typeof row.id !== 'string') continue
    const corporate = row.is_corporate === true
    flags[row.id] = {
      // 0040: a corporate account is a verified one, so the tick answers yes for both flags.
      verified: row.is_verified === true || corporate,
      corporate,
      titleKey: typeof row.active_title === 'string' ? row.active_title : null
    }
  }
  return flags
}

export async function fetchAuthorFlag(userId: string | null): Promise<AuthorFlag> {
  if (userId === null) return NOT_VERIFIED
  const flags = await fetchVerificationFlags([userId])
  return flags[userId] ?? NOT_VERIFIED
}

export interface AccountSubmission {
  kind: 'verified' | 'corporate'
  message: string
  links?: string | null
  strategyId?: string | null
}

export async function submitAccountRequest(input: AccountSubmission): Promise<{ requestId: string | null; replayed: boolean }> {
  await whenSessionReady()
  const { data, error } = await db().rpc('submit_account_request', {
    p_kind: input.kind,
    p_message: input.message,
    p_links: input.links?.trim().length ? input.links.trim() : null,
    p_strategy_id: input.strategyId ?? null
  })
  if (error) throw new Error(error.message)
  const parsed = submitRequestResultSchema.parse(data ?? {})
  return { requestId: parsed.requestId, replayed: parsed.replayed }
}

export async function fetchMyAccountRequests(): Promise<AccountRequest[]> {
  await whenSessionReady()
  const { data, error } = await db().rpc('my_account_requests')
  if (error) throw new Error(error.message)
  return accountRequestSchema.array().parse(data ?? [])
}

export async function fetchAccountQueue(kind: string | null, status: string): Promise<AccountQueueRow[]> {
  await whenSessionReady()
  const { data, error } = await db().rpc('admin_account_queue', { p_kind: kind, p_status: status, p_limit: 100 })
  if (error) throw new Error(error.message)
  return accountQueueRowSchema.array().parse(data ?? [])
}

export interface ReviewInput {
  requestId: string
  decision: 'approve' | 'reject'
  note?: string | null
  credits?: number | null
}

export async function reviewAccountRequest(input: ReviewInput): Promise<void> {
  await whenSessionReady()
  const { error } = await db().rpc('admin_review_account_request', {
    p_id: input.requestId,
    p_decision: input.decision,
    p_note: input.note?.trim().length ? input.note.trim() : null,
    p_credits: input.credits ?? null
  })
  if (error) throw new Error(error.message)
}

export async function setVerified(userId: string, verified: boolean, credits: number | null, note: string | null): Promise<void> {
  await whenSessionReady()
  const { error } = await db().rpc('admin_set_verified', {
    p_user: userId,
    p_verified: verified,
    p_credits: credits,
    p_note: note?.trim().length ? note.trim() : null
  })
  if (error) throw new Error(error.message)
}

/** 0040: corporate implies verification, so revoking it never touches the verified flag. */
export async function setCorporate(userId: string, corporate: boolean, credits: number | null, note: string | null): Promise<void> {
  await whenSessionReady()
  const { error } = await db().rpc('admin_set_corporate', {
    p_user: userId,
    p_corporate: corporate,
    p_credits: credits,
    p_note: note?.trim().length ? note.trim() : null
  })
  if (error) throw new Error(error.message)
}

export async function claimVerifiedBoost(strategyId: string): Promise<ClaimBoostResult> {
  await whenSessionReady()
  const { data, error } = await db().rpc('claim_verified_boost', { p_strategy_id: strategyId })
  if (error) throw new Error(error.message)
  return claimBoostResultSchema.parse(data ?? {})
}

/** The Postgres message is a prefix code; pages translate it and never show the raw text. */
export function verificationErrorKey(message: string): ReturnType<typeof accountErrorKey> {
  return accountErrorKey(message)
}
