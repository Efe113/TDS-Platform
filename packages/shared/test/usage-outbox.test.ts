import { describe, expect, it } from 'vitest'
import {
  FLUSH_INTERVAL_MS,
  MAX_PENDING_EVENTS,
  SESSION_MAX_AGE_MS,
  EMPTY_OUTBOX,
  flushFailed,
  flushSucceeded,
  isExpired,
  pendingForwardCount,
  retryDelayMs,
  sessionStartResultSchema,
  shouldFlush,
  usageOutboxSchema,
  withEvents,
  type UsageEvent,
  type UsageSession
} from '../src/usage/outbox'

const SESSION_ID = '11111111-1111-4111-8111-111111111111'
const NONCE = '22222222-2222-4222-8222-222222222222'
const STRATEGY_ID = '33333333-3333-4333-8333-333333333333'

function session(overrides: Partial<UsageSession> = {}): UsageSession {
  return {
    sessionId: SESSION_ID,
    nonce: NONCE,
    strategyId: STRATEGY_ID,
    startedAt: 1_000,
    events: [],
    attempts: 0,
    nextRetryAt: 0,
    lastError: null,
    lastFlushedAt: null,
    ...overrides
  }
}

function event(seq: number, direction: UsageEvent['direction'] = 'forward'): UsageEvent {
  return { seq, stepNo: seq, direction, at: 1_000 + seq }
}

describe('usage outbox', () => {
  it('keeps one row per seq when a retry resends already-buffered events', () => {
    const first = withEvents(session(), [event(1), event(2), event(3)], 5_000)
    const again = withEvents(first, [event(2), event(3), event(4)], 6_000)
    expect(again.events.map((entry) => entry.seq)).toEqual([1, 2, 3, 4])
  })

  it('caps the buffer at the newest events instead of growing without bound', () => {
    const many = Array.from({ length: MAX_PENDING_EVENTS + 40 }, (_, index) => event(index + 1))
    const merged = withEvents(session(), many, 7_000)
    expect(merged.events).toHaveLength(MAX_PENDING_EVENTS)
    expect(merged.events[merged.events.length - 1]?.seq).toBe(MAX_PENDING_EVENTS + 40)
  })

  it('never flushes an empty session, because a flush also closes and counts the run', () => {
    expect(shouldFlush(session({ nextRetryAt: 0 }), Date.now())).toBe(false)
    expect(shouldFlush(null, Date.now())).toBe(false)
  })

  it('flushes once the interval arrives and defers while a backoff is running', () => {
    const withEventsBuffered = withEvents(session({ startedAt: Date.now() - 60_000 }), [event(1)], 10)
    expect(withEventsBuffered.nextRetryAt).toBe(10 + FLUSH_INTERVAL_MS)
    expect(shouldFlush(withEventsBuffered, withEventsBuffered.nextRetryAt)).toBe(true)
    expect(shouldFlush(withEventsBuffered, withEventsBuffered.nextRetryAt - 1)).toBe(false)
  })

  it('grows the retry delay and stops at ten minutes', () => {
    expect(retryDelayMs(1)).toBe(5_000)
    expect(retryDelayMs(2)).toBe(10_000)
    expect(retryDelayMs(20)).toBe(600_000)
    const failed = flushFailed(session({ events: [event(1)] }), 'fetch failed', 100_000)
    expect(failed.attempts).toBe(1)
    expect(failed.nextRetryAt).toBe(100_000 + 5_000)
    expect(failed.lastError).toBe('fetch failed')
  })

  it('clears pending events and the backoff after an accepted flush', () => {
    const dirty = flushFailed(session({ events: [event(1), event(2)] }), 'timeout', 10)
    const clean = flushSucceeded(dirty, 20)
    expect(clean.events).toEqual([])
    expect(clean.attempts).toBe(0)
    expect(clean.lastError).toBeNull()
    expect(clean.lastFlushedAt).toBe(20)
    expect(clean.nextRetryAt).toBe(0)
  })

  it('drops a session that is too old to report honestly', () => {
    const stale = session({ startedAt: 0, events: [event(1)] })
    expect(isExpired(stale, SESSION_MAX_AGE_MS + 1)).toBe(true)
    expect(shouldFlush(stale, SESSION_MAX_AGE_MS + 1)).toBe(false)
  })

  it('counts only forward steps as progress', () => {
    const mixed = session({
      events: [event(1, 'forward'), event(2, 'back'), event(3, 'reset'), event(4, 'forward')]
    })
    expect(pendingForwardCount(mixed)).toBe(2)
  })

  it('survives a round trip through the on-disk shape and rejects a truncated file', () => {
    const stored = JSON.stringify({ ...EMPTY_OUTBOX, session: session({ events: [event(1)] }) })
    expect(usageOutboxSchema.parse(JSON.parse(stored)).session?.sessionId).toBe(SESSION_ID)
    expect(usageOutboxSchema.safeParse({ version: 2 }).success).toBe(false)
  })

  it('refuses a session start without a nonce, which is what made every flush fail', () => {
    expect(sessionStartResultSchema.safeParse({ sessionId: SESSION_ID, nonce: NONCE }).success).toBe(true)
    expect(sessionStartResultSchema.safeParse(SESSION_ID).success).toBe(false)
    expect(sessionStartResultSchema.safeParse({ sessionId: SESSION_ID }).success).toBe(false)
  })
})
