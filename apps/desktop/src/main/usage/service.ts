import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  EMPTY_OUTBOX,
  flushFailed,
  flushSucceeded,
  isExpired,
  pendingForwardCount,
  sessionStartResultSchema,
  shouldFlush,
  usageOutboxSchema,
  withEvents,
  type UsageEvent,
  type UsageFlushResult,
  type UsageOutbox,
  type UsageStatus
} from '@tds/shared'
import { logger } from '../log'

const TICK_MS = 10 * 1000
/** A hung REST call must not wedge the queue forever. */
const FLUSH_TIMEOUT_MS = 8000
/** Hard cap for the final flush attempted while quitting. */
const QUIT_FLUSH_CAP_MS = 5000

export interface UsageDeps {
  db: () => SupabaseClient | null
  /**
   * False until the stored session has actually been restored into the client. flush_usage and
   * start_overlay_session both resolve the user through auth.uid(), so calling them too early fails
   * with FORBIDDEN/ANONYMOUS - a timing artifact, not a real rejection, and it must not burn a
   * retry attempt.
   */
  signedIn: () => boolean
  /** The overlay buffers events; the service is the only consumer. */
  drainEvents: () => UsageEvent[]
  trackingEnabled: () => boolean
  meta: () => { appVersion: string; hookBackend: string | null; displayId: string | null }
}

/**
 * Usage sessions: one server session per tracked strategy, an on-disk outbox so an offline run or a
 * crash cannot lose the steps the user already advanced, and a flush that never sends an empty
 * batch. The server closes a session inside flush_usage, so "closed" and "counted" are the same
 * event and a retry can only ever add duplicate (session_id, seq) rows, which it ignores.
 *
 * A tracked document that has no published strategy row (or tracking switched off, or no session
 * token) is still fully usable: the overlay works, nothing is counted, and the reason is reported
 * through `status().lastError` so the UI can say it out loud instead of silently doing nothing.
 */
class UsageService {
  private deps: UsageDeps | null = null
  private outbox: UsageOutbox = EMPTY_OUTBOX
  private timer: NodeJS.Timeout | null = null
  private writeChain: Promise<void> = Promise.resolve()
  private inFlight: Promise<boolean> | null = null
  private localReason: string | null = null

