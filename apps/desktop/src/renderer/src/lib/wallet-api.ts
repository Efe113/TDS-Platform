import {
  buyBoostResultSchema,
  productWaitlistEntrySchema,
  productWaitlistResultSchema,
  walletSummarySchema,
  type BuyBoostResult,
  type ProductWaitlistEntry,
  type ProductWaitlistResult,
  type WalletSummary
} from '@tds/shared'
import { supabase } from './supabase'
import { whenSessionReady } from './session'
import { NotConfiguredError } from './discovery-api'

/**
 * Purchase keys are generated per attempt and reused only when the same attempt is retried, which is
 * what makes a double click or a lost response safe: the server replays the original order instead of
 * charging twice.
 */
export function newPurchaseKey(): string {
  const random = globalThis.crypto as Crypto | undefined
  if (random && typeof random.randomUUID === 'function') return random.randomUUID()
  const tail = (): string => Math.random().toString(36).slice(2, 10)
  return `k-${Date.now().toString(36)}-${tail()}${tail()}`
}

export async function fetchWallet(): Promise<WalletSummary> {
  await whenSessionReady()
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase.rpc('wallet_summary')
  if (error) throw new Error(error.message)
  return walletSummarySchema.parse(data ?? {})
}

export async function buyBoost(strategyId: string, sku: string, key: string): Promise<BuyBoostResult> {
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase.rpc('buy_boost', {
    p_strategy_id: strategyId,
    p_sku: sku,
    p_idempotency_key: key
  })
  if (error) throw new Error(error.message)
  return buyBoostResultSchema.parse(data ?? {})
}

/**
 * 0057: the queue in front of a shelf that is not open yet. Its own read rather than a field on
 * `wallet_summary`, so the shop's payload did not have to be re-declared for one button.
 */
export async function fetchProductWaitlist(): Promise<ProductWaitlistEntry[]> {
  await whenSessionReady()
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase.rpc('product_waitlist')
  if (error) throw new Error(error.message)
  return productWaitlistEntrySchema.array().parse(data ?? [])
}

/** `joined` decides the direction, so the card is one button rather than two callbacks. */
export async function toggleProductWaitlist(sku: string, joined: boolean): Promise<ProductWaitlistResult> {
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase.rpc(joined ? 'leave_product_waitlist' : 'join_product_waitlist', { p_sku: sku })
  if (error) throw new Error(error.message)
  return productWaitlistResultSchema.parse(data ?? {})
}

/** Themes and other fixed-catalog items go through spend_currency; boosts do not (they need a target). */
export async function buySku(sku: string, key: string): Promise<number> {
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase.rpc('spend_currency', { p_sku: sku, p_idempotency_key: key })
  if (error) throw new Error(error.message)
  const rows = Array.isArray(data) ? (data as Array<{ balance?: number }>) : []
  return Number(rows[0]?.balance ?? 0)
}

/**
 * select_theme is the only write path for profiles.theme_key (the guard trigger pins it otherwise),
 * and it refuses a theme the caller does not own.
 */
export async function selectTheme(key: string): Promise<string> {
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase.rpc('select_theme', { p_key: key })
  if (error) throw new Error(error.message)
  return typeof data === 'string' ? data : key
}
