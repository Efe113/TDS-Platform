import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sessionStorageAction } from '../src/supabase/client'

/**
 * Signing in every launch was the symptom; the cause was an event that means "here is what I have in
 * memory" being read as "the member signed out". With persistence off the main client starts with no
 * session, and `onAuthStateChange` always delivers that empty INITIAL_SESSION to a new subscriber — so
 * the handler deleted the stored session file before the asynchronous restore had finished reading it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const manager = readFileSync(join(here, '../../../apps/desktop/src/main/auth/manager.ts'), 'utf8')

describe('what a state change may do to the stored session', () => {
  it('never treats an empty initial session as a sign-out', () => {
    expect(sessionStorageAction('INITIAL_SESSION', false)).toBe('keep')
    expect(sessionStorageAction('USER_UPDATED', false)).toBe('keep')
  })

  it('saves every session it is given', () => {
    for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION']) {
      expect(sessionStorageAction(event, true)).toBe('persist')
    }
  })

  it('clears only on a real sign-out', () => {
    expect(sessionStorageAction('SIGNED_OUT', false)).toBe('clear')
  })
})

describe('the manager that owns the session file', () => {
  it('subscribes after the stored session has been restored', () => {
    // Registering first is what lost the file: the INITIAL_SESSION arrives before the restore resolves.
    expect(manager).toContain('void this.restoreStoredSession().finally(() => this.subscribeToState())')
  })

  it('has exactly one subscription, and it routes through the shared rule', () => {
    expect(manager.split('onAuthStateChange').length - 1).toBe(1)
    expect(manager.indexOf('onAuthStateChange')).toBeGreaterThan(manager.indexOf('private subscribeToState()'))
    expect(manager).toContain('sessionStorageAction(event, session !== null)')
  })
})