  init(deps: UsageDeps): void {
    this.deps = deps
    void this.restore()
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  /** Stops the timer. Pending events stay on disk and are retried on the next start. */
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  status(): UsageStatus {
    const session = this.outbox.session
    return {
      sessionId: session?.sessionId ?? null,
      strategyId: session?.strategyId ?? null,
      startedAt: session?.startedAt ?? null,
      counted: session !== null,
      pending: session?.events.length ?? 0,
      pendingForward: pendingForwardCount(session),
      attempts: session?.attempts ?? 0,
      lastError: session?.lastError ?? this.localReason,
      lastFlushedAt: session?.lastFlushedAt ?? null,
      nextRetryAt: session?.nextRetryAt ?? 0
    }
  }

  /** Starts counting for a published strategy. `null` means local tracking only. */
  begin(strategyId: string | null): Promise<void> {
    return this.chain(() => this.beginInner(strategyId))
  }

  /**
   * Tracking stopped. A session that flushed cleanly is dropped; one whose events were not accepted
   * stays in the outbox so the tick (or the next app start) retries it.
   */
  end(): Promise<void> {
    return this.chain(() => this.endInner())
  }

  /**
   * Session start/stop are serialized: strategy:load can be pressed twice, and two overlapping
   * begins would open two server sessions and orphan one (its events could never be flushed).
   */
  private queue: Promise<unknown> = Promise.resolve()

  private chain<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  private async beginInner(strategyId: string | null): Promise<void> {
    if (!this.deps) return
    if (this.outbox.session !== null) await this.endInner()

    this.localReason = null

    if (!this.deps.trackingEnabled()) {
      this.localReason = 'usage.trackingDisabled'
      await this.persist()
      return
    }
    if (strategyId === null) {
      this.localReason = 'usage.notPublished'
      await this.persist()
      return
    }

    const db = this.deps.db()
    if (!db) {
      this.localReason = 'usage.notConfigured'
      await this.persist()
      return
    }
    if (!this.deps.signedIn()) {
      // ANONYMOUS on the server side would say the same thing; waiting costs nothing.
      this.localReason = 'ANONYMOUS: session not restored yet'
      await this.persist()
      return
    }

    const meta = this.deps.meta()
    // The RPC builder is a thenable without .catch(); a transport error must still land as
    // "this run is not counted" rather than as a rejected promise nobody handles.
    let started: { data: unknown; error: { message: string } | null }
    try {
      started = await db.rpc('start_overlay_session', {
        p_strategy_id: strategyId,
        p_display_id: meta.displayId,
        p_app_version: meta.appVersion,
        p_hook_backend: meta.hookBackend
      })
    } catch (error) {
      started = { data: null, error: { message: error instanceof Error ? error.message : String(error) } }
    }

    if (started.error) {
      // NOT_PUBLISHED and ANONYMOUS are expected states, not bugs: say so in the UI.
      this.localReason = started.error.message
      logger.warn(`usage session refused: ${started.error.message}`)
      await this.persist()
      return
    }

    const parsed = sessionStartResultSchema.safeParse(started.data)
    if (!parsed.success) {
      this.localReason = 'unexpected start_overlay_session payload'
      await this.persist()
      return
    }

    this.outbox = {
      version: 1,
      session: {
        sessionId: parsed.data.sessionId,
        nonce: parsed.data.nonce,
        strategyId,
        startedAt: Date.now(),
        events: [],
        attempts: 0,
        nextRetryAt: 0,
        lastError: null,
        lastFlushedAt: null
      }
    }
    await this.persist()
  }

  /**
   * Tracking stopped. A session that flushed cleanly is dropped; one whose events were not accepted
   * stays in the outbox so the tick (or the next app start) retries it. Never sends an empty batch:
   * flush_usage closes and counts the run, so an empty call would invent a use.
   */
  private async endInner(): Promise<void> {
    const session = this.outbox.session
    if (session !== null) {
      if (session.events.length > 0) await this.flush()
      if (this.outbox.session && this.outbox.session.events.length === 0) this.outbox = EMPTY_OUTBOX
    } else {
      this.localReason = null
    }
    await this.persist()
  }

  /** Manual retry from the UI. Reports what it did instead of silently returning a boolean. */
  async flushNow(): Promise<UsageFlushResult> {
    const session = this.outbox.session
    if (!session || session.events.length === 0) {
      return { attempted: false, accepted: false, messageKey: 'usage.nothingPending', detail: null, status: this.status() }
    }
    // A click is an explicit retry: the backoff window is not allowed to talk the user out of it.
    if (isExpired(session, Date.now())) {
      return { attempted: false, accepted: false, messageKey: 'usage.deferred', detail: null, status: this.status() }
    }
    const accepted = await this.flush()
    return {
      attempted: true,
      accepted,
      messageKey: accepted ? 'usage.flushed' : 'usage.failed',
      detail: accepted ? null : (this.outbox.session?.lastError ?? 'unknown'),
      status: this.status()
    }
  }

  /**
   * Best-effort final flush on quit, time-capped: the app must not hang because Supabase is slow.
   * Anything unaccepted remains in the outbox and is retried on the next start.
   */
  async flushForQuit(): Promise<void> {
    const session = this.outbox.session
    if (!session || session.events.length === 0) return
    await Promise.race([
      this.flush(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, QUIT_FLUSH_CAP_MS)
      })
    ])
  }

  private async tick(): Promise<void> {
    if (!this.deps) return
    const now = Date.now()
    const drained = this.deps.drainEvents()

    if (this.outbox.session === null) return

    if (isExpired(this.outbox.session, now)) {
      logger.warn(`usage session abandoned after ${String(Math.round((now - this.outbox.session.startedAt) / 3600000))}h with ${String(this.outbox.session.events.length)} pending events`)
      this.outbox = EMPTY_OUTBOX
      await this.persist()
      return
    }

    if (drained.length > 0) {
      this.outbox = { ...this.outbox, session: withEvents(this.outbox.session, drained, now) }
      await this.persist()
    }

    if (shouldFlush(this.outbox.session, now)) await this.flush()
  }

  private async flush(): Promise<boolean> {
    if (this.inFlight) return this.inFlight
    const deps = this.deps
    const session = this.outbox.session
    const db = deps?.db() ?? null
    if (!session || session.events.length === 0 || !db || !deps) return false
    // Not an attempt: an early call before the stored session is restored would fail with
    // FORBIDDEN for a reason that has nothing to do with the data being sent.
    if (!deps.signedIn()) return false

    const events = session.events
    const task = this.sendFlush(db, session.sessionId, session.nonce, events)
      .then((outcome) => {
        const now = Date.now()
        if (outcome.error !== null) {
          this.outbox = { ...this.outbox, session: flushFailed(session, outcome.error, now) }
          logger.warn(`usage flush failed (${String(session.attempts + 1)}): ${outcome.error}`)
          void this.persist()
          return false
        }
        this.outbox = { ...this.outbox, session: flushSucceeded(session, now) }
        logger.info(`usage flushed: ${String(events.length)} events, qualified=${String(outcome.qualified)}, awarded=${String(outcome.awarded)}`)
        void this.persist()
        return true
      })
      .finally(() => {
        this.inFlight = null
      })

    this.inFlight = task
    return task
  }

  private async sendFlush(
    db: SupabaseClient,
    sessionId: string,
    nonce: string,
    events: UsageEvent[]
  ): Promise<{ error: string | null; qualified: boolean; awarded: number }> {
    const request = db.rpc('flush_usage', { p_session_id: sessionId, p_nonce: nonce, p_events: events })
    const TIMEOUT = Symbol('flush-timeout')
    let raced: Awaited<typeof request> | typeof TIMEOUT
    try {
      raced = await Promise.race([
        request,
        new Promise<typeof TIMEOUT>((resolve) => {
          setTimeout(() => resolve(TIMEOUT), FLUSH_TIMEOUT_MS)
        })
      ])
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), qualified: false, awarded: 0 }
    }

    if (raced === TIMEOUT) return { error: 'flush timed out', qualified: false, awarded: 0 }
    if (raced.error) return { error: raced.error.message, qualified: false, awarded: 0 }

    const row = Array.isArray(raced.data) ? (raced.data[0] as { qualified?: boolean; awarded?: number } | undefined) : undefined
    return { error: null, qualified: row?.qualified === true, awarded: Number(row?.awarded ?? 0) }
  }

  private filePath(): string {
    const dir = join(app.getPath('userData'), 'usage')
    return join(dir, 'outbox.json')
  }

  private async restore(): Promise<void> {
    const path = this.filePath()
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      await this.setAside(path, 'unparsable')
      return
    }

    const checked = usageOutboxSchema.safeParse(parsed)
    if (!checked.success) {
      await this.setAside(path, 'schema')
      return
    }

    this.outbox = checked.data
    if (checked.data.session && isExpired(checked.data.session, Date.now())) {
      logger.warn('stored usage session is too old to report, dropping it')
      this.outbox = EMPTY_OUTBOX
      await this.persist()
      return
    }
    if (checked.data.session && checked.data.session.events.length > 0) {
      logger.info(`usage outbox restored: ${String(checked.data.session.events.length)} events pending`)
    }
  }

  /** Keeps a corrupt outbox for inspection instead of overwriting evidence with a silent reset. */
  private async setAside(path: string, reason: string): Promise<void> {
    try {
      await rename(path, `${path}.${reason}.bad`)
      logger.warn(`usage outbox ${reason}, moved aside`)
    } catch (error) {
      logger.warn('usage outbox could not be moved aside', error)
    }
    this.outbox = EMPTY_OUTBOX
  }

  private persist(): Promise<void> {
    const payload = JSON.stringify(this.outbox)
    this.writeChain = this.writeChain.then(async () => {
      const path = this.filePath()
      try {
        await mkdir(join(app.getPath('userData'), 'usage'), { recursive: true })
        const temp = `${path}.tmp`
        await writeFile(temp, payload, 'utf8')
        await rename(temp, path)
      } catch (error) {
        logger.warn('usage outbox could not be written', error)
      }
    })
    return this.writeChain
  }
}

export const usageService = new UsageService()
