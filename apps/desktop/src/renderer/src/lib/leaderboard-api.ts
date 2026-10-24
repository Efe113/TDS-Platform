import {
  LEADERBOARD_PAGE_SIZE,
  leaderboardHubSchema,
  leaderboardRowSchema,
  type LeaderboardBoard,
  type LeaderboardHub,
  type LeaderboardRow,
  type LeaderboardWindow,
  type PlayerMetric
} from '@tds/shared'
import { supabase } from './supabase'
import { NotConfiguredError } from './discovery-api'

/**
 * public.get_leaderboard rebuilds its own snapshot when it is older than the TTL, so a page visit is
 * enough to keep the board fresh — there is no scheduler behind this.
 */
export async function fetchLeaderboard(window: LeaderboardWindow, limit = LEADERBOARD_PAGE_SIZE): Promise<LeaderboardRow[]> {
  if (!supabase) throw new NotConfiguredError()

  const { data, error } = await supabase.rpc('get_leaderboard', { p_window: window, p_limit: limit })
  if (error) throw new Error(error.message)
  return leaderboardRowSchema.array().parse(data ?? [])
}

/** 0033: one call returns the board, the caller's standing, the adjacent ranks and the movers. */
export async function fetchLeaderboardHub(input: {
  board: LeaderboardBoard
  metric: PlayerMetric
  window: LeaderboardWindow
  limit: number
}): Promise<LeaderboardHub> {
  if (!supabase) throw new NotConfiguredError()

  const { data, error } = await supabase.rpc('leaderboard_hub', {
    p_board: input.board,
    p_metric: input.metric,
    p_window: input.window,
    p_limit: input.limit
  })
  if (error) throw new Error(error.message)
  return leaderboardHubSchema.parse(data ?? {})
}
