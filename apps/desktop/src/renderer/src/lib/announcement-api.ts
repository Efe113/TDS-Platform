import { parseActiveAnnouncements, type ActiveAnnouncement } from '@tds/shared'
import { supabase } from './supabase'
import { NotConfiguredError } from './discovery-api'

/**
 * The notice read path (0052).
 *
 * `active_announcements()` answers with the caller's own dismissal folded in. That is the whole reason
 * it is a definer function instead of a table select: a band that was closed on another device must
 * stay closed here, and the alternative — a private list in localStorage — forgets the moment the member
 * signs in on a different machine.
 *
 * When there is no account to attribute a click to (a visitor, before sign-in) the server answers
 * `recorded: false` and the shell falls back to a local dismissal, so an anonymous band can still be
 * closed without reappearing on the next poll.
 */
export async function fetchActiveAnnouncements(): Promise<ActiveAnnouncement[]> {
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase.rpc('active_announcements')
  if (error) throw new Error(error.message)
  return parseActiveAnnouncements(data ?? [])
}

/** `read` is the acknowledgement; `dismissed` is the corner cross. Both are one row per member. */
export async function markAnnouncement(key: string, state: 'read' | 'dismissed'): Promise<boolean> {
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase.rpc('mark_announcement', { p_key: key, p_state: state })
  if (error) throw new Error(error.message)
  const recorded = (data as { recorded?: boolean } | null)?.recorded
  return recorded === true
}
