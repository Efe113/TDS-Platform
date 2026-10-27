import {
  creatorFeedItemSchema,
  creatorWatchRowSchema,
  myJourneySchema,
  recentStrategySchema,
  stepHealthSchema,
  stepMarksSchema,
  strategyStatsSchema,
  watchUpdateSchema,
  type CreatorFeedItem,
  type CreatorWatchRow,
  type MyJourney,
  type RecentStrategy,
  type StepHealthEntry,
  type StepMark,
  type StrategyStats,
  type WatchUpdate
} from '@tds/shared'
import { supabase } from './supabase'
import { NotConfiguredError } from './discovery-api'

function requireDb(): NonNullable<typeof supabase> {
  if (!supabase) throw new NotConfiguredError()
  return supabase
}

async function rpc<T>(name: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  const { data, error } = await requireDb().rpc(name, args)
  if (error) throw new Error(error.message)
  return (data ?? fallback) as T
}

/** Community truth about a strategy: how it actually plays out for other people. */
export function fetchStrategyStats(strategyId: string): Promise<StrategyStats> {
  return rpc('strategy_stats', { p_strategy_id: strategyId }, {}).then((value) => strategyStatsSchema.parse(value))
}

/** Where the run stalls, step by step, from real retry telemetry plus explicit verdicts. */
export function fetchStepHealth(strategyId: string): Promise<StepHealthEntry[]> {
  return rpc('step_health', { p_strategy_id: strategyId }, []).then((value) => stepHealthSchema.parse(value))
}

/** This account's own history on one strategy, derived from the session ledger. */
export function fetchMyJourney(strategyId: string): Promise<MyJourney> {
  return rpc('my_journey', { p_strategy_id: strategyId }, {}).then((value) => myJourneySchema.parse(value))
}

export function fetchRecentStrategies(limit = 4): Promise<RecentStrategy[]> {
  return rpc('my_recent_strategies', { p_limit: limit }, []).then((value) => recentStrategySchema.array().parse(value))
}

export function fetchStepMarks(strategyId: string): Promise<StepMark[]> {
  return rpc('step_marks_list', { p_strategy_id: strategyId }, []).then((value) => stepMarksSchema.parse(value))
}

/** An empty note clears the mark; the server returns the whole list so the cache can be replaced. */
export function setStepMark(strategyId: string, stepNo: number, note: string): Promise<StepMark[]> {
  return rpc('set_step_mark', { p_strategy_id: strategyId, p_step_no: stepNo, p_note: note }, []).then((value) =>
    stepMarksSchema.parse(value)
  )
}

export function rateStep(strategyId: string, stepNo: number, verdict: 'worked' | 'stuck'): Promise<StepHealthEntry[]> {
  return rpc('rate_step', { p_strategy_id: strategyId, p_step_no: stepNo, p_verdict: verdict }, []).then((value) =>
    stepHealthSchema.parse(value)
  )
}

export function toggleWatch(strategyId: string): Promise<boolean> {
  return rpc<boolean>('toggle_watch', { p_strategy_id: strategyId }, false)
}

export function fetchWatchUpdates(): Promise<WatchUpdate[]> {
  return rpc('watch_updates', {}, []).then((value) => watchUpdateSchema.array().parse(value))
}

export async function markWatchSeen(strategyId: string): Promise<void> {
  const { error } = await requireDb().rpc('mark_watch_seen', { p_strategy_id: strategyId })
  if (error) throw new Error(error.message)
}

/** Following a person instead of a run (0054): the same toggle shape as a strategy watch. */
export async function toggleCreatorWatch(creatorId: string): Promise<boolean> {
  const { data, error } = await requireDb().rpc('toggle_creator_watch', { p_creator_id: creatorId })
  if (error) throw new Error(error.message)
  return (data as { watching?: boolean } | null)?.watching === true
}

export function fetchCreatorWatchList(): Promise<CreatorWatchRow[]> {
  return rpc('creator_watch_list', {}, []).then((value) => creatorWatchRowSchema.array().parse(value))
}

export function fetchCreatorFeed(limit = 12): Promise<CreatorFeedItem[]> {
  return rpc('creator_watch_feed', { p_limit: limit }, []).then((value) => creatorFeedItemSchema.array().parse(value))
}

export async function markCreatorSeen(creatorId: string): Promise<void> {
  const { error } = await requireDb().rpc('mark_creator_seen', { p_creator_id: creatorId })
  if (error) throw new Error(error.message)
}

export function fetchSolution(strategyId: string): Promise<string | null> {
  return rpc<string | null>('solution_for', { p_strategy_id: strategyId }, null)
}

export async function markSolution(strategyId: string, commentId: string): Promise<void> {
  const { error } = await requireDb().rpc('mark_solution', { p_strategy_id: strategyId, p_comment_id: commentId })
  if (error) throw new Error(error.message)
}

export async function clearSolution(strategyId: string): Promise<void> {
  const { error } = await requireDb().rpc('clear_solution', { p_strategy_id: strategyId })
  if (error) throw new Error(error.message)
}

/** The RPCs raise named errors, so the UI can translate the cause instead of showing a stack. */
export function intelligenceErrorKey(message: string): 'social.errForbidden' | 'common.errorTitle' {
  if (message.includes('FORBIDDEN') || message.includes('AUTH_REQUIRED')) return 'social.errForbidden'
  return 'common.errorTitle'
}
