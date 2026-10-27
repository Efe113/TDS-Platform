import {
  discoverFacetsSchema,
  discoverFiltersSchema,
  searchRowSchema,
  strategyDetailSchema,
  strategyIrSchema,
  type DiscoverFacets,
  type DiscoverySort,
  type SearchRow,
  type StrategyDetail,
  type StrategyIr
} from '@tds/shared'
import { supabase } from './supabase'

/** One page of results; the RPC clamps to 1..60, the schema mirrors that. */
export const DISCOVER_PAGE_SIZE = 24

/** Distinct error type so the pages can show the honest "not configured" copy instead of a raw failure. */
export class NotConfiguredError extends Error {
  constructor() {
    super('SUPABASE_NOT_CONFIGURED')
    this.name = 'NotConfiguredError'
  }
}

export function isNotConfigured(error: unknown): boolean {
  return error instanceof NotConfiguredError
}

function requireDb(): NonNullable<typeof supabase> {
  if (!supabase) throw new NotConfiguredError()
  return supabase
}

export interface CatalogOption {
  key: string
  name_tr: string
  name_en: string
}

export interface DiscoverFiltersInput {
  q: string
  mode: string | null
  map: string | null
  difficulty: string | null
  event: boolean | null
  tag: string | null
  sort: DiscoverySort
  offset: number
  favoritesOnly?: boolean
  watchOnly?: boolean
  verifiedOnly?: boolean
}

function toOptions(data: unknown): CatalogOption[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return []
    const record = row as Record<string, unknown>
    if (typeof record.key !== 'string') return []
    return [{ key: record.key, name_tr: String(record.name_tr ?? record.key), name_en: String(record.name_en ?? record.key) }]
  })
}

/** Server-side search: it already hides non-published rows and resolves pin + favorite flags. */
export async function searchStrategies(input: DiscoverFiltersInput): Promise<SearchRow[]> {
  const db = requireDb()
  const filters = discoverFiltersSchema.parse({
    q: input.q,
    mode: input.mode,
    map: input.map,
    difficulty: input.difficulty,
    event: input.event,
    tag: input.tag,
    sort: input.sort,
    limit: DISCOVER_PAGE_SIZE,
    offset: input.offset,
    favoritesOnly: input.favoritesOnly ?? false,
    watchOnly: input.watchOnly ?? false,
    verifiedOnly: input.verifiedOnly ?? false
  })

  // The parameter is only sent when the filter is on: an un-migrated database still exposes the old
  // eleven-argument function, and an unknown named parameter would fail the whole search.
  const args: Record<string, unknown> = {
    p_query: filters.q.length > 0 ? filters.q : null,
    p_mode: filters.mode,
    p_map: filters.map,
    p_difficulty: filters.difficulty,
    p_event: filters.event,
    p_tag: filters.tag,
    p_sort: filters.sort,
    p_limit: filters.limit,
    p_offset: filters.offset,
    p_favorites_only: filters.favoritesOnly,
    p_watch_only: filters.watchOnly
  }
  if (filters.verifiedOnly) args.p_verified_only = true

  const { data, error } = await db.rpc('search_strategies', args)
  if (error) throw new Error(error.message)
  return searchRowSchema.array().parse(data ?? [])
}

/** Facet counters for the current predicate set, so a filter can show what it would leave. */
export async function fetchFacets(input: Omit<DiscoverFiltersInput, 'offset' | 'sort'>): Promise<DiscoverFacets> {
  const db = requireDb()
  const args: Record<string, unknown> = {
    p_query: input.q.length > 0 ? input.q : null,
    p_mode: input.mode,
    p_map: input.map,
    p_difficulty: input.difficulty,
    p_event: input.event,
    p_tag: input.tag
  }
  if (input.verifiedOnly) args.p_verified_only = true
  const { data, error } = await db.rpc('discover_facets', args)
  if (error) throw new Error(error.message)
  return discoverFacetsSchema.parse(data ?? {})
}

/** Filter dropdown catalogs. Both catalogs are public reads under RLS. */
export async function fetchCatalogOptions(table: 'maps' | 'tags'): Promise<CatalogOption[]> {
  const db = requireDb()
  const { data, error } = await db.from(table).select('key,name_tr,name_en').order('name_tr')
  if (error) throw new Error(error.message)
  return toOptions(data)
}

