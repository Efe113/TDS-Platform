import { z } from 'zod'

export const DISCOVERY_SORTS = ['new', 'used', 'rating', 'trending'] as const
export type DiscoverySort = (typeof DISCOVERY_SORTS)[number]

export const discoverFiltersSchema = z.object({
  q: z.string().trim().max(120).default(''),
  mode: z.string().nullable().default(null),
  map: z.string().nullable().default(null),
  difficulty: z.string().nullable().default(null),
  event: z.boolean().nullable().default(null),
  tag: z.string().nullable().default(null),
  sort: z.enum(DISCOVERY_SORTS).default('new'),
  limit: z.number().int().min(1).max(60).default(24),
  offset: z.number().int().min(0).default(0),
  /** Server-side so the count, the paging and the facets all agree with the filter. */
  favoritesOnly: z.boolean().default(false),
  watchOnly: z.boolean().default(false),
  // 0037: verified authors sort above ordinary strategies, so the filter has to be server-side too.
  verifiedOnly: z.boolean().default(false),
  // 0054: how people actually choose a run — who it is for, which waves it covers, whether it is played.
  playerCount: z.string().nullable().default(null),
  waveFrom: z.number().int().nonnegative().nullable().default(null),
  waveTo: z.number().int().nonnegative().nullable().default(null),
  minUses: z.number().int().nonnegative().nullable().default(null)
})

export type DiscoverFilters = z.input<typeof discoverFiltersSchema>

/** Row shape of public.search_strategies — snake_case, exactly as PostgREST returns it. */
export const searchRowSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  subtitle: z.string().nullable(),
  difficulty: z.string(),
  game_mode: z.string(),
  player_count: z.string(),
  map_key: z.string().nullable(),
  is_event_strategy: z.boolean(),
  event_key: z.string().nullable(),
  wave_from: z.number().int().nullable(),
  wave_to: z.number().int().nullable(),
  times_used: z.number().int(),
  rating_avg: z.coerce.number().nullable(),
  rating_count: z.number().int(),
  credit_creator: z.string().nullable(),
  owner_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  is_pinned: z.boolean(),
  is_favorited: z.boolean(),
  // 0023 additions. Optional so a build talking to a database that has not been migrated yet still
  // parses the rows it can get, instead of blanking the whole board.
  is_watched: z.boolean().optional().default(false),
  trend_7d: z.coerce.number().int().nonnegative().optional().default(0),
  rows_total: z.coerce.number().int().nonnegative().optional().default(0),
  // 0037: the author carries the verified tier, so every one of their strategies gets the mark.
  author_verified: z.boolean().optional().default(false),
  // 0040: corporate authors are also verified; the extra flag only decides the colour of the tick and
  // the rank order, so an un-migrated database still renders.
  author_corporate: z.boolean().optional().default(false)
})

export type SearchRow = z.infer<typeof searchRowSchema>

export const mapSummarySchema = z.object({
  key: z.string(),
  name_en: z.string(),
  name_tr: z.string(),
  image_path: z.string().nullable(),
  is_event: z.boolean()
})

/**
 * `strategy_steps.spec` is jsonb: `{"alternatives":[…],"spec":"3 Rifleman"}` (0013 writes both halves,
 * 0038's editor keeps them there). The pre-0013 shape was a bare string, so both are accepted and the
 * alternatives the author published are handed back instead of dropped — they were read into nothing at
 * all for two releases.
 */
export const stepSpecSchema = z.object({
  spec: z.string().nullable(),
  alternatives: z.array(z.string()).default([])
})

export type StepSpecColumn = z.infer<typeof stepSpecSchema>

const specColumnSchema = z.preprocess((value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const inner = record.spec
    const alternatives = Array.isArray(record.alternatives)
      ? record.alternatives.filter((item): item is string => typeof item === 'string')
      : []
    return { spec: typeof inner === 'string' && inner.length > 0 ? inner : null, alternatives }
  }
  return { spec: typeof value === 'string' && value.length > 0 ? value : null, alternatives: [] }
}, stepSpecSchema)

export const stepRowSchema = z.object({
  id: z.string().uuid(),
  step_no: z.number().int(),
  wave_from: z.number().int().nullable(),
  wave_to: z.number().int().nullable(),
  phase: z.string().nullable(),
  action: z.string(),
  tower_key: z.string().nullable(),
  level: z.number().int().nullable(),
  count: z.number().int().nullable(),
  spec: specColumnSchema,
  note: z.string().nullable(),
  raw_text: z.string(),
  unresolved: z.boolean()
})

