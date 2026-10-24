import { z } from 'zod'

/**
 * The overlay records step advances while the user is in-game; the server is only reachable
 * sometimes. Everything between "recorded" and "accepted by flush_usage" is described here, as
 * pure functions over one session, so the retry/dedup logic is testable without Electron.
 *
 * The server identifies a flush by (sessionId, nonce) and ignores repeated (session_id, seq)
 * pairs, so re-sending pending events after a failed attempt is safe.
 */

export const USAGE_DIRECTIONS = ['forward', 'back', 'reset'] as const

export const usageEventSchema = z.object({
  seq: z.number().int().positive(),
  stepNo: z.number().int().positive(),
  direction: z.enum(USAGE_DIRECTIONS),
  /** Client wall clock, milliseconds. The server converts it to a timestamp. */
  at: z.number().int().nonnegative()
})

export type UsageEvent = z.infer<typeof usageEventSchema>

export const usageSessionSchema = z.object({
  sessionId: z.string().uuid(),
  nonce: z.string().uuid(),
  strategyId: z.string().uuid(),
  startedAt: z.number().int().nonnegative(),
  events: z.array(usageEventSchema).default([]),
  attempts: z.number().int().nonnegative().default(0),
  nextRetryAt: z.number().int().nonnegative().default(0),
  lastError: z.string().nullable().default(null),
  lastFlushedAt: z.number().int().nonnegative().nullable().default(null)
})

export type UsageSession = z.infer<typeof usageSessionSchema>

export const usageOutboxSchema = z.object({
  version: z.literal(1),
  session: usageSessionSchema.nullable().default(null)
})

export type UsageOutbox = z.infer<typeof usageOutboxSchema>

export const EMPTY_OUTBOX: UsageOutbox = { version: 1, session: null }

/** What 0014's start_overlay_session returns; the nonce is what makes a retry addressable. */
export const sessionStartResultSchema = z.object({
  sessionId: z.string().uuid(),
  nonce: z.string().uuid()
})

export type SessionStartResult = z.infer<typeof sessionStartResultSchema>

/** How long one session may keep buffering before the pending events are dropped. */
export const SESSION_MAX_AGE_MS = 36 * 60 * 60 * 1000
export const MAX_PENDING_EVENTS = 400

/** Normal cadence while online: enough to keep a live run near-real-time without spamming REST. */
export const FLUSH_INTERVAL_MS = 30 * 1000

/** Backoff for failed flushes, doubling from 5s up to 10min. */
export function retryDelayMs(attempts: number): number {
  if (attempts <= 0) return FLUSH_INTERVAL_MS
  return Math.min(10 * 60 * 1000, 5000 * 2 ** Math.min(attempts - 1, 11))
}

export function withEvents(session: UsageSession, incoming: UsageEvent[], now: number): UsageSession {
  if (incoming.length === 0) return session
  const bySeq = new Map<number, UsageEvent>()
  for (const event of session.events) bySeq.set(event.seq, event)
  for (const event of incoming) bySeq.set(event.seq, event)

  // Keep the newest events: an interrupted run matters more than its first minutes, and the server
  // dedupes by seq anyway.
  const merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
  const events = merged.length > MAX_PENDING_EVENTS ? merged.slice(merged.length - MAX_PENDING_EVENTS) : merged
  return { ...session, events, nextRetryAt: session.nextRetryAt === 0 ? now + FLUSH_INTERVAL_MS : session.nextRetryAt }
}

/**
 * Should a flush attempt start now? A session with nothing pending is never sent: an empty flush
 * would still close the session server-side and count as a use.
 */
export function shouldFlush(session: UsageSession | null, now: number): boolean {
  if (!session) return false
  if (session.events.length === 0) return false
  if (now - session.startedAt > SESSION_MAX_AGE_MS) return false
  if (session.nextRetryAt === 0) return true
  return now >= session.nextRetryAt
}

export function flushSucceeded(session: UsageSession, now: number): UsageSession {
  return { ...session, events: [], attempts: 0, lastError: null, lastFlushedAt: now, nextRetryAt: 0 }
}

export function flushFailed(session: UsageSession, error: string, now: number): UsageSession {
  const attempts = session.attempts + 1
  return { ...session, attempts, lastError: error.slice(0, 240), nextRetryAt: now + retryDelayMs(attempts) }
}

/** True when the session is too old to report honestly; the caller drops it and says why. */
export function isExpired(session: UsageSession, now: number): boolean {
  return now - session.startedAt > SESSION_MAX_AGE_MS
}

/** A flush is worth waiting for only when the run has really progressed. */
export function pendingForwardCount(session: UsageSession | null): number {
  if (!session) return 0
  return session.events.filter((event) => event.direction === 'forward').length
}
