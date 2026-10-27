import { parseActiveCampaigns, type ActiveCampaign, type CampaignRule } from '@tds/shared'
import { supabase } from './supabase'
import { NotConfiguredError } from './discovery-api'

/**
 * The campaign band's read path (0051).
 *
 * `active_campaigns()` is a definer function rather than a table select because the shelf shows money
 * terms: the multiplier has to come from the same rows `award_currency()` will pay from, and a member
 * must not be able to read a campaign's rules through a different lens than the ledger used.
 *
 * Polling, not realtime: nothing in this app subscribes to Postgres changes, and a campaign opening
 * mid-session is a minute-scale event. The same 60 seconds the maintenance banner already uses.
 */
export async function fetchActiveCampaigns(): Promise<ActiveCampaign[]> {
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase.rpc('active_campaigns')
  if (error) throw new Error(error.message)
  return parseActiveCampaigns(data ?? [])
}

/**
 * A rule's own numbers plus whatever a live campaign does to it — the wallet's rule list reads through
 * this so "400 coin" and "etkinlikte ×2 → 800" cannot appear on the same screen as each other.
 */
export function campaignRuleByCode(campaigns: ActiveCampaign[]): Map<string, CampaignRule> {
  const map = new Map<string, CampaignRule>()
  for (const campaign of campaigns) {
    for (const rule of campaign.rules) {
      // The earliest campaign wins, matching app.campaign_overlay_for_rule(); the reader already
      // orders its rows by starts_at, so the first answer seen is the authority.
      if (!map.has(rule.code)) map.set(rule.code, rule)
    }
  }
  return map
}

/** The one campaign that gets the band or the modal, or null when there is nothing to say. */
export function pickCampaignBanner(campaigns: ActiveCampaign[]): ActiveCampaign | null {
  const live = campaigns.filter((campaign) => campaign.state === 'live')
  const first = live[0] ?? campaigns[0]
  return first ?? null
}
