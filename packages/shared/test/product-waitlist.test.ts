import { describe, expect, it } from 'vitest'
import {
  adminWaitlistRowSchema,
  productWaitlistEntrySchema,
  productWaitlistResultSchema,
  spendErrorKey
} from '../src/domain/wallet'

/**
 * 0057 gave the market a queue for products that are not on the shelf. Two things can only be caught
 * here: a row that parses into a button the shop then mislabels, and an error prefix the server raises
 * which the UI would otherwise print as Postgres prose.
 */

describe('product waitlist contract', () => {
  it('parses a queue row that carries nothing but its sku', () => {
    const parsed = productWaitlistEntrySchema.parse({ sku: 'cosmetic-neon-frame' })
    expect(parsed.joined).toBe(false)
    expect(parsed.demand).toBe(0)
    expect(parsed.name).toBeNull()
  })

  it('refuses a toggle answer that does not say what happened', () => {
    // `waiting` is the whole answer: a missing flag would render a queue button in the wrong state.
    expect(() => productWaitlistResultSchema.parse({ sku: 'x', demand: 3 })).toThrow()
    expect(productWaitlistResultSchema.parse({ sku: 'x', waiting: true, demand: 3 }).demand).toBe(3)
  })

  it('keeps a negative demand out of the contract', () => {
    expect(() => productWaitlistEntrySchema.parse({ sku: 'x', demand: -1 })).toThrow()
  })

  it('reads the admin row with its people list', () => {
    const parsed = adminWaitlistRowSchema.parse({
      sku: 'theme-aurora',
      name: 'Aurora',
      nameEn: 'Aurora',
      enabled: false,
      demand: 2,
      lastAt: '2026-10-26T09:00:00Z',
      people: [{ handle: 'efe', at: '2026-10-26T09:00:00Z' }]
    })
    expect(parsed.enabled).toBe(false)
    expect(parsed.people[0]?.handle).toBe('efe')
    expect(adminWaitlistRowSchema.parse({ sku: 'x' }).people).toEqual([])
  })

  it('translates the queue errors instead of showing them raw', () => {
    expect(spendErrorKey('NOT_UPCOMING: bu ürün şu an rafta')).toBe('wallet.errOnShelf')
    expect(spendErrorKey('COMING_SOON: henüz satışa açılmadı')).toBe('wallet.errSoon')
    expect(spendErrorKey('NOT_FOUND: ürün katalogda yok')).toBe('wallet.errNotFound')
  })
})
