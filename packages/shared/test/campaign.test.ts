import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_LEAD_DAYS,
  activeCampaignSchema,
  campaignCountdown,
  campaignDraftErrors,
  campaignDraftPayload,
  campaignHasDetail,
  campaignIsVisible,
  campaignRuleBadge,
  campaignRulesPayload,
  campaignStateOf,
  emptyCampaignDraft,
  emptyCampaignRule,
  parseActiveCampaigns,
  type CampaignAdminRow
} from '../src/index'
import { campaignAdminToDraft } from '../src/domain/campaign'

/**
 * Campaigns (0051) split one rule across two places on purpose: SQL decides money, the client decides
 * what a band may claim. These tests are the seam — if `campaignStateOf()` and `app.campaign_state()`
 * ever disagree about the second a campaign opens, a member is shown a boost that will not pay.
 */

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(here, '../../../supabase/migrations/0051_campaigns.sql'), 'utf8')

const START = Date.parse('2026-11-01T00:00:00Z')
const END = Date.parse('2026-11-04T00:00:00Z')
const window = { startsAt: new Date(START).toISOString(), endsAt: new Date(END).toISOString() }

describe('campaign window arithmetic', () => {
  it('opens on its start instant and closes on its end instant', () => {
    // Exactly `ends_at > now()` from app.campaign_state(): the closing second belongs to the campaign.
    expect(campaignStateOf(window, START - 1)).toBe('upcoming')
    expect(campaignStateOf(window, START)).toBe('live')
    expect(campaignStateOf(window, END - 1)).toBe('live')
    expect(campaignStateOf(window, END)).toBe('ended')
  })

  it('counts down the way the banner needs it', () => {
    const before = campaignCountdown(window, START - 60_000)
    expect(before.state).toBe('upcoming')
    expect(before.startsInMs).toBe(60_000)
    expect(before.endsInMs).toBeNull()

    const during = campaignCountdown(window, START + 60_000)
    expect(during.endsInMs).toBe(END - START - 60_000)
    expect(during.startsInMs).toBeNull()
    expect(during.spansMs).toBe(END - START)
  })

  it('shows a campaign two days early and never after it ends', () => {
    const soon = START - (CAMPAIGN_LEAD_DAYS * 24 * 60 * 60 * 1000 - 60_000)
    const later = START - (CAMPAIGN_LEAD_DAYS * 24 * 60 * 60 * 1000 + 60_000)
    expect(campaignIsVisible(window, soon)).toBe(true)
    expect(campaignIsVisible(window, later)).toBe(false)
    expect(campaignIsVisible(window, END + 1)).toBe(false)
  })

  it('reads a broken date as live rather than as invisible', () => {
    // A row the operator edited by hand must not silently stop showing a boost that is paying.
    expect(campaignStateOf({ startsAt: 'nope', endsAt: 'also-nope' }, START)).toBe('live')
  })
})

describe('campaign rule display', () => {
  const base = {
    code: 'usage_minute',
    nameTr: 'Oturum dakikası',
    nameEn: 'Session minute',
    kind: 'usage',
    unit: 'per_hour',
    baseAmount: 40,
    multiplier: 1,
    dailyCap: null,
    noteTr: null,
    noteEn: null,
    own: false
  }

  it('shows the multiplier for a boost and the fixed amount for a priced rule', () => {
    expect(campaignRuleBadge({ ...base, effectiveAmount: 80, multiplier: 2 })).toBe('×2')
    expect(campaignRuleBadge({ ...base, effectiveAmount: 80, multiplier: 2.5 })).toBe('×2.5')
    expect(campaignRuleBadge({ ...base, effectiveAmount: 300, multiplier: 1 })).toBe('300')
    expect(campaignRuleBadge({ ...base, effectiveAmount: 40 })).toBe('')
  })

  it('offers the detail door only when there is more than the band already said', () => {
    const campaign = activeCampaignSchema.parse({
      ...window,
      key: 'weekend',
      nameTr: 'Hafta sonu',
      nameEn: 'Weekend',
      descTr: 'Çift coin',
      descEn: 'Double coins',
      state: 'live',
      surface: 'banner',
      rules: []
    })
    expect(campaignHasDetail(campaign)).toBe(false)
    expect(campaignHasDetail({ ...campaign, bodyTr: 'Kurallar ve saatler' })).toBe(true)
  })

  it('drops a malformed row instead of dropping the shelf', () => {
    expect(parseActiveCampaigns(null)).toEqual([])
    expect(parseActiveCampaigns('nope')).toEqual([])
    expect(parseActiveCampaigns([{ key: 1 }]).length).toBe(0)
  })
})

