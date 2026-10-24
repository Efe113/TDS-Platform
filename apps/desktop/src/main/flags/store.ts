import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../log'

/**
 * `app_flags` is the remote kill switch the admin panel already writes to. Until now nothing on this
 * side read it, so `hotkeys_enabled=false` was decoration; this store is the read path.
 *
 * One flag is consumed today: hotkeys_enabled. It is read here rather than in the renderer because
 * the global keyboard hook lives in this process, and the renderer cannot unhook it.
 */

const REFRESH_MS = 5 * 60 * 1000

export interface FlagDeps {
  db: () => SupabaseClient | null
}

export type FlagListener = (hotkeysEnabled: boolean) => void

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export class FlagStore {
  private deps: FlagDeps | null = null
  private timer: NodeJS.Timeout | null = null
  private inFlight: Promise<void> | null = null
  private hotkeysEnabled = true
  private readonly listeners = new Set<FlagListener>()

  init(deps: FlagDeps): void {
    this.deps = deps
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  onChange(listener: FlagListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Fails open on purpose: a network hiccup must not silently take the app's core feature away, and
   * the switch is aimed at a known-bad hook, not at an offline database. The last good value stays.
   *
   * The postgrest builder is a thenable without catch/finally, so the read is awaited inside an async
   * IIFE first (same reason flush_usage's client call needed it).
   */
  async refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight
    const db = this.deps?.db() ?? null
    if (!db) return

    const read = (async (): Promise<void> => {
      try {
        const { data, error } = await db.from('app_flags').select('key,value').in('key', ['hotkeys_enabled'])
        if (error) {
          logger.warn(`flag read failed: ${error.message}`)
          return
        }
        const rows = Array.isArray(data) ? (data as Array<{ key?: string; value?: unknown }>) : []
        const row = rows.find((entry) => entry.key === 'hotkeys_enabled')
        if (!row) return
        this.apply(readBool(row.value, true))
      } catch (error) {
        logger.warn('flag read threw', error)
      }
    })()

    this.inFlight = read
    const clear = (): void => {
      if (this.inFlight === read) this.inFlight = null
    }
    void read.then(clear, clear)
    return read
  }

  /** Announced only on change, so a flag that never moves never touches the hook. */
  private apply(hotkeysEnabled: boolean): void {
    if (hotkeysEnabled === this.hotkeysEnabled) return
    this.hotkeysEnabled = hotkeysEnabled
    logger.info(`remote flag hotkeys_enabled=${String(hotkeysEnabled)}`)
    for (const listener of this.listeners) listener(hotkeysEnabled)
  }
}

export const featureFlags = new FlagStore()
