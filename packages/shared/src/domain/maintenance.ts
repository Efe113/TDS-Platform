import { z } from 'zod'

/**
 * Maintenance state (0046).
 *
 * The flag row is the only storage: `app_flags.value` carries the window, the message and the mode.
 * Both sides evaluate it the same way — the server to decide whether a write is allowed, the client to
 * decide what the member sees — so "is the platform frozen right now" can never be answered twice with
 * different results. The rule lives here, in one pure function, and the SQL mirrors it line for line.
 *
 * `locked` is deliberately not "everything off": reads, the overlay and the local app keep working,
 * because the companion still has to be usable while the platform is being repaired. What it adds over
 * `read_only` is a full-screen gate, which is the honest way to say "writing is not possible yet".
 */

export const MAINTENANCE_MODES = ['read_only', 'locked'] as const
export type MaintenanceMode = (typeof MAINTENANCE_MODES)[number]

/** What the operator stores. Everything is optional so a hand-edited row cannot crash the read path. */
export const maintenanceFlagSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(MAINTENANCE_MODES).catch('read_only'),
  title: z.string().max(80).nullable().default(null),
  note: z.string().max(400).nullable().default(null),
  startsAt: z.string().nullable().default(null),
  endsAt: z.string().nullable().default(null)
})

export type MaintenanceFlag = z.infer<typeof maintenanceFlagSchema>

export interface MaintenanceState {
  /** True only while enabled *and* inside the window: a scheduled maintenance is not active yet. */
  on: boolean
  /** Enabled with a start in the future — the client can announce it before it begins. */
  scheduled: boolean
  /** Enabled with a window that has already passed; the flag row still says on, so the UI must not lie. */
  expired: boolean
  mode: MaintenanceMode
  title: string | null
  note: string | null
  startsAt: string | null
  endsAt: string | null
  startsInMs: number | null
  endsInMs: number | null
}

/** A bad or missing timestamp is read as open-ended rather than as an error, matching the SQL. */
function parseTime(value: string | null): number | null {
  if (value === null) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function maintenanceState(value: unknown, nowMs: number): MaintenanceState {
  const flag = maintenanceFlagSchema.parse(value ?? {})
  const starts = parseTime(flag.startsAt)
  const ends = parseTime(flag.endsAt)
  const started = starts === null || starts <= nowMs
  const beforeEnd = ends === null || ends > nowMs
  const active = flag.enabled && started && beforeEnd

  return {
    on: active,
    scheduled: flag.enabled && !started,
    expired: flag.enabled && started && !beforeEnd,
    mode: flag.mode,
    title: flag.title,
    note: flag.note,
    startsAt: flag.startsAt,
    endsAt: flag.endsAt,
    startsInMs: started ? null : starts - nowMs,
    endsInMs: !active || ends === null ? null : ends - nowMs
  }
}

/** The shape the admin form writes; the RPC owns the flag row so the client never edits it directly. */
export interface MaintenanceDraft {
  on: boolean
  mode: MaintenanceMode
  title: string
  note: string
  /** Wall-clock strings from datetime-local inputs, converted to ISO by the caller. */
  startsAt: string | null
  endsAt: string | null
}

export const MAINTENANCE_QUICK_HOURS = [0.5, 2, 8, 24] as const

/**
 * A window the operator can read back: ends after it starts, and both are absolute. Returns null when
 * the pair makes no sense, so the form can say so instead of storing a window that never opens.
 */
export function maintenanceWindow(startsAt: string | null, endsAt: string | null): { valid: boolean; spansMs: number | null } {
  const starts = parseTime(startsAt)
  const ends = parseTime(endsAt)
  if (starts !== null && ends !== null && ends <= starts) return { valid: false, spansMs: null }
  if (starts === null && ends === null) return { valid: true, spansMs: null }
  if (ends === null) return { valid: true, spansMs: null }
  if (starts === null) return { valid: true, spansMs: ends - Date.now() }
  return { valid: true, spansMs: ends - starts }
}

/** Coarse enough for a countdown that a member reads once: 47 dk, 3 sa 12 dk. */
export function formatRemaining(ms: number, locale: 'tr' | 'en'): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return locale === 'tr' ? `${String(minutes)} dk` : `${String(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return locale === 'tr' ? `${String(hours)} sa ${String(rest)} dk` : `${String(hours)}h ${String(rest)}m`
  const days = Math.floor(hours / 24)
  return locale === 'tr' ? `${String(days)} gün` : `${String(days)}d`
}