describe('the operator draft', () => {
  const good = {
    ...emptyCampaignDraft('weekend-2x'),
    nameTr: 'Hafta Sonu Çarpanı',
    nameEn: 'Weekend Multiplier',
    descTr: 'Bu hafta sonu her etkinlik iki kat coin.',
    descEn: 'Every event pays double coins this weekend.',
    startsAt: new Date(START).toISOString(),
    endsAt: new Date(END).toISOString(),
    rules: [{ ...emptyCampaignRule('usage_minute'), noteTr: 'Oturum dakikası iki katı', noteEn: 'Session minutes doubled' }]
  }

  it('accepts a well-formed campaign', () => {
    expect(campaignDraftErrors(good, START - 1000)).toEqual([])
  })

  it('names every way the form can be wrong, in the keys the form translates', () => {
    expect(campaignDraftErrors({ ...good, key: 'Çok Güzel Etkinlik' }, START)).toContain('admin.campaign.errKey')
    expect(campaignDraftErrors({ ...good, nameEn: '  ' }, START)).toContain('admin.campaign.errName')
    expect(campaignDraftErrors({ ...good, descTr: '' }, START)).toContain('admin.campaign.errDesc')
    expect(campaignDraftErrors({ ...good, endsAt: good.startsAt }, START)).toContain('admin.campaign.errOrder')
    // Saving something that already closed is a date mistake, so the form says so before the RPC does.
    expect(campaignDraftErrors(good, END + 1000)).toContain('admin.campaign.errPast')
    expect(campaignDraftErrors({ ...good, accent: 'red' }, START)).toContain('admin.campaign.errAccent')
    expect(campaignDraftErrors({ ...good, accent: '#a78bfa' }, START)).toEqual([])
    expect(campaignDraftErrors({ ...good, actionUrl: 'javascript:alert(1)' }, START)).toContain('admin.campaign.errAction')
    expect(campaignDraftErrors({ ...good, actionUrl: 'tdsapp://market', actionLabelTr: 'Rafa git', actionLabelEn: 'Open the shelf' }, START)).toEqual([])
    expect(campaignDraftErrors({ ...good, actionUrl: 'https://tds.dev', actionLabelTr: 'Duyuru', actionLabelEn: 'News' }, START)).toEqual([])
    expect(campaignDraftErrors({ ...good, actionUrl: 'https://tds.dev', actionLabelTr: '', actionLabelEn: '' }, START)).toContain(
      'admin.campaign.errActionLabel'
    )
    expect(campaignDraftErrors({ ...good, rules: [emptyCampaignRule('a'), emptyCampaignRule('a')] }, START)).toContain(
      'admin.campaign.errDuplicateRule'
    )
    expect(campaignDraftErrors({ ...good, rules: [{ ...emptyCampaignRule('a'), multiplier: 9 }] }, START)).toContain('admin.campaign.errMultiplier')
    expect(campaignDraftErrors({ ...good, rules: [{ ...emptyCampaignRule('a'), amountOverride: 0 }] }, START)).toContain('admin.campaign.errAmount')
    // The same ceiling rule the economy editor enforces: a cap under one event's pay is a bug, not a deal.
    expect(
      campaignDraftErrors({ ...good, rules: [{ ...emptyCampaignRule('a'), amountOverride: 300, dailyCapOverride: 100 }] }, START)
    ).toContain('admin.campaign.errCapBelow')
  })

  it('sends nulls, not empty strings, and a lowercased key', () => {
    const payload = campaignDraftPayload({ ...good, key: 'Kutu-Oyun', bodyTr: '   ', accent: '' })
    expect(payload.p_key).toBe('kutu-oyun')
    expect(payload.p_body_tr).toBeNull()
    expect(payload.p_accent).toBeNull()
    const rules = campaignRulesPayload([{ ...emptyCampaignRule('x'), noteTr: ' ', noteEn: '' }])
    expect(rules).toEqual([{ code: 'x', multiplier: 2, amountOverride: null, dailyCapOverride: null, noteTr: '', noteEn: '' }])
  })

  it('reads an admin row back into the form without losing the sheet', () => {
    const row = {
      ...window,
      key: 'weekend-2x',
      nameTr: 'Hafta Sonu',
      nameEn: 'Weekend',
      descTr: 'Çift',
      descEn: 'Double',
      surface: 'modal',
      accent: '#f2c14e',
      imagePath: 'campaigns/weekend-2x.webp',
      enabled: false,
      rules: [
        { code: 'usage_minute', multiplier: 2, amountOverride: null, dailyCapOverride: null, noteTr: 'not', noteEn: 'note', ruleNameTr: 'Dakika', ruleNameEn: 'Minute', ruleKind: 'usage', ruleUnit: 'per_hour', ruleAmount: 40, own: true }
      ],
      boundRules: [{ code: 'usage_minute', nameTr: 'Dakika', nameEn: 'Minute', enabled: true }]
    } as unknown as CampaignAdminRow

    const draft = campaignAdminToDraft(row)
    expect(draft.enabled).toBe(false)
    expect(draft.surface).toBe('modal')
    expect(draft.imagePath).toBe('campaigns/weekend-2x.webp')
    expect(draft.rules[0]).toMatchObject({ code: 'usage_minute', multiplier: 2, noteTr: 'not' })
    expect(campaignDraftErrors(draft, START)).toEqual([])
  })
})

