import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CURRENCY_RULE_KINDS,
  CURRENCY_RULE_UNITS,
  RULE_ICON_NAMES,
  RULE_LEDGER_KINDS,
  UNITS_BY_KIND,
  currencyRuleRowSchema,
  economyErrorKey,
  isRuleIconName,
  memberBadgeRowSchema,
  walletSummarySchema
} from '../src/index'

/**
 * 0038 moved the economy contract out of three hardcoded client maps and into the database, so these
 * tests are the safety net that keeps the TypeScript vocabulary and the SQL CHECK constraints from
 * drifting apart — the migration is applied by hand in the dashboard, nothing else compares them.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migration = readFileSync(join(here, '../../../supabase/migrations/0038_admin_economy_and_badges.sql'), 'utf8')

function checkList(marker: string): string[] {
  const start = migration.indexOf(marker)
  if (start < 0) throw new Error(`migration text lost its ${marker} block`)
  const slice = migration.slice(start, migration.indexOf(')', start))
  return [...slice.matchAll(/'([a-z_]+)'/g)].flatMap((match) => (typeof match[1] === 'string' ? [match[1]] : []))
}

describe('economy contract (0038)', () => {
  it('keeps the rule kinds identical to the database CHECK', () => {
    expect(checkList('currency_rules_kind_check')).toEqual([...CURRENCY_RULE_KINDS])
  })

  it('keeps the ledger kinds identical to their CHECK', () => {
    expect(checkList('ledger_kind in')).toEqual([...RULE_LEDGER_KINDS])
  })

  it('only offers units the till will accept', () => {
    const accepted = new Set(checkList("p_unit <> 'per_event' and p_unit not in ("))
    for (const unit of CURRENCY_RULE_UNITS) expect(accepted.has(unit)).toBe(true)
    for (const [kind, units] of Object.entries(UNITS_BY_KIND)) {
      for (const unit of units) {
        expect(CURRENCY_RULE_UNITS, `${kind} offers ${unit}`).toContain(unit)
      }
    }
  })

  it('parses a rule without the new columns, and defaults them', () => {
    const parsed = currencyRuleRowSchema.parse({
      code: 'event_bonus',
      kind: 'event',
      amount: 40,
      unit: 'per_event',
      daily_cap: null,
      weekly_cap: 200,
      min_qualifying_seconds: null,
      min_steps: null,
      enabled: true
    })
    expect(parsed.icon).toBeNull()
    expect(parsed.ledger_kind).toBe('usage')
  })

  it('rejects a kind the database would refuse', () => {
    expect(() => currencyRuleRowSchema.parse({ code: 'x', kind: 'refunds', amount: 1 })).toThrowError()
  })

  it('names every icon the migration seeds', () => {
    for (const name of ['monitor-play', 'upload', 'shield-check', 'award']) {
      expect(isRuleIconName(name)).toBe(true)
    }
    expect(isRuleIconName('definitely-not-an-icon')).toBe(false)
    expect(RULE_ICON_NAMES.length).toBeGreaterThanOrEqual(25)
  })

  it('translates the admin error prefixes instead of showing Postgres', () => {
    expect(economyErrorKey('NOTE_REQUIRED')).toBe('admin.errNote')
    expect(economyErrorKey('DELTA_INVALID')).toBe('admin.errDelta')
    expect(economyErrorKey('SELF_FORBIDDEN: use the wallet')).toBe('admin.errSelf')
    expect(economyErrorKey('UNKNOWN_RULE: nope')).toBe('admin.errRule')
    expect(economyErrorKey('INSUFFICIENT_FUNDS: user would end at -1')).toBe('admin.errFunds')
    expect(economyErrorKey('connection reset')).toBe('admin.errGeneric')
  })

  it('keeps a member badge row readable before the migration adds the icon', () => {
    const parsed = memberBadgeRowSchema.parse({ code: 'verified', name: 'Doğrulanmış Hesap', tier: 'special' })
    expect(parsed.awarded).toBe(false)
    expect(parsed.iconPath).toBeNull()
    expect(parsed.reward).toBe(0)
  })

  it('carries the rule copy and the admin reason once 0038 is applied', () => {
    const summary = walletSummarySchema.parse({
      balance: 900,
      cached: 900,
      rules: [{ code: 'event_bonus', kind: 'event', amount: 40, dailyCap: null, weeklyCap: null, icon: 'flag', unit: 'per_event' }],
      entries: [{ delta: 500, kind: 'grant', ruleCode: 'admin_adjust', refType: 'admin', note: 'turnuva ödülü', at: '2026-10-25T12:00:00Z' }]
    })
    expect(summary.rules[0]?.icon).toBe('flag')
    expect(summary.rules[0]?.ledgerKind).toBe('usage')
    expect(summary.entries[0]?.note).toBe('turnuva ödülü')
  })
})
