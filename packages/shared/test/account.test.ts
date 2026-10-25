import { describe, expect, it } from 'vitest'
import {
  VERIFIED_BENEFITS,
  accountErrorKey,
  accountMessageIsValid,
  accountQueueRowSchema,
  submitRequestResultSchema,
  titleEffect,
  walletSummarySchema,
  VERIFIED_TITLE_REF,
  searchRowSchema
} from '../src/index'

const queueRow = {
  id: 'b3f0f6a4-3e2a-4f79-9a1c-6f2f9f0f1a2b',
  kind: 'verified',
  status: 'pending',
  message: 'I publish wave-by-wave guides for current maps.',
  userId: '7c1a6a1e-6d0d-4a71-8f0e-2f2b4c1d9a10',
  handle: 'efe',
  createdAt: '2026-10-25T10:00:00Z'
}

describe('verified account contract', () => {
  it('parses a queue row that omits every optional field', () => {
    const parsed = accountQueueRowSchema.parse(queueRow)
    expect(parsed.links).toBeNull()
    expect(parsed.alreadyVerified).toBe(false)
    expect(parsed.published).toBe(0)
  })

  it('keeps a stored application from lying about its status', () => {
    expect(() => accountQueueRowSchema.parse({ ...queueRow, status: 'reviewing' })).toThrowError()
  })

  it('treats a replayed submission as a success with no new id required', () => {
    const parsed = submitRequestResultSchema.parse({ status: 'pending', replayed: true })
    expect(parsed.requestId).toBeNull()
    expect(parsed.status).toBe('pending')
  })

  it('maps the server error prefixes the form can show', () => {
    expect(accountErrorKey('MESSAGE_SHORT: too thin')).toBe('verified.errShort')
    expect(accountErrorKey('NOT_OWNER: pick one of your own strategies')).toBe('verified.errOwner')
    expect(accountErrorKey('ANONYMOUS: sign in first')).toBe('verified.errAuth')
    expect(accountErrorKey('connection reset')).toBe('verified.errGeneric')
  })

  it('refuses what the check constraint would refuse anyway', () => {
    expect(accountMessageIsValid('x'.repeat(19))).toBe(false)
    expect(accountMessageIsValid('x'.repeat(20))).toBe(true)
    expect(accountMessageIsValid(`${'x'.repeat(2000)}y`)).toBe(false)
  })

  it('paints the verified title and leaves ordinary titles plain', () => {
    expect(titleEffect(VERIFIED_TITLE_REF)).toBe('verified-green')
    expect(titleEffect('founder')).toBeNull()
  })

  it('defaults the tier fields when the database has not run 0037', () => {
    const parsed = walletSummarySchema.parse({ balance: 100, cached: 100 })
    expect(parsed.verified).toBe(false)
    expect(parsed.verifiedBoostCredits).toBe(0)
    expect(parsed.verifiedDiscountEndsAt).toBeNull()
    expect(VERIFIED_BENEFITS.discountPercent).toBe(10)
  })

  it('keeps a strategy row without the author flag parseable', () => {
    const row = searchRowSchema.parse({
      id: 'b3f0f6a4-3e2a-4f79-9a1c-6f2f9f0f1a2b',
      slug: 'abyssal-trench-20',
      name: 'Abyssal Trench 20',
      subtitle: null,
      difficulty: 'hard',
      game_mode: 'standard',
      player_count: '4',
      map_key: 'abyssal-trench',
      is_event_strategy: false,
      event_key: null,
      wave_from: 1,
      wave_to: 20,
      times_used: 3,
      rating_avg: null,
      rating_count: 0,
      credit_creator: null,
      owner_id: '7c1a6a1e-6d0d-4a71-8f0e-2f2b4c1d9a10',
      created_at: '2026-10-25T10:00:00Z',
      updated_at: '2026-10-25T10:00:00Z',
      is_pinned: false,
      is_favorited: false
    })
    expect(row.author_verified).toBe(false)
  })
})
