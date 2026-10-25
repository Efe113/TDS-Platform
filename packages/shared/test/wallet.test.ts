import { describe, expect, it } from 'vitest'
import {
  buyBoostResultSchema,
  capRemaining,
  formatCoin,
  spendErrorKey,
  walletItemSchema,
  walletSummarySchema
} from '../src/domain/wallet'

describe('wallet contract', () => {
  it('reads a full wallet payload', () => {
    const parsed = walletSummarySchema.parse({
      balance: 12,
      cached: 12,
      reconciled: true,
      rules: [{ code: 'usage_session', kind: 'usage', amount: 3, dailyCap: 12, weeklyCap: 60, earnedToday: 3, earnedWeek: 3 }],
      entries: [{ delta: -500, kind: 'spend', ruleCode: 'boost_72h', refType: 'order', at: '2026-10-22T12:00:00Z' }],
      catalog: [{ sku: 'theme_ember', kind: 'theme', price: 180, refCode: 'ember', durationHours: null, owned: true }],
      boosts: [{ strategyId: '50857675-9030-4464-a38c-e21c1ff31a42', strategyName: 'Teehee', sku: 'boost_72h', endsAt: '2026-10-25T12:00:00Z' }]
    })
    expect(parsed.balance).toBe(12)
    expect(parsed.entries[0]?.delta).toBe(-500)
    expect(parsed.catalog[0]?.owned).toBe(true)
    expect(parsed.boosts[0]?.strategyName).toBe('Teehee')
  })

  it('tolerates the empty arrays and null caps the server sends for a new account', () => {
    const parsed = walletSummarySchema.parse({ balance: 0, cached: null, rules: [], entries: [], catalog: [], boosts: [] })
    expect(parsed.reconciled).toBe(false)
    expect(parsed.rules).toEqual([])
  })

  it('accepts the replay shape, which omits the keys a fresh purchase returns', () => {
    const replay = buyBoostResultSchema.parse({ replayed: true, boostId: null, endsAt: null, balance: 7 })
    expect(replay.replayed).toBe(true)
    expect(replay.strategyId).toBeNull()
    expect(replay.pricePaid).toBeNull()
  })

  it('accepts VIP membership and the frame it locks to the tier', () => {
    const parsed = walletSummarySchema.parse({
      balance: 5000,
      cached: 5000,
      rules: [],
      entries: [],
      boosts: [],
      vip: true,
      vipBackgroundPath: 'backgrounds/50857675-9030-4464-a38c-e21c1ff31a42/1.gif',
      catalog: [
        { sku: 'vip_lifetime', kind: 'vip', price: 5000, refCode: 'vip', durationHours: null, tag: 'new', owned: false },
        { sku: 'frame_rainbow', kind: 'frame', price: 0, refCode: 'rainbow', durationHours: null, tag: 'vip', owned: false }
      ]
    })
    expect(parsed.catalog[0]?.kind).toBe('vip')
    expect(parsed.catalog[1]?.tag).toBe('vip')
    expect(parsed.vip).toBe(true)
    expect(parsed.vipBackgroundPath).toContain('.gif')
  })

  it('reports the cap headroom a rule actually has left', () => {
    expect(capRemaining(3, 12)).toBe(9)
    expect(capRemaining(12, 12)).toBe(0)
    expect(capRemaining(20, 12)).toBe(0)
    expect(capRemaining(4, null)).toBeNull()
  })

  it('maps the server error prefixes the wallet can explain in its own words', () => {
    expect(spendErrorKey('INSUFFICIENT_FUNDS: need 500 have 12')).toBe('wallet.errFunds')
    expect(spendErrorKey('ALREADY_BOOSTED: you already have an active boost on this strategy')).toBe('wallet.errAlreadyBoosted')
    expect(spendErrorKey('NOT_PUBLISHED: only published strategies can be boosted')).toBe('wallet.errNotPublished')
    expect(spendErrorKey('connection reset')).toBe('wallet.errGeneric')
  })

  it('never tells a VIP buyer about their boost', () => {
    // These prefixes all used to collapse onto one boost-shaped sentence, so owning VIP and clicking
    // buy again read as "this strategy is already promoted".
    expect(spendErrorKey('ALREADY_OWNED: vip_lifetime')).toBe('wallet.errAlreadyOwned')
    expect(spendErrorKey('BENEFIT_ONLY: title_vip_rainbow is a vip benefit')).toBe('wallet.errBenefit')
    expect(spendErrorKey('BENEFIT_ONLY: boost_verified_72h is a verified benefit')).toBe('wallet.errBenefit')
    expect(spendErrorKey('NOT_VERIFIED')).toBe('wallet.errNotVerified')
    expect(spendErrorKey('NO_CREDIT')).toBe('wallet.errNoCredit')
    expect(spendErrorKey('COMING_SOON: frame_toxic')).toBe('wallet.errSoon')
    expect(spendErrorKey('NOT_OWNED')).toBe('wallet.errNotOwned')
    expect(spendErrorKey('NOT_OWNER: pick one of your own strategies')).toBe('wallet.errNotOwner')
    expect(spendErrorKey('UNKNOWN_SKU: nope')).toBe('wallet.errNotFound')
  })

  it('formats coin amounts without decimals', () => {
    expect(formatCoin(1234)).toBe(new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(1234))
    expect(formatCoin(-500)).toContain('500')
  })

  it('degrades an unknown tag or kind instead of blanking the shelf', () => {
    // 0037 introduced the `verified` tag while installed 0.1.2 clients knew four values, and the whole
    // Market page failed to parse. A newer database must never be able to take an older client down.
    const item = walletItemSchema.parse({
      sku: 'title_future',
      kind: 'hologram',
      price: 0,
      refCode: 'future',
      durationHours: null,
      tag: 'seasonal'
    })
    expect(item.kind).toBe('cosmetic')
    expect(item.tag).toBe('none')
  })

  it('keeps the benefit tags the till refuses', () => {
    for (const tag of ['vip', 'verified'] as const) {
      const item = walletItemSchema.parse({ sku: `x_${tag}`, kind: 'title', price: 0, refCode: null, durationHours: null, tag })
      expect(item.tag).toBe(tag)
    }
  })
})