describe('campaign server contract (0051)', () => {
  it('gives a campaign a window it cannot invert', () => {
    expect(sql).toContain('constraint campaigns_window_check check (ends_at > starts_at)')
    expect(sql).toContain("check (surface in ('banner', 'modal'))")
    expect(sql).toContain('constraint campaigns_action_check check (action_url is null or action_url ~ \'^(https://|tdsapp://)\')')
    expect(sql).toContain('check (multiplier > 0 and multiplier <= 5)')
  })

  it('binds rules without touching 0038 rule writer', () => {
    expect(sql).toContain('add column if not exists campaign_key text references public.campaigns')
    // One rule editor, not two: 0038's validations must not be forked into this migration.
    expect(sql).not.toMatch(/create or replace function public\.admin_upsert_rule/)
    expect(sql).toContain('public.admin_set_rule_campaign')
  })

  it('runs the money path through the window', () => {
    const body = sql.slice(sql.indexOf('create or replace function public.award_currency'))
    const stop = body.indexOf('$$;\n')
    const award = body.slice(0, stop)
    expect(award).toContain('app.rule_payable_now(p_rule_code)')
    expect(award).toContain('app.campaign_overlay_for_rule(p_rule_code)')
    // The ceilings 0038 added stay: a campaign cannot unlock a cap or a weekly limit.
    expect(award).toContain('v_daily_cap')
    expect(award).toContain('v_rule.weekly_cap')
    expect(award).toContain('decay_after_sessions')
    expect(award).toContain('v_amount := least(p_amount, v_ceiling)')
  })

  it('resolves one campaign per rule, earliest first, without stacking', () => {
    expect(sql).toContain('order by (r.campaign_key = c.key) desc nulls last, c.starts_at asc')
    expect(sql).toContain('limit 1')
  })

  it('reads the shelf two days early and never past the end', () => {
    const reader = sql.slice(sql.indexOf('create or replace function public.active_campaigns()'))
    const body = reader.slice(0, reader.indexOf('$$;\n'))
    expect(body).toContain("interval '2 days'")
    expect(body).toContain('and c.ends_at > now()')
    expect(body).toContain("'effectiveAmount', coalesce(")
  })

  it('keeps a deleted campaign from leaving a rule that pays forever', () => {
    const deleter = sql.slice(sql.indexOf('create or replace function public.admin_delete_campaign'))
    const body = deleter.slice(0, deleter.indexOf('$$;\n'))
    expect(body).toContain('update public.currency_rules set enabled = false where campaign_key = p_key')
    expect(body.indexOf('set enabled = false')).toBeLessThan(body.indexOf('delete from public.campaigns'))
  })

  it('leaves campaign internals off HTTP and the shelf reader on it', () => {
    expect(sql).toContain("execute 'grant execute on function public.active_campaigns() to anon'")
    for (const helper of ['app.campaign_state(text)', 'app.campaign_live(text)', 'app.campaign_overlay_for_rule(text)', 'app.rule_payable_now(text)']) {
      expect(sql).toContain(`'${helper}'`)
    }
    // The internal helpers are revoked in the same loop that lists them.
    expect(sql).toContain("revoke execute on function %s from public, anon, authenticated")
  })

  it('does not reuse the in-game event catalog name', () => {
    // public.events is TDS's own event list (0001), referenced by strategies.event_key.
    expect(sql).not.toMatch(/create table if not exists public\.events/)
    expect(sql).toContain('public.campaigns')
  })

  it('answers false — not NULL — for a rule that does not exist', () => {
    // The first version of `app.rule_payable_now` wrote `select coalesce(case ... end, false)
    // from currency_rules where code = ?`. An unknown code returns *no rows*, and a query that
    // returns no rows returns NULL: the coalesce is never reached because there is no row to
    // coalesce. The migration's own proof block caught it (`an unknown rule should not read as
    // payable`), and `bool_or` over the empty set is what actually yields false.
    const helper = sql.slice(sql.indexOf('create or replace function app.rule_payable_now'))
    const body = helper.slice(0, helper.indexOf('$$;\n'))
    expect(body).toContain('coalesce(')
    expect(body).toContain('bool_or(')
    expect(body).toContain('false')
    expect(sql).toContain("raise exception '0051 failed: an unknown rule should not read as payable'")
  })

  it('proves its own money path before it claims success', () => {
    expect(sql).toContain("raise exception '0051 failed: award_currency still ignores campaign windows'")
    expect(sql).toContain("raise notice '0051 ok:")
  })
})

