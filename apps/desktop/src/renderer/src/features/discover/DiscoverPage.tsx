import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BadgeCheck,
  Bookmark,
  Check,
  Copy,
  GitCompareArrows,
  LayoutGrid,
  Rows3,
  Search,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-react'
import { DISCOVERY_SORTS, type DiscoverySort, type SearchRow } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { navigate, useRoute } from '../../lib/router'
import { supabase } from '../../lib/supabase'
import { catalogName, difficultyEntry, useCatalogLanguage } from '../../lib/catalog-labels'
import {
  DISCOVER_PAGE_SIZE,
  fetchCatalogOptions,
  fetchFacets,
  fetchPublishedModes,
  isNotConfigured,
  searchStrategies,
  toggleFavorite
} from '../../lib/discovery-api'
import { useAuth, selectSignedIn, selectUserId } from '../../store/auth-store'
import { Badge, Banner, Button, Field, INPUT_CLASS, Row, cn } from '../../components/ui'
import { Chip, PageHeader, Section, Segmented } from '../../components/ui/system'
import { StateEmpty, StateError, StateLoading } from '../../components/ui/states'
import { RevealItem, RevealList } from '../../motion/primitives/Reveal'
import { StrategyCard } from './StrategyCard'
import { ComparePanel } from './ComparePanel'

type EventChoice = 'any' | 'only' | 'normal'
type ViewMode = 'grid' | 'list'

interface Filters {
  q: string
  mode: string | null
  map: string | null
  difficulty: string | null
  event: EventChoice
  tag: string | null
  sort: DiscoverySort
  favorites: boolean
  watch: boolean
  verified: boolean
}

const SORT_KEYS: Record<DiscoverySort, MessageKey> = {
  new: 'discover.sort.new',
  used: 'discover.sort.used',
  rating: 'discover.sort.rating',
  trending: 'discover.sort.trending'
}

const DIFFICULTY_OPTIONS: readonly string[] = ['easy', 'medium', 'hard', 'nightmare']
const VIEW_KEY = 'tds.discover.view'
const SAVED_KEY = 'tds.discover.saved'

/**
 * Filters live in the URL, not in component state: a filtered board is shareable, survives a reload
 * and answers to the back key. Everything else on this page reads that one source.
 */
function readFilters(query: URLSearchParams): Filters {
  const event = query.get('event')
  return {
    q: query.get('q') ?? '',
    mode: query.get('mode'),
    map: query.get('map'),
    difficulty: query.get('diff'),
    event: event === 'only' || event === 'normal' ? event : 'any',
    tag: query.get('tag'),
    sort: (DISCOVERY_SORTS as readonly string[]).includes(query.get('sort') ?? '') ? (query.get('sort') as DiscoverySort) : 'new',
    favorites: query.get('fav') === '1',
    watch: query.get('watch') === '1',
    verified: query.get('ver') === '1'
  }
}

function writeFilters(filters: Filters): URLSearchParams {
  const next = new URLSearchParams()
  if (filters.q.length > 0) next.set('q', filters.q)
  if (filters.mode) next.set('mode', filters.mode)
  if (filters.map) next.set('map', filters.map)
  if (filters.difficulty) next.set('diff', filters.difficulty)
  if (filters.event !== 'any') next.set('event', filters.event)
  if (filters.tag) next.set('tag', filters.tag)
  if (filters.sort !== 'new') next.set('sort', filters.sort)
  if (filters.favorites) next.set('fav', '1')
  if (filters.watch) next.set('watch', '1')
  if (filters.verified) next.set('ver', '1')
  return next
}

function rawMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface SavedSearch {
  id: string
  label: string
  query: string
}

function readSaved(): SavedSearch[] {
  try {
    const raw = window.localStorage.getItem(SAVED_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) return []
      const record = entry as Record<string, unknown>
      if (typeof record.id !== 'string' || typeof record.label !== 'string' || typeof record.query !== 'string') return []
      return [{ id: record.id, label: record.label, query: record.query }]
    })
  } catch {
    return []
  }
}

