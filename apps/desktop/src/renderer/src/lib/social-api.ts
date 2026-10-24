import {
  discussionSchema,
  moderationQueueSchema,
  rateResultSchema,
  reportResultSchema,
  voteResultSchema,
  type Discussion,
  type ModerationQueue,
  type RateResult,
  type ReportReason,
  type ReportResult,
  type ReportTarget,
  type VoteDirection,
  type VoteResult
} from '@tds/shared'
import { supabase } from './supabase'
import { NotConfiguredError } from './discovery-api'

function db(): NonNullable<typeof supabase> {
  if (!supabase) throw new NotConfiguredError()
  return supabase
}

/**
 * One round trip for the whole discussion panel: the thread, the rating aggregate, the caller's own
 * score and both kill switches come back together from list_comments.
 */
export async function fetchDiscussion(strategyId: string): Promise<Discussion> {
  const { data, error } = await db().rpc('list_comments', { p_strategy_id: strategyId })
  if (error) throw new Error(error.message)
  return discussionSchema.parse(data ?? {})
}

/** `null` score removes the caller's rating again; the RPC takes one argument and does both jobs. */
export async function rateStrategy(strategyId: string, score: number | null): Promise<RateResult> {
  const { data, error } = await db().rpc('rate_strategy', { p_strategy_id: strategyId, p_score: score })
  if (error) throw new Error(error.message)
  return rateResultSchema.parse(data ?? {})
}

export async function postComment(strategyId: string, body: string, parentId: string | null = null): Promise<string> {
  const { data, error } = await db().rpc('post_comment', {
    p_strategy_id: strategyId,
    p_body: body,
    p_parent_id: parentId
  })
  if (error) throw new Error(error.message)
  return typeof data === 'string' ? data : String(data ?? '')
}

export async function deleteComment(commentId: string): Promise<boolean> {
  const { error } = await db().rpc('delete_comment', { p_comment_id: commentId })
  if (error) throw new Error(error.message)
  return true
}

/** `null` clears the caller's vote; the RPC returns the fresh counts so the UI needs no refetch. */
export async function voteComment(commentId: string, direction: VoteDirection | null): Promise<VoteResult> {
  const { data, error } = await db().rpc('vote_comment', { p_comment_id: commentId, p_dir: direction })
  if (error) throw new Error(error.message)
  return voteResultSchema.parse(data ?? {})
}

export async function fileReport(
  target: ReportTarget,
  targetId: string,
  reason: ReportReason,
  detail: string | null
): Promise<ReportResult> {
  const { data, error } = await db().rpc('file_report', {
    p_target_type: target,
    p_target_id: targetId,
    p_reason_code: reason,
    p_detail: detail
  })
  if (error) throw new Error(error.message)
  return reportResultSchema.parse(data ?? {})
}

export async function requestTakedown(
  strategyId: string,
  claimantName: string,
  claimantEmail: string,
  statement: string
): Promise<string> {
  const { data, error } = await db().rpc('request_takedown', {
    p_strategy_id: strategyId,
    p_claimant_name: claimantName,
    p_claimant_email: claimantEmail,
    p_statement: statement
  })
  if (error) throw new Error(error.message)
  return typeof data === 'string' ? data : String(data ?? '')
}

/** Moderator-only: the RPC raises FORBIDDEN for anybody else, which the panel shows as an error. */
export async function fetchModerationQueue(limit = 50): Promise<ModerationQueue> {
  const { data, error } = await db().rpc('admin_moderation_queue', { p_limit: limit })
  if (error) throw new Error(error.message)
  return moderationQueueSchema.parse(data ?? {})
}

export async function resolveReport(reportId: string, status: 'resolved' | 'dismissed', note: string | null): Promise<boolean> {
  const { error } = await db().rpc('admin_resolve_report', { p_report_id: reportId, p_status: status, p_note: note })
  if (error) throw new Error(error.message)
  return true
}