/**
 * The shelf crashed in the field on the first real event: `active_campaigns()` answered
 * `'own', r.campaign_key = c.key`, and for an ordinary (unbound) rule that comparison is NULL, not
 * false — Postgres arithmetic on a null column. A `boolean` field with a `.default(false)` does not
 * catch an explicit JSON null either, because the key *is* present. Both halves are fixed: the reader
 * answers `coalesce(..., false)`, and the schema refuses to fall over on a null boolean.
 */
describe('nullable booleans from SQL', () => {
  const row = {
    key: 'weekend-2x',
    nameTr: 'Hafta sonu',
    nameEn: 'Weekend',
    descTr: 'Çift coin',
    descEn: 'Double coins',
    startsAt: new Date(START).toISOString(),
    endsAt: new Date(END).toISOString(),
    surface: 'banner',
    state: 'live',
    rules: [{ code: 'usage_minute', kind: 'usage', unit: 'per_hour', baseAmount: 40, effectiveAmount: 80, multiplier: 2, own: null }]
  }

  it('answers false, never null, for whether a rule belongs to the campaign', () => {
    expect(sql).not.toContain("'own', r.campaign_key = c.key")
    expect((sql.match(/'own', coalesce\(r\.campaign_key = c\.key, false\)/g) ?? []).length).toBe(2)
  })

  it('parses a null own flag instead of dropping the campaign', () => {
    const parsed = activeCampaignSchema.parse(row)
    expect(parsed.rules[0]?.own).toBe(false)
    expect(parsed.rules[0]?.effectiveAmount).toBe(80)
  })
})