export const inventoryRowSchema = z.object({
  tower_key: z.string(),
  slot: z.number().int(),
  alternatives: z.array(z.string()).default([]),
  notes: z.string().nullable(),
  towers: z.object({ key: z.string(), name_en: z.string(), name_tr: z.string(), icon_path: z.string().nullable() }).nullable()
})

export const versionDetailSchema = z.object({
  id: z.string().uuid(),
  version_no: z.number().int(),
  published_at: z.string().nullable(),
  strategy_steps: z.array(stepRowSchema).default([]),
  strategy_inventory: z.array(inventoryRowSchema).default([]),
  strategy_modifiers: z
    .array(z.object({ mutator_key: z.string().nullable(), note: z.string().nullable(), matched_by: z.string() }))
    .default([]),
  strategy_requirements: z
    .array(z.object({ kind: z.string(), value: z.string(), detail: z.string().nullable() }))
    .default([]),
  strategy_wave_skip_rules: z
    .array(z.object({ kind: z.string(), waves: z.string().nullable(), condition: z.string().nullable(), raw_text: z.string().nullable() }))
    .default([]),
  strategy_troubleshooting: z
    .array(z.object({ waves: z.string(), reasons: z.array(z.string()).default([]) }))
    .default([]),
  strategy_proofs: z
    .array(
      z.object({
        label: z.string(),
        setup: z.array(z.string()).default([]),
        best_time_sec: z.number().int().nullable(),
        coins_per_hour: z.string().nullable(),
        xp_per_hour: z.string().nullable()
      })
    )
    .default([]),
  strategy_hof: z
    .array(z.object({ comp: z.array(z.string()).default([]), best_time_sec: z.number().int().nullable(), notes: z.string().nullable() }))
    .default([]),
  strategy_media: z
    .array(z.object({ kind: z.string(), storage_path: z.string(), width: z.number().int().nullable(), height: z.number().int().nullable() }))
    .default([])
})

export const strategyDetailSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  subtitle: z.string().nullable(),
  description: z.string().nullable(),
  difficulty: z.string(),
  game_mode: z.string(),
  player_count: z.string(),
  map_key: z.string().nullable(),
  is_event_strategy: z.boolean(),
  event_key: z.string().nullable(),
  wave_from: z.number().int().nullable(),
  wave_to: z.number().int().nullable(),
  duration_min: z.number().int().nullable(),
  credit_url: z.string().nullable(),
  credit_creator: z.string().nullable(),
  credit_contributors: z.array(z.string()).default([]),
  is_author_own: z.boolean().default(false),
  status: z.string(),
  current_version_id: z.string().uuid().nullable(),
  times_used: z.number().int(),
  rating_avg: z.coerce.number().nullable(),
  rating_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  maps: mapSummarySchema.nullable(),
  profiles: z
    .object({
      id: z.string().uuid(),
      handle: z.string(),
      display_name: z.string().nullable()
    })
    .nullable(),
  strategy_versions: z.array(versionDetailSchema).default([])
})

export type StrategyDetail = z.infer<typeof strategyDetailSchema>
export type VersionDetail = z.infer<typeof versionDetailSchema>

/** The live version only: history exists in the table but the detail page shows current. */
export function selectCurrentVersion(detail: StrategyDetail): VersionDetail | undefined {
  return detail.strategy_versions.find((version) => version.id === detail.current_version_id)
}

export function formatWaveRange(from: number | null, to: number | null): string | undefined {
  if (from === null || from === undefined) return undefined
  if (to === null || to === undefined || to === from) return `Wave ${from}`
  return `Wave ${from}-${to}`
}

export function formatBestTime(seconds: number | null): string | undefined {
  if (!seconds || seconds < 0) return undefined
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * One public bucket, `strategy-media`, with prefixes: `maps/<key>.webp`,
 * `towers/<key>.webp`, `strategies/<version>/<kind>.webp`. Stored paths are prefix-relative,
 * so this helper is the only place the bucket name exists.
 */
export function storageUrl(base: string, path: string | null | undefined): string | null {
  if (!path) return null
  if (/^https?:/i.test(path)) return path
  return `${base.replace(/\/$/, '')}/storage/v1/object/public/strategy-media/${path.replace(/^\/$/, '')}`
}