/** There is no mode catalog table, so the live values are read from published strategies. */
export async function fetchPublishedModes(): Promise<string[]> {
  const db = requireDb()
  const { data, error } = await db.from('strategies').select('game_mode').neq('game_mode', 'unknown')
  if (error) throw new Error(error.message)
  if (!Array.isArray(data)) return []
  const modes = new Set<string>()
  for (const row of data as Array<Record<string, unknown>>) {
    if (typeof row.game_mode === 'string' && row.game_mode.length > 0) modes.add(row.game_mode)
  }
  return [...modes].sort()
}

/** `toggle_favorite` answers true when the row became a favorite, false when it was removed. */
export async function toggleFavorite(strategyId: string): Promise<boolean> {
  const db = requireDb()
  const { data, error } = await db.rpc('toggle_favorite', { p_strategy_id: strategyId })
  if (error) throw new Error(error.message)
  return data === true
}

/** Own favorite flag: RLS only ever returns the caller's rows, so a hit means "favorited by me". */
export async function readFavorite(strategyId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false
  const db = requireDb()
  const { data, error } = await db
    .from('favorites')
    .select('strategy_id')
    .eq('user_id', userId)
    .eq('strategy_id', strategyId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data !== null
}

const DETAIL_SELECT = `*, maps(key, name_en, name_tr, image_path, is_event),
  profiles!owner_id(id, handle, display_name),
  strategy_versions!strategy_id(id, version_no, published_at,
    strategy_steps(id, step_no, wave_from, wave_to, phase, action, tower_key, level, count, spec, note, raw_text, unresolved),
    strategy_inventory(tower_key, slot, alternatives, notes, towers(key, name_en, name_tr, icon_path)),
    strategy_modifiers(mutator_key, note, matched_by),
    strategy_requirements(kind, value, detail),
    strategy_wave_skip_rules(kind, waves, condition, raw_text),
    strategy_troubleshooting(waves, reasons),
    strategy_proofs(label, setup, best_time_sec, coins_per_hour, xp_per_hour),
    strategy_hof(comp, best_time_sec, notes),
    strategy_media(kind, storage_path, width, height))`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * `strategy_troubleshooting.reasons` is a jsonb array; a stray null/object would otherwise fail
 * the string-array schema and blank the whole detail page. `spec` unwrapping lives in the shared
 * schema now, so only this defensive pass remains here.
 */
export function normalizeStrategyPayload(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const versions = raw.strategy_versions
  if (!Array.isArray(versions)) return raw

  const nextVersions = versions.map((entry) => {
    if (!isRecord(entry)) return entry
    const troubleshooting = Array.isArray(entry.strategy_troubleshooting)
      ? entry.strategy_troubleshooting.map((item) => {
          if (!isRecord(item) || !Array.isArray(item.reasons)) return item
          return { ...item, reasons: item.reasons.filter((reason): reason is string => typeof reason === 'string') }
        })
      : entry.strategy_troubleshooting
    return { ...entry, strategy_troubleshooting: troubleshooting }
  })

  return { ...raw, strategy_versions: nextVersions }
}

/** One round trip for strategy + live version children; the version list also holds history rows. */
export async function fetchStrategyDetail(id: string): Promise<StrategyDetail> {
  const db = requireDb()
  const { data, error } = await db.from('strategies').select(DETAIL_SELECT).eq('id', id).single()
  if (error) throw new Error(error.message)
  return strategyDetailSchema.parse(normalizeStrategyPayload(data))
}

/**
 * The IR the author published, read from `strategy_versions.content` (0013 keeps it whole). The typed
 * child tables cannot carry a step's duration, repetition or branch, so this is the only faithful copy
 * of those — and of the document as the author wrote it, which is what an export should be.
 */
export async function fetchVersionIr(versionId: string): Promise<StrategyIr | null> {
  const db = requireDb()
  const { data, error } = await db.from('strategy_versions').select('content').eq('id', versionId).maybeSingle()
  if (error) throw new Error(error.message)
  const parsed = strategyIrSchema.safeParse(data?.content ?? null)
  return parsed.success ? parsed.data : null
}
