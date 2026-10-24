import {
  buyBoostResultSchema,
  walletSummarySchema,
  type BuyBoostResult,
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