function FacetRow({
  label,
  count,
  active,
  onClick
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      data-press
      onClick={onClick}
      className={cn(
        'no-drag flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[12px] transition-colors',
        active ? 'bg-brand/15 text-ink' : 'text-mute hover:bg-panel-soft hover:text-ink'
      )}
    >
      <span className="truncate">{label}</span>
      <span className="hud-num shrink-0 text-[10px] text-mute/80">{String(count)}</span>
    </button>
  )
}

export function DiscoverPage(): ReactNode {
  const t = useT()
  const language = useCatalogLanguage()
  const signedIn = useAuth(selectSignedIn)
  const userId = useAuth(selectUserId)
  const queryClient = useQueryClient()
  const route = useRoute()
  const filters = useMemo(() => readFilters(route.query), [route.query])

  const [text, setText] = useState(filters.q)
  const [view, setView] = useState<ViewMode>(() => {
    try {
      return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
    } catch {
      return 'grid'
    }
  })
  const [selected, setSelected] = useState<SearchRow[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [saved, setSaved] = useState<SavedSearch[]>(readSaved)
  const [copied, setCopied] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setText((current) => (current === filters.q ? current : filters.q))
  }, [filters.q])

  const patch = useCallback(
    (next: Partial<Filters>) => {
      navigate('/discover', writeFilters({ ...filters, ...next }), { replace: true })
    },
    [filters]
  )

  useEffect(() => {
    const trimmed = text.trim().slice(0, 120)
    if (trimmed === filters.q) return
    const timer = window.setTimeout(() => patch({ q: trimmed }), 350)
    return () => window.clearTimeout(timer)
  }, [text, filters.q, patch])

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, view)
    } catch {
      // A blocked storage only means the preference is not remembered.
    }
  }, [view])

  // "/" jumps to the search unless the user is already typing somewhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      event.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const mapsQuery = useQuery({
    queryKey: ['catalog', 'maps'],
    queryFn: () => fetchCatalogOptions('maps'),
    enabled: supabase !== null,
    staleTime: 300_000,
    retry: false
  })
  const tagsQuery = useQuery({
    queryKey: ['catalog', 'tags'],
    queryFn: () => fetchCatalogOptions('tags'),
    enabled: supabase !== null,
    staleTime: 300_000,
    retry: false
  })
  const modesQuery = useQuery({
    queryKey: ['catalog', 'modes'],
    queryFn: fetchPublishedModes,
    enabled: supabase !== null,
    staleTime: 300_000,
    retry: false
  })

  const facetsQuery = useQuery({
    queryKey: ['discover', 'facets', filters.q, filters.mode, filters.map, filters.difficulty, filters.event, filters.tag, filters.verified],
    queryFn: () =>
      fetchFacets({
        q: filters.q,
        mode: filters.mode,
        map: filters.map,
        difficulty: filters.difficulty,
        event: filters.event === 'any' ? null : filters.event === 'only',
        tag: filters.tag,
        verifiedOnly: filters.verified
      }),
    enabled: supabase !== null,
    staleTime: 60_000,
    retry: false
  })
  const facets = facetsQuery.data ?? null

  const searchQuery = useInfiniteQuery({
    queryKey: ['discover', userId ?? 'anon', filters],
    queryFn: ({ pageParam }) =>
      searchStrategies({
        q: filters.q,
        mode: filters.mode,
        map: filters.map,
        difficulty: filters.difficulty,
        event: filters.event === 'any' ? null : filters.event === 'only',
        tag: filters.tag,
        sort: filters.sort,
        offset: pageParam,
        favoritesOnly: filters.favorites,
        watchOnly: filters.watch,
        verifiedOnly: filters.verified
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.length < DISCOVER_PAGE_SIZE ? undefined : DISCOVER_PAGE_SIZE * allPages.length),
    enabled: supabase !== null,
    retry: false
  })

  const favoriteMutation = useMutation({
    mutationFn: (strategyId: string) => toggleFavorite(strategyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['discover'] })
      void queryClient.invalidateQueries({ queryKey: ['strategy'] })
    }
  })

  const mapNames = useMemo(() => {
    const table = new Map<string, string>()
    for (const option of mapsQuery.data ?? []) table.set(option.key, catalogName(option, language) ?? option.key)
    return table
  }, [mapsQuery.data, language])

  const rows: SearchRow[] = useMemo(() => searchQuery.data?.pages.flat() ?? [], [searchQuery.data])
  const total = rows[0]?.rows_total ?? rows.length

  const activeChips: Array<{ key: string; label: string; clear: Partial<Filters> }> = []
  if (filters.q.length > 0) activeChips.push({ key: 'q', label: `"${filters.q}"`, clear: { q: '' } })
  if (filters.map) activeChips.push({ key: 'map', label: mapNames.get(filters.map) ?? filters.map, clear: { map: null } })
  if (filters.mode) activeChips.push({ key: 'mode', label: filters.mode, clear: { mode: null } })
  if (filters.difficulty) {
    const entry = difficultyEntry(filters.difficulty)
    activeChips.push({ key: 'diff', label: entry.labelKey ? t(entry.labelKey) : filters.difficulty, clear: { difficulty: null } })
  }
  if (filters.tag) {
    const tag = (tagsQuery.data ?? []).find((option) => option.key === filters.tag)
    activeChips.push({ key: 'tag', label: tag ? (catalogName(tag, language) ?? tag.key) : filters.tag, clear: { tag: null } })
  }
  if (filters.event !== 'any') {
    activeChips.push({
      key: 'event',
      label: filters.event === 'only' ? t('discover.eventOnly') : t('discover.eventNormal'),
      clear: { event: 'any' }
    })
  }
  if (filters.favorites) activeChips.push({ key: 'fav', label: t('discover.onlyFavorites'), clear: { favorites: false } })
  if (filters.watch) activeChips.push({ key: 'watch', label: t('discover.onlyWatch'), clear: { watch: false } })
  if (filters.verified) activeChips.push({ key: 'ver', label: t('discover.verifiedOnly'), clear: { verified: false } })

  const clearAll = (): void => {
    setText('')
    navigate('/discover', new URLSearchParams(), { replace: true })
  }

  const toggleCompare = (row: SearchRow): void => {
    setSelected((current) => {
      if (current.some((entry) => entry.id === row.id)) return current.filter((entry) => entry.id !== row.id)
      if (current.length >= 3) return current
      return [...current, row]
    })
  }

  const saveSearch = (): void => {
    const next: SavedSearch = {
      id: `${String(Date.now())}-${Math.random().toString(36).slice(2, 7)}`,
      label: activeChips.length > 0 ? activeChips.map((chip) => chip.label).join(' · ').slice(0, 60) : t('discover.allMaps'),
      query: route.query.toString()
    }
    const list = [next, ...saved].slice(0, 6)
    setSaved(list)
    try {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(list))
    } catch {
      // Not persisted; the in-memory list still works for this session.
    }
  }

  const removeSaved = (id: string): void => {
    const list = saved.filter((entry) => entry.id !== id)
    setSaved(list)
    try {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(list))
    } catch {
      // ignore
    }
  }

  // The app routes on its own hash, so that is the address another install can open. A tdsapp://
  // link would look shareable but nothing in main handles a discover deeplink yet.
  const copyLink = (): void => {
    const url = `#/discover${route.query.toString().length > 0 ? `?${route.query.toString()}` : ''}`
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    })
  }

  if (supabase === null) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('discover.title')} subtitle={t('discover.subtitle')} />
        <Banner tone="warn">{t('discover.notConfigured')}</Banner>
      </div>
    )
  }

  const mapFacets = facets?.maps ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('discover.title')}
        subtitle={t('discover.subtitle')}
        badges={
          <>
            {!searchQuery.isPending ? <Chip tone="brand">{`${String(total)} ${t('discover.results')}`}</Chip> : null}
            {activeChips.map((chip) => (
              <Chip key={chip.key} tone="neutral" className="gap-1">
                {chip.label}
                <button
                  type="button"
                  aria-label={t('common.close')}
                  onClick={() => patch(chip.clear)}
                  className="no-drag grid size-3.5 place-items-center rounded text-mute hover:text-danger"
                >
                  <X size={9} />
                </button>
              </Chip>
            ))}
          </>
        }
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={copyLink}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? t('discover.linkCopied') : t('discover.copyLink')}
            </Button>
            <div className="inline-flex rounded-lg border border-line bg-panel-soft p-0.5">
              <button
                type="button"
                aria-label={t('discover.viewGrid')}
                onClick={() => setView('grid')}
                className={cn('no-drag grid size-7 place-items-center rounded-md transition-colors', view === 'grid' ? 'bg-brand/20 text-ink' : 'text-mute hover:text-ink')}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                type="button"
                aria-label={t('discover.viewList')}
                onClick={() => setView('list')}
                className={cn('no-drag grid size-7 place-items-center rounded-md transition-colors', view === 'list' ? 'bg-brand/20 text-ink' : 'text-mute hover:text-ink')}
              >
                <Rows3 size={14} />
              </button>
            </div>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[286px_minmax(0,1fr)]">
        <aside className="space-y-3 self-start xl:sticky xl:top-4">
          <Section title={t('discover.facets')} hint={t('discover.facetsHint')}>
            <div className="space-y-3">
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
                <input
                  ref={searchRef}
                  className={cn(INPUT_CLASS, 'no-drag h-8 py-1 pl-7 pr-7 text-xs')}
                  placeholder={t('discover.searchPlaceholder')}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
                {text.length > 0 ? (
                  <button
                    type="button"
                    aria-label={t('discover.clearFilters')}
                    onClick={() => setText('')}
                    className="no-drag absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-mute hover:text-ink"
                  >
                    <X size={11} />
                  </button>
                ) : null}
              </div>

              <div>
                <p className="hud-label mb-1">{t('discover.map')}</p>
                {mapsQuery.isPending ? (
                  <p className="text-[11px] text-mute">{t('common.loading')}</p>
                ) : (
                  <div className="space-y-0.5">
                    <FacetRow
                      label={t('discover.allMaps')}
                      count={facets?.total ?? total}
                      active={filters.map === null}
                      onClick={() => patch({ map: null })}
                    />
                    {mapFacets.length > 0
                      ? mapFacets.map((bucket) => (
                          <FacetRow
                            key={bucket.key}
                            label={mapNames.get(bucket.key) ?? bucket.key}
                            count={bucket.count}
                            active={filters.map === bucket.key}
                            onClick={() => patch({ map: filters.map === bucket.key ? null : bucket.key })}
                          />
                        ))
                      : (mapsQuery.data ?? []).map((option) => (
                          <FacetRow
                            key={option.key}
                            label={catalogName(option, language) ?? option.key}
                            count={0}
                            active={filters.map === option.key}
                            onClick={() => patch({ map: filters.map === option.key ? null : option.key })}
                          />
                        ))}
                  </div>
                )}
              </div>

              <div>
                <p className="hud-label mb-1">{t('discover.difficulty')}</p>
                <Segmented
                  size="sm"
                  value={filters.difficulty ?? 'any'}
                  onChange={(value) => patch({ difficulty: value === 'any' ? null : value })}
                  options={[
                    { value: 'any', label: t('common.none') },
                    ...DIFFICULTY_OPTIONS.map((value) => {
                      const entry = difficultyEntry(value)
                      return {
                        value,
                        label: entry.labelKey ? t(entry.labelKey) : value,
                        count: facets?.difficulties.find((bucket) => bucket.key === value)?.count
                      }
                    })
                  ]}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label={t('discover.mode')}>
                  <select
                    className={cn(INPUT_CLASS, 'no-drag h-8 py-1 text-xs')}
                    value={filters.mode ?? ''}
                    onChange={(event) => patch({ mode: event.target.value.length > 0 ? event.target.value : null })}
                  >
                    <option value="">{t('common.none')}</option>
                    {(modesQuery.data ?? []).map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('discover.tag')}>
                  <select
                    className={cn(INPUT_CLASS, 'no-drag h-8 py-1 text-xs')}
                    value={filters.tag ?? ''}
                    onChange={(event) => patch({ tag: event.target.value.length > 0 ? event.target.value : null })}
                  >
                    <option value="">{t('common.none')}</option>
                    {(tagsQuery.data ?? []).map((option) => (
                      <option key={option.key} value={option.key}>
                        {catalogName(option, language) ?? option.key}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div>
                <p className="hud-label mb-1">{t('discover.eventFilter')}</p>
                <Segmented
                  size="sm"
                  value={filters.event}
                  onChange={(value) => patch({ event: value })}
                  options={[
                    { value: 'any', label: t('discover.eventAny') },
                    { value: 'only', label: t('discover.eventOnly') },
                    { value: 'normal', label: t('discover.eventNormal') }
                  ]}
                />
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                <Button size="sm" variant={filters.favorites ? 'primary' : 'ghost'} disabled={!signedIn} onClick={() => patch({ favorites: !filters.favorites })}>
                  <Bookmark size={13} />
                  {t('discover.onlyFavorites')}
                </Button>
                <Button size="sm" variant={filters.watch ? 'primary' : 'ghost'} disabled={!signedIn} onClick={() => patch({ watch: !filters.watch })}>
                  <SlidersHorizontal size={13} />
                  {t('discover.onlyWatch')}
                </Button>
                {/* Server-side, because verified authors are ranked above everyone else in the same query. */}
                <Button size="sm" variant={filters.verified ? 'primary' : 'ghost'} onClick={() => patch({ verified: !filters.verified })}>
                  <BadgeCheck size={13} />
                  {/* The count comes from the facet query and counts corporate authors too, so the
                      number on the button is the population the button would produce (0040). */}
                  {filters.verified || facets === null || facets.verified <= 0
                    ? t('discover.verifiedOnly')
                    : t('discover.verifiedWithCount', { count: String(facets.verified) })}
                </Button>
              </div>

              {activeChips.length > 0 ? (
                <Button size="sm" variant="subtle" onClick={clearAll}>
                  {t('discover.clearFilters')}
                </Button>
              ) : null}

              {mapsQuery.isError || tagsQuery.isError || modesQuery.isError ? (
                <Banner tone="warn" title={t('common.errorTitle')}>
                  {rawMessage(mapsQuery.error ?? tagsQuery.error ?? modesQuery.error)}
                </Banner>
              ) : null}
            </div>
          </Section>

          <Section
            title={t('discover.savedTitle')}
            hint={t('discover.savedLocal')}
            aside={
              <Button size="sm" variant="ghost" onClick={saveSearch}>
                {t('discover.save')}
              </Button>
            }
          >
            {saved.length === 0 ? (
              <p className="text-[11px] leading-relaxed text-mute">{t('discover.savedEmpty')}</p>
            ) : (
              <ul className="space-y-1">
                {saved.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setText('')
                        navigate('/discover', new URLSearchParams(entry.query), { replace: true })
                      }}
                      className="no-drag min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-[11px] text-mute hover:bg-panel-soft hover:text-ink"
                    >
                      {entry.label}
                    </button>
                    <button
                      type="button"
                      aria-label={t('discover.remove')}
                      onClick={() => removeSaved(entry.id)}
                      className="no-drag grid size-6 shrink-0 place-items-center rounded text-mute hover:text-danger"
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </aside>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented
              size="sm"
              value={filters.sort}
              onChange={(value) => patch({ sort: value })}
              options={DISCOVERY_SORTS.map((value) => ({ value, label: t(SORT_KEYS[value]) }))}
            />
            {searchQuery.isFetching ? <Badge tone="neutral">{t('common.loading')}</Badge> : null}
          </div>

          {favoriteMutation.isError ? <StateError detail={rawMessage(favoriteMutation.error)} /> : null}

          {searchQuery.isPending ? <StateLoading variant="cards" count={4} /> : null}

          {searchQuery.isError ? (
            <StateError
              detail={isNotConfigured(searchQuery.error) ? t('discover.notConfigured') : rawMessage(searchQuery.error)}
              onRetry={() => void searchQuery.refetch()}
              busy={searchQuery.isFetching}
            />
          ) : null}

          {!searchQuery.isPending && !searchQuery.isError && rows.length === 0 ? (
            <StateEmpty
              icon={Search}
              title={t('discover.empty')}
              action={
                activeChips.length > 0 ? (
                  <Button size="sm" onClick={clearAll}>
                    {t('discover.clearFilters')}
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => navigate('/import')}>
                    {t('home.cta')}
                  </Button>
                )
              }
            />
          ) : null}

          {rows.length > 0 ? (
            view === 'list' ? (
              <RevealList className="space-y-2" count={Math.min(rows.length, 8)}>
                {rows.map((row) => (
                  <RevealItem key={row.id}>
                    <StrategyCard
                      row={row}
                      layout="list"
                      mapName={row.map_key ? mapNames.get(row.map_key) ?? null : null}
                      signedIn={signedIn}
                      favoriteBusy={favoriteMutation.isPending && favoriteMutation.variables === row.id}
                      selected={selected.some((entry) => entry.id === row.id)}
                      compareDisabled={selected.length >= 3}
                      onToggleCompare={toggleCompare}
                      onOpen={(value) => navigate(`/strategy/${value.id}`)}
                      onToggleFavorite={(value) => favoriteMutation.mutate(value.id)}
                    />
                  </RevealItem>
                ))}
              </RevealList>
            ) : (
              <RevealList className="grid gap-2.5 sm:grid-cols-2" count={Math.min(rows.length, 8)}>
                {rows.map((row) => (
                  <RevealItem key={row.id} className="h-full">
                    <StrategyCard
                      row={row}
                      mapName={row.map_key ? mapNames.get(row.map_key) ?? null : null}
                      signedIn={signedIn}
                      favoriteBusy={favoriteMutation.isPending && favoriteMutation.variables === row.id}
                      selected={selected.some((entry) => entry.id === row.id)}
                      compareDisabled={selected.length >= 3}
                      onToggleCompare={toggleCompare}
                      onOpen={(value) => navigate(`/strategy/${value.id}`)}
                      onToggleFavorite={(value) => favoriteMutation.mutate(value.id)}
                    />
                  </RevealItem>
                ))}
              </RevealList>
            )
          ) : null}

          {searchQuery.isFetchingNextPage ? <StateLoading variant="cards" count={2} /> : null}

          {searchQuery.hasNextPage ? (
            <Row>
              <Button busy={searchQuery.isFetchingNextPage} onClick={() => void searchQuery.fetchNextPage()}>
                {t('discover.loadMore')}
              </Button>
              <span className="hud-label">{`${String(rows.length)} / ${String(total)}`}</span>
            </Row>
          ) : null}
        </div>
      </div>

      {selected.length > 0 ? (
        <div className="sticky bottom-3 z-20 mx-auto flex w-fit max-w-full items-center gap-2 rounded-xl border border-brand/40 bg-panel/95 px-3 py-2 shadow-[0_20px_50px_-24px_rgb(0_0_0/0.9)] backdrop-blur-xl">
          <span className="hud-label flex items-center gap-1.5 text-brand">
            <GitCompareArrows size={12} />
            {t('discover.compareTitle')}
          </span>
          <div className="flex max-w-[44ch] items-center gap-1 overflow-hidden">
            {selected.map((row) => (
              <Chip key={row.id} tone="neutral" className="max-w-36 truncate">
                {row.name}
              </Chip>
            ))}
          </div>
          <Button size="sm" variant="primary" disabled={selected.length < 2} onClick={() => setCompareOpen(true)}>
            {t('discover.compareOpen')}
          </Button>
          <Button size="sm" variant="subtle" onClick={() => setSelected([])}>
            {t('discover.compareClear')}
          </Button>
        </div>
      ) : null}

      {compareOpen && selected.length >= 2 ? (
        <ComparePanel
          rows={selected}
          mapNames={mapNames}
          onRemove={(id) => setSelected((current) => current.filter((entry) => entry.id !== id))}
          onClose={() => setCompareOpen(false)}
        />
      ) : null}
    </div>
  )
}
