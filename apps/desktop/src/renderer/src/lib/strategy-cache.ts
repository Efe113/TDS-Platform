import { IPC_CHANNELS, strategyCacheRowSchema, type OverlayState, type StrategyCacheRow } from '@tds/shared'
import { call } from './ipc'

/**
 * The offline shelf (0.3.8). Main keeps a copy of every document that was tracked, because the overlay
 * is the surface a member needs most when the network is gone — and only main survives a restart with
 * the run still in it.
 */

export async function fetchCachedStrategies(): Promise<StrategyCacheRow[]> {
  const rows = await call<unknown>(IPC_CHANNELS.strategyCacheList)
  return strategyCacheRowSchema.array().parse(rows)
}

/** Puts a cached document back on the rail and in the overlay, without touching the database. */
export function loadCachedStrategy(key: string): Promise<OverlayState | null> {
  return call<OverlayState | null>(IPC_CHANNELS.strategyCacheLoad, { key })
}

export async function clearStrategyCache(): Promise<number> {
  const { removed } = await call<{ removed: number }>(IPC_CHANNELS.strategyCacheClear)
  return removed
}
