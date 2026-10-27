import { describe, expect, it } from 'vitest'
import { strategyCacheEntrySchema, strategyCacheRowSchema } from '../src/ipc/contract'
import { strategyCacheFileName } from '../src/ipc/cache-name'

const SAFE = /^[a-z0-9-]+\.json$/

const MINIMAL_IR = {
  format: { source: 'manual' },
  meta: {
    name: 'Test',
    difficulty: 'hard',
    gameMode: { key: 'classic', raw: 'classic', resolved: true },
    playerCount: 'solo',
    credit: { creator: 'me' }
  },
  inventory: [{ towerKey: 'sniper_tower', rawLabel: 'Sniper', alternatives: [], unresolved: false }],
  steps: [{ stepNo: 1, action: 'place', towerKey: 'sniper_tower', raw: 'Place Sniper', alternatives: [], unresolved: false }]
}

describe('the offline shelf file name', () => {
  it('is stable and readable for both key shapes', () => {
    const uuid = strategyCacheFileName('8f14e45f-ea0a-4b04-9e1b-2f9b7e5c1a3d')
    const local = strategyCacheFileName('local:Abandoned Town')
    expect(uuid).toMatch(SAFE)
    expect(local).toMatch(SAFE)
    expect(local).toContain('local-abandoned-town')
    expect(strategyCacheFileName('local:Abandoned Town')).toBe(local)
  })

  it('cannot be steered out of the cache directory', () => {
    for (const key of ['../../..', '..\\..\\evil', '/absolute/path', 'a/../b', '', '🎉', ' ', 'x'.repeat(400)]) {
      const name = strategyCacheFileName(key)
      expect(name).toMatch(SAFE)
      expect(name.includes('/')).toBe(false)
      expect(name.includes('\\')).toBe(false)
      expect(name.includes('..')).toBe(false)
    }
  })

  it('separates two keys that read the same once sanitised', () => {
    expect(strategyCacheFileName('a/b')).not.toBe(strategyCacheFileName('a_b'))
    expect(strategyCacheFileName('Local:Ab')).not.toBe(strategyCacheFileName('local:ab'))
  })
})

describe('the offline shelf contract', () => {
  it('fills the optional halves of a saved document', () => {
    const parsed = strategyCacheEntrySchema.safeParse({
      key: 'local:Test',
      name: 'Test',
      savedAt: 1_730_000_000_000,
      ir: MINIMAL_IR
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.towerNamesTr).toEqual({})
      expect(parsed.data.stepHealth).toEqual([])
    }
  })

  it('refuses a document without a key or a timestamp', () => {
    expect(strategyCacheEntrySchema.safeParse({ name: 'Test', savedAt: 1, ir: MINIMAL_IR }).success).toBe(false)
    expect(strategyCacheEntrySchema.safeParse({ key: 'k', name: 'Test', ir: MINIMAL_IR }).success).toBe(false)
  })

  it('reads a listing row without the IR', () => {
    const row = strategyCacheRowSchema.parse({ key: 'k', name: 'Test', savedAt: 1, steps: 12 })
    expect(row.isEventStrategy).toBe(false)
  })
})
