import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { formatRemaining, maintenanceState, maintenanceWindow } from '../src/domain/maintenance'

/**
 * The window rule is written twice — once here in TypeScript for the client, once in
 * `app.maintenance_state()` for the trigger — and the two must not disagree, because a member reading
 * "open" against a server refusing writes is the worst possible answer to give someone.
 */

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(here, '../../../supabase/migrations/0046_maintenance_windows.sql'), 'utf8')

const NOW = Date.parse('2026-10-26T12:00:00.000Z')
const iso = (offsetMinutes: number): string => new Date(NOW + offsetMinutes * 60_000).toISOString()

describe('maintenance window evaluation', () => {
  it('treats a missing or hand-broken row as closed, not crashed', () => {
    expect(maintenanceState(null, NOW).on).toBe(false)
    expect(maintenanceState({}, NOW).on).toBe(false)
    expect(maintenanceState({ enabled: true, startsAt: 'de dün' }, NOW).on).toBe(true)
    expect(maintenanceState({ enabled: true, endsAt: 'not a time' }, NOW).endsInMs).toBeNull()
  })

  it('does not call a future window active', () => {
    const state = maintenanceState({ enabled: true, mode: 'locked', startsAt: iso(30) }, NOW)
    expect(state.on).toBe(false)
    expect(state.scheduled).toBe(true)
    expect(state.startsInMs).toBe(30 * 60_000)
    expect(state.mode).toBe('locked')
  })

  it('opens by itself once the window has passed', () => {
    const state = maintenanceState({ enabled: true, startsAt: iso(-60), endsAt: iso(-5) }, NOW)
    expect(state.on).toBe(false)
    expect(state.expired).toBe(true)
  })

  it('counts down inside a live window', () => {
    const state = maintenanceState({ enabled: true, mode: 'read_only', startsAt: iso(-5), endsAt: iso(40) }, NOW)
    expect(state.on).toBe(true)
    expect(state.endsInMs).toBe(40 * 60_000)
  })

  it('keeps an open-ended maintenance on without pretending an end', () => {
    const state = maintenanceState({ enabled: true, note: 'rebuilding' }, NOW)
    expect(state.on).toBe(true)
    expect(state.endsInMs).toBeNull()
    expect(state.note).toBe('rebuilding')
  })

  it('falls back to read_only for a mode the server does not know', () => {
    expect(maintenanceState({ enabled: true, mode: 'nuke' }, NOW).mode).toBe('read_only')
  })

  it('rejects a window that ends before it starts', () => {
    expect(maintenanceWindow(iso(10), iso(5)).valid).toBe(false)
    expect(maintenanceWindow(iso(10), iso(50)).spansMs).toBe(40 * 60_000)
    expect(maintenanceWindow(null, null).valid).toBe(true)
  })

  it('formats remaining time in the language the member reads', () => {
    expect(formatRemaining(47 * 60_000, 'tr')).toBe('47 dk')
    expect(formatRemaining(95 * 60_000, 'tr')).toBe('1 sa 35 dk')
    expect(formatRemaining(50 * 3_600_000, 'tr')).toBe('2 gün')
    expect(formatRemaining(95 * 60_000, 'en')).toBe('1h 35m')
  })
})

describe('the SQL mirror of the same rule', () => {
  it('computes the same four states', () => {
    for (const key of ["'on'", "'scheduled'", "'expired'", "'mode'"]) {
      expect(sql, `${key} missing from maintenance_state()`).toContain(key)
    }
  })

  it('drops the old two-argument setter so the new one cannot be ambiguous', () => {
    expect(sql).toContain('drop function if exists public.admin_set_maintenance(boolean, text);')
  })

  it('guards updates and deletes, not only inserts', () => {
    expect(sql).toContain('before insert or update or delete')
    // A BEFORE DELETE that returns NEW returns NULL, which silently skips the row.
    expect(sql).toContain('if tg_op = ')
    expect(sql).toContain('return old;')
  })

  it('freezes the surfaces the band promises to freeze', () => {
    for (const table of ['spend_orders', 'user_themes', 'strategy_boosts', 'comments', 'ratings', 'favorites', 'account_requests', 'reports']) {
      expect(sql, `${table} is not guarded`).toContain(`'${table}'`)
    }
  })

  it('reads a malformed timestamp as open ended, like the TypeScript does', () => {
    expect(sql).toContain("when coalesce(v_value ->> 'startsAt', '') ~")
    expect(sql).toContain('else null end')
  })
})
