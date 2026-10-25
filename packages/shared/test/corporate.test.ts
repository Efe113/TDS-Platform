import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CORPORATE_BENEFITS,
  VERIFIED_BENEFITS,
  accountQueueRowSchema,
  boostCreditHours,
  claimBoostResultSchema,
  discoverFacetsSchema,
  economyErrorKey,
  searchRowSchema,
  titleEffect,
  walletSummarySchema
} from '../src/index'

/**
 * 0040 and 0041 are applied by hand in the Supabase dashboard, so nothing but these assertions keeps
 * the client's idea of the corporate tier and the database's copy of it in the same place.
 */

const here = dirname(fileURLToPath(import.meta.url))
const corporateMigration = readFileSync(join(here, '../../../supabase/migrations/0040_corporate_accounts.sql'), 'utf8')
const handsMigration = readFileSync(join(here, '../../../supabase/migrations/0041_admin_money_hands.sql'), 'utf8')
const productMigration = readFileSync(join(here, '../../../supabase/migrations/0042_vip_membership_is_a_product.sql'), 'utf8')

const uuid = 'b3f0f6a4-3e2a-4f79-9a1c-6f2f9f0f1a2b'

describe('corporate account contract (0040)', () => {
  it('quotes the same numbers the grant writes', () => {
    expect(corporateMigration).toContain(`v_days integer := ${CORPORATE_BENEFITS.discountDays}`)
    expect(corporateMigration).toContain(`v_grant integer := ${CORPORATE_BENEFITS.boostCredits}`)
    expect(corporateMigration).toContain(`'${CORPORATE_BENEFITS.boostSku}', 'boost', 0, null, ${CORPORATE_BENEFITS.boostHours}`)
    // The discount is one pass of the price chain, so the percentage lives in SQL as a fraction.
    expect(corporateMigration).toContain(`ceil(price * ${100 - CORPORATE_BENEFITS.discountPercent} / 100.0)::integer`)
  })

  it('keeps the tag vocabulary the client can parse equal to the database CHECK', () => {
    const marker = 'add constraint spend_catalog_tag_check'
    const start = corporateMigration.indexOf(marker)
    const check = corporateMigration.slice(start, corporateMigration.indexOf(';', start))
    const stored = [...check.matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
    expect(stored).toEqual(['none', 'new', 'soon', 'vip', 'verified', 'corporate'])
  })

  it('refuses to sell a corporate benefit from the shelf', () => {
    expect(corporateMigration).toContain("v_item.tag in ('vip', 'verified', 'corporate')")
  })

  it('treats a corporate account as verified rather than as a second tier to check', () => {
    expect(corporateMigration).toContain('p.is_verified or p.is_corporate')
    // …and does not stack the two discounts on top of each other.
    expect(corporateMigration).toContain('and not p.is_corporate')
  })

  it('paints the gold title and only the gold title for the corporate ref', () => {
    expect(titleEffect('corporate')).toBe('corporate')
    expect(corporateMigration).toContain("'title_corporate', 'title', 0, 'corporate'")
  })

  it('parses a summary from a database that has not run 0040', () => {
    const parsed = walletSummarySchema.parse({
      balance: 120,
      cached: 120,
      vip: false,
      verified: true,
      verifiedDiscountEndsAt: null,
      verifiedBoostCredits: 1
    })
    expect(parsed.corporate).toBe(false)
    expect(parsed.corporateDiscountEndsAt).toBeNull()
  })

  it('parses a discovery row from a database that has not run 0040', () => {
    const parsed = discoverFacetsSchema.parse({ total: 9, maps: [], difficulties: [], modes: [] })
    expect(parsed.verified).toBe(0)
    expect(parsed.corporate).toBe(0)
  })

  it('defaults the corporate flags on a queue row instead of failing the queue', () => {
    const parsed = accountQueueRowSchema.parse({
      id: uuid,
      kind: 'corporate',
      status: 'pending',
      message: 'We publish weekly raid guides as a studio of four players.',
      userId: uuid,
      handle: 'studio',
      createdAt: '2026-10-25T10:00:00Z'
    })
    expect(parsed.alreadyCorporate).toBe(false)
    expect(parsed.credits).toBe(0)
  })

  it('reads a search row without the corporate column', () => {
    const row = searchRowSchema.parse({
      id: uuid,
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
      owner_id: uuid,
      created_at: '2026-10-25T10:00:00Z',
      updated_at: '2026-10-25T10:00:00Z',
      is_pinned: false,
      is_favorited: false
    })
    expect(row.author_corporate).toBe(false)
    expect(row.author_verified).toBe(false)
  })

  it('says how long the credit a member is about to spend will pin for', () => {
    expect(boostCreditHours(CORPORATE_BENEFITS.boostSku)).toBe(168)
    expect(boostCreditHours(VERIFIED_BENEFITS.boostSku)).toBe(72)
    expect(boostCreditHours(null)).toBe(VERIFIED_BENEFITS.boostHours)
    const parsed = claimBoostResultSchema.parse({ strategyId: uuid, endsAt: '2026-10-28T10:00:00Z', creditsLeft: 2 })
    expect(parsed.hours).toBe(VERIFIED_BENEFITS.boostHours)
  })
})

describe('VIP membership is a product (0042)', () => {
  it('keeps the benefit refusal away from the sellable membership row', () => {
    expect(productMigration).toContain("v_item.kind <> 'vip' and v_item.tag in ('vip', 'verified', 'corporate')")
  })

  it('repairs a live row that was labelled as a benefit', () => {
    expect(productMigration).toContain('where kind = \'vip\' and tag in (\'vip\', \'verified\', \'corporate\')')
  })

  it('stops the console from re-arming the same trap', () => {
    expect(productMigration).toContain("when p_kind = 'vip' and coalesce(p_tag, 'none') in ('vip', 'verified', 'corporate') then 'none'")
    // The normalised value is what actually gets written, not the raw input.
    expect(productMigration).toContain('v_discount, p_discount_ends_at, v_tag')
  })

  it('still refuses to sell a real benefit row', () => {
    expect(productMigration).toContain("raise exception 'BENEFIT_ONLY: % is a % benefit', p_sku, v_item.tag")
  })
})

describe('admin money hands (0041)', () => {  it('declares each RPC with the signature the client calls', () => {
    for (const signature of [
      'public.admin_reconcile_balance(uuid, text)',
      'public.admin_reconcile_drift(integer)',
      'public.admin_refund_order(uuid, text, boolean, text)',
      'public.admin_set_vip(uuid, boolean, text)'
    ]) {
      expect(handsMigration).toContain(signature)
    }
  })

  it('writes the reversed status it was supposed to have always had', () => {
    expect(handsMigration).toContain("set status = 'reversed'")
    expect(handsMigration).toContain("raise exception 'ALREADY_REVERSED")
  })

  it('repairs the cache from the ledger and never the other way round', () => {
    expect(handsMigration).toContain('set currency_balance_cache =')
    expect(handsMigration).toMatch(/from public\.currency_ledger l where l\.user_id = p\.id/)
  })

  it('keeps self-minting closed while it adds new admin doors', () => {
    // 0016/0018 took award_currency away from clients; a new privileges block must not hand it back.
    expect(handsMigration).not.toMatch(/grant execute on function public\.award_currency/)
    expect(handsMigration).not.toMatch(/grant execute on function app\.ledger_append/)
  })

  it('translates the new refusals instead of showing raw Postgres text', () => {
    expect(economyErrorKey('ALREADY_REVERSED: filled')).toBe('admin.errOrder')
    expect(economyErrorKey('ORDER_REQUIRED')).toBe('admin.errOrder')
    expect(economyErrorKey('NO_VIP_SKU: none')).toBe('admin.errVip')
    expect(economyErrorKey('ALREADY_OWNED: already a VIP')).toBe('admin.errVip')
    expect(economyErrorKey('NOTE_REQUIRED')).toBe('admin.errNote')
  })
})
