import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bookmark,
  BadgeCheck,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Flame,
  GitCommitHorizontal,
  Maximize2,
  Play,
  Radio,
  RotateCcw,
  Star,
  TriangleAlert,
  X
} from 'lucide-react'
import { motion } from 'framer-motion'
import {
  IPC_CHANNELS,
  formatBestTime,
  formatWaveRange,
  selectCurrentVersion,
  storageUrl,
  strategyIrSchema,
  type OverlayState,
  type StrategyDetail,
  type VersionDetail
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { navigate, routeSegments, useRoutePath } from '../../lib/router'
import { call } from '../../lib/ipc'
import { claimVerifiedBoost, fetchAuthorFlag } from '../../lib/account-api'
import { VerifiedBadge } from '../../components/brand/verified-badge'
import { ProfileHoverCard } from '../../components/profile/profile-card'
import { supabase } from '../../lib/supabase'
import { SUPABASE_BASE_URL } from '../../lib/storage-base'
import {
  catalogName,
  difficultyEntry,
  playerCountKey,
  requirementKey,
  useCatalogLanguage,
  waveSkipKey,
  type CatalogLanguage
} from '../../lib/catalog-labels'
import { fetchStrategyDetail, isNotConfigured, readFavorite, toggleFavorite } from '../../lib/discovery-api'
import { useTowerNamesTr } from '../../lib/tower-names'
import { useTick } from '../../lib/use-tick'
import { buyBoost, fetchWallet, newPurchaseKey } from '../../lib/wallet-api'
import { formatCoin, spendErrorKey } from '@tds/shared'
import { CoinAmount } from '../../components/brand/coin'
import { humanTowerLabel } from '../../lib/text'
import { selectSignedIn, selectUserId, useAuth } from '../../store/auth-store'
import { useAppStore } from '../../store/app-store'
import { Badge, Banner, Button, Card, EmptyState, INPUT_CLASS, KeyValue, Row, cn } from '../../components/ui'
import { Chip, PageHeader, Section } from '../../components/ui/system'
import { Menu, MenuContent, MenuFooter, MenuItem, MenuSection, MenuTrigger } from '../../components/ui/menu'
import { Reveal } from '../../motion/primitives/Reveal'
import { relativeTime } from '../../lib/text'
import { SkeletonCard } from '../../motion/primitives/Shimmer'
import { StateError, StateLoading, StateNotice } from '../../components/ui/states'
import { StepList } from '../import/StepList'
import { DiscussionSection } from './DiscussionSection'
import { JourneyPanel, StatsPanel, WatchButton } from './IntelligencePanel'
import { fetchStepHealth, fetchStepMarks, rateStep, setStepMark } from '../../lib/intelligence-api'
import { useOverlayControls } from '../shell/use-overlay'
import { buildIrInput, describeIrIssues, toIrSteps } from './build-ir'

/** Carries the readable issue paths of a failed IR build so the banner can list them. */
class IrValidationError extends Error {
  readonly lines: string[]

  constructor(lines: string[]) {
    super('IR_VALIDATION_FAILED')
    this.name = 'IrValidationError'
    this.lines = lines
  }
}

/** The IR caps inventory at five towers; the DB trigger enforces the same product rule. */
const INVENTORY_CAP = 5

function rawMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isPublished(detail: StrategyDetail): boolean {
  return detail.status === 'approved' || detail.status === 'featured'
}

interface SectionProps {
  version: VersionDetail
}

interface InventorySectionProps extends SectionProps {
  language: CatalogLanguage
}

interface MapSectionProps {
  detail: StrategyDetail
  version: VersionDetail | undefined
  language: CatalogLanguage
}

function InventorySection({ version, language }: InventorySectionProps): ReactNode {
  const t = useT()
  const [query, setQuery] = useState('')
  const all = useMemo(() => [...version.strategy_inventory].sort((a, b) => a.slot - b.slot), [version])
  const needle = query.trim().toLocaleLowerCase()
  const nameOf = (row: (typeof all)[number]): string => catalogName(row.towers, language) ?? humanTowerLabel(row.tower_key) ?? row.tower_key
  const matched = needle.length === 0 ? all : all.filter((row) => nameOf(row).toLocaleLowerCase().includes(needle))
  const rows = matched.slice(0, INVENTORY_CAP)

  return (
    <Card title={t('detail.inventory')}>
      {all.length > 6 ? (
        <input
          className={cn(INPUT_CLASS, 'no-drag mb-2 py-1.5 text-xs')}
          placeholder={t('detail.stepFilter')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title={needle.length > 0 ? t('discover.empty') : t('import.inventory.empty')} />
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) => {
            const name = nameOf(row)
            return (
              <li key={`${row.tower_key}-${String(index)}`} className="rounded-lg border border-line bg-panel-soft px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-mute">{`${String(index + 1)}.`}</span>
                  <span>{name}</span>
                  {row.towers === null ? <Badge tone="warn">{t('import.field.unresolved')}</Badge> : null}
                  {row.notes ? <span className="text-xs text-mute">{row.notes}</span> : null}
                </div>
                {row.alternatives.length > 0 ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-mute">{t('detail.alternatives')}</span>
                    {row.alternatives.map((alternative) => (
                      <Badge key={alternative} tone="neutral">
                        {humanTowerLabel(alternative) ?? alternative}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function ModifiersSection({ version }: SectionProps): ReactNode {
  const t = useT()
  return (
    <Card title={t('detail.modifiers')}>
      {version.strategy_modifiers.length === 0 ? (
        <EmptyState title={t('import.modifiers.empty')} />
      ) : (
        <ul className="flex flex-wrap gap-2">
          {version.strategy_modifiers.map((row, index) => (
            <li key={`${row.mutator_key ?? 'mutator'}-${String(index)}`}>
              <Badge tone={row.matched_by === 'none' ? 'warn' : 'good'}>
                {row.note ?? row.mutator_key ?? t('common.none')}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function RequirementsSection({ version }: SectionProps): ReactNode {
  const t = useT()
  return (
    <Card title={t('detail.requirements')}>
      {version.strategy_requirements.length === 0 ? (
        <EmptyState title={t('import.requirements.empty')} />
      ) : (
        <ul className="space-y-2 text-sm">
          {version.strategy_requirements.map((row, index) => {
            const labelKey = requirementKey(row.kind)
            return (
              <li key={`${row.kind}-${String(index)}`} className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{labelKey ? t(labelKey) : row.kind}</Badge>
                <span>{row.value}</span>
                {row.detail ? <span className="text-xs text-mute">{row.detail}</span> : null}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function WaveSkipSection({ version }: SectionProps): ReactNode {
  const t = useT()
  return (
    <Card title={t('detail.waveSkip')}>
      {version.strategy_wave_skip_rules.length === 0 ? (
        <EmptyState title={t('import.waveSkip.empty')} />
      ) : (
        <ul className="space-y-2">
          {version.strategy_wave_skip_rules.map((row, index) => {
            const labelKey = waveSkipKey(row.kind)
            return (
              <li key={`${row.kind}-${String(index)}`} className="rounded-lg border border-line bg-panel-soft px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{labelKey ? t(labelKey) : row.kind}</Badge>
                  {row.waves ? <span className="text-xs text-mute">{t('import.waveSkip.waves', { value: row.waves })}</span> : null}
                  {row.condition ? (
                    <span className="text-xs text-mute">{t('import.waveSkip.condition', { value: row.condition })}</span>
                  ) : null}
                </div>
                {row.raw_text ? <p className="mt-1 text-xs text-mute/80">{row.raw_text}</p> : null}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function TroubleshootingSection({ version }: SectionProps): ReactNode {
  const t = useT()
  return (
    <Card title={t('detail.troubleshooting')}>
      {version.strategy_troubleshooting.length === 0 ? (
        <EmptyState title={t('import.troubleshooting.empty')} />
      ) : (
        <ul className="space-y-2">
          {version.strategy_troubleshooting.map((row, index) => (
            <li key={`${row.waves}-${String(index)}`}>
              <p className="text-sm font-medium">{row.waves}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-mute">
                {row.reasons.map((reason, reasonIndex) => (
                  <li key={`${reason}-${String(reasonIndex)}`}>{reason}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ProofsSection({ version }: SectionProps): ReactNode {
  const t = useT()
  return (
    <Card title={t('detail.proofs')}>
      {version.strategy_proofs.length === 0 ? (
        <EmptyState title={t('import.proofs.empty')} />
      ) : (
        <ul className="space-y-2">
          {version.strategy_proofs.map((row, index) => {
            const bestTime = formatBestTime(row.best_time_sec)
            return (
              <li key={`${row.label}-${String(index)}`} className="rounded-lg border border-line bg-panel-soft px-3 py-2">
                <p className="text-sm font-medium">{row.label || t('common.none')}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  {bestTime ? <Badge tone="good">{t('overlay.bestTime', { value: bestTime })}</Badge> : null}
                  {row.coins_per_hour ? <Badge tone="neutral">{t('import.proofs.coins', { value: row.coins_per_hour })}</Badge> : null}
                  {row.xp_per_hour ? <Badge tone="neutral">{t('import.proofs.xp', { value: row.xp_per_hour })}</Badge> : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function HallOfFameSection({ version }: SectionProps): ReactNode {
  const t = useT()
  return (
    <Card title={t('detail.hof')}>
      {version.strategy_hof.length === 0 ? (
        <EmptyState title={t('import.proofs.empty')} />
      ) : (
        <ul className="space-y-2">
          {version.strategy_hof.map((row, index) => {
            const bestTime = formatBestTime(row.best_time_sec)
            return (
              <li key={`${String(index)}`} className="rounded-lg border border-line bg-panel-soft px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  {row.comp.map((towerKey, keyIndex) => (
                    <Badge key={`${towerKey}-${String(keyIndex)}`} tone="neutral">
                      {humanTowerLabel(towerKey) ?? towerKey}
                    </Badge>
                  ))}
                  {bestTime ? <Badge tone="good">{t('overlay.bestTime', { value: bestTime })}</Badge> : null}
                </div>
                {row.notes ? <p className="mt-1 text-xs text-mute">{row.notes}</p> : null}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** Full-screen image: map plans are unreadable at card size, and this is the one place they matter. */
function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }): ReactNode {
  const t = useT()
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-6"
    >
      <button
        type="button"
        aria-label={t('detail.mediaClose')}
        onClick={onClose}
        className="no-drag absolute right-4 top-4 flex size-9 items-center justify-center rounded-lg border border-line bg-panel text-ink transition-colors hover:bg-panel-soft"
      >
        <X size={16} />
      </button>
      <img
        src={src}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
        className="max-h-full max-w-full rounded-xl border border-line object-contain"
      />
    </div>
  )
}

function MapSection({ detail, version, language }: MapSectionProps): ReactNode {
  const t = useT()
  const [zoomed, setZoomed] = useState(false)
  const mapName = catalogName(detail.maps, language) ?? detail.map_key ?? null
  const storedMapImage = version ? version.strategy_media.find((media) => media.kind === 'map')?.storage_path : undefined
  const imagePath = storedMapImage ?? detail.maps?.image_path ?? null
  const imageUrl = SUPABASE_BASE_URL.length > 0 ? storageUrl(SUPABASE_BASE_URL, imagePath) : null

  return (
    <Card title={t('detail.map')} hint={mapName ?? undefined}>
      {imageUrl ? (
        <div className="space-y-2">
          <button
            type="button"
            data-lift
            onClick={() => setZoomed(true)}
            title={t('detail.mediaZoom')}
            className="no-drag group/media relative block w-full overflow-hidden rounded-lg border border-line"
          >
            <img src={imageUrl} alt={mapName ?? detail.name} loading="lazy" className="max-h-96 w-full object-contain" />
            <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-line bg-panel/90 px-1.5 py-1 text-[11px] text-ink opacity-0 transition-opacity group-hover/media:opacity-100">
              <Maximize2 size={12} />
              {t('detail.mediaZoom')}
            </span>
          </button>
          {version
            ? version.strategy_media
                .filter((media) => media.kind !== 'map')
                .map((media) => (
                  <a
                    key={media.storage_path}
                    href={storageUrl(SUPABASE_BASE_URL, media.storage_path) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-[11px] text-mute underline-offset-2 hover:text-brand hover:underline"
                  >
                    {media.kind}
                  </a>
                ))
            : null}
        </div>
      ) : (
        <EmptyState title={t('detail.noMapImage')} />
      )}
      {zoomed && imageUrl ? <Lightbox src={imageUrl} alt={mapName ?? detail.name} onClose={() => setZoomed(false)} /> : null}
    </Card>
  )
}

function CreditSection({ detail, onOpenSource, openError }: { detail: StrategyDetail; onOpenSource: () => void; openError: string | null }): ReactNode {
  const t = useT()
  const author = detail.profiles?.display_name ?? detail.profiles?.handle ?? null
  const ownerId = detail.profiles?.id ?? null
  // Read separately instead of through the detail embed, so an un-migrated database loses the tick and
  // not the whole page.
  const authorFlag = useQuery({
    queryKey: ['verified', ownerId],
    queryFn: () => fetchAuthorFlag(ownerId),
    enabled: ownerId !== null,
    staleTime: 300_000,
    retry: false
  })

  return (
    <Card title={t('detail.author')}>
      <div className="space-y-1">
        <KeyValue label={t('detail.author')}>
          {author && detail.profiles ? (
            <span className="flex items-center gap-1.5">
              <ProfileHoverCard userId={detail.profiles?.id ?? null}>
                <span className="hover:text-brand">{author}</span>
              </ProfileHoverCard>
              <VerifiedBadge
                show={authorFlag.data?.verified === true}
                tier={authorFlag.data?.corporate ? 'corporate' : 'verified'}
                label={t(authorFlag.data?.corporate ? 'discover.corporate' : 'discover.verified')}
              />
            </span>
          ) : (
            author ?? t('common.none')
          )}
        </KeyValue>
        <KeyValue label={t('import.credit.creator')}>{detail.credit_creator ?? t('common.none')}</KeyValue>
        {detail.credit_contributors.length > 0 ? (
          <KeyValue label={t('import.credit.contributors')}>{detail.credit_contributors.join(', ')}</KeyValue>
        ) : null}
        <KeyValue label={t('detail.source')}>
          {detail.credit_url ? (
            <div className="space-y-2">
              <p className="break-all text-xs text-mute">{detail.credit_url}</p>
              <Row>
                <Button variant="ghost" onClick={onOpenSource}>
                  {t('detail.source')}
                </Button>
              </Row>
              <p className="text-[11px] text-mute">{t('legal.openExternal')}</p>
            </div>
          ) : (
            t('common.none')
          )}
        </KeyValue>
        {openError ? (
          <Banner tone="danger" title={t('common.errorTitle')}>
            {openError}
          </Banner>
        ) : null}
      </div>
    </Card>
  )
}

/** A coarse clock, so a countdown changes without re-rendering the whole page every second. */
function remainingLabel(ms: number): string {
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.round((ms % 3_600_000) / 60_000)
  return hours > 0 ? `${String(hours)}s ${String(minutes)}d` : `${String(minutes)}d`
}

export function StrategyDetailPage(): ReactNode {
  const t = useT()
  const language = useCatalogLanguage()
  const path = useRoutePath()
  const strategyId = routeSegments(path)[1] ?? ''

  const signedIn = useAuth(selectSignedIn)
  const userId = useAuth(selectUserId)
  const queryClient = useQueryClient()
  const applyOverlayState = useAppStore((state) => state.applyOverlayState)
  const setOverlayVisible = useAppStore((state) => state.setOverlayVisible)
  const activeStrategy = useAppStore((state) => state.activeStrategy)
  const overlay = useOverlayControls()
  const [openError, setOpenError] = useState<string | null>(null)

  const detailQuery = useQuery({
    queryKey: ['strategy', strategyId],
    queryFn: () => fetchStrategyDetail(strategyId),
    enabled: strategyId.length > 0 && supabase !== null,
    retry: false
  })

  const favoriteQuery = useQuery({
    queryKey: ['strategy', strategyId, 'favorite', userId ?? 'anon'],
    queryFn: () => readFavorite(strategyId, userId),
    enabled: strategyId.length > 0 && supabase !== null && signedIn,
    retry: false
  })

  const detail = detailQuery.data
  const version = useMemo(() => (detail ? selectCurrentVersion(detail) : undefined), [detail])
  const steps = useMemo(() => (version ? toIrSteps(version) : []), [version])

  /** True when the overlay is tracking *this* strategy, which is what turns the step list into a remote. */
  const tracked = activeStrategy?.strategyId === strategyId
  const stepIndex = tracked ? activeStrategy.stepIndex : null
  const stepTotal = tracked ? activeStrategy.totalSteps : 0

  const now = useTick(30_000)

  // Step-level intelligence: retry telemetry from everyone, notes and verdicts from this account.
  const healthQuery = useQuery({
    queryKey: ['strategy', strategyId, 'step-health'],
    queryFn: () => fetchStepHealth(strategyId),
    enabled: strategyId.length > 0 && supabase !== null,
    retry: 1,
    staleTime: 60_000
  })
  const marksQuery = useQuery({
    queryKey: ['strategy', strategyId, 'marks'],
    queryFn: () => fetchStepMarks(strategyId),
    enabled: strategyId.length > 0 && signedIn && supabase !== null,
    retry: 1
  })
  const towerNamesTr = useTowerNamesTr()

  const markMutation = useMutation({
    mutationFn: (input: { stepNo: number; note: string }) => setStepMark(strategyId, input.stepNo, input.note),
    onSuccess: (rows) => queryClient.setQueryData(['strategy', strategyId, 'marks'], rows)
  })
  const verdictMutation = useMutation({
    mutationFn: (input: { stepNo: number; verdict: 'worked' | 'stuck' }) => rateStep(strategyId, input.stepNo, input.verdict),
    onSuccess: (rows) => queryClient.setQueryData(['strategy', strategyId, 'step-health'], rows)
  })

  useEffect(() => {
    if (!tracked) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      event.preventDefault()
      overlay.step.mutate(event.key === 'ArrowRight' ? 'next' : 'prev')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tracked, overlay])

  const favoriteMutation = useMutation({
    mutationFn: () => toggleFavorite(strategyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['strategy', strategyId] })
      void queryClient.invalidateQueries({ queryKey: ['discover'] })
    }
  })

  // The boost price and the balance both come from the wallet payload, so the button can say up
  // front when a boost is simply unaffordable.
  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: fetchWallet, enabled: signedIn, retry: 1 })
  const boostItems = (walletQuery.data?.catalog ?? [])
    .filter((item) => item.kind === 'boost')
    .sort((a, b) => (a.durationHours ?? 0) - (b.durationHours ?? 0))
  const boostItem = boostItems[0] ?? null
  // The till charges app.effective_price, so the menu has to quote the same number.
  const boostCost = (item: { price: number; finalPrice: number | null }): number => item.finalPrice ?? item.price
  const activeBoost = (walletQuery.data?.boosts ?? []).find((boost) => boost.strategyId === strategyId) ?? null
  const verifiedCredits = walletQuery.data?.verifiedBoostCredits ?? 0
  // The server burns a corporate credit before a verified one, so the button quotes the window the
  // member is actually about to get (0040).
  const corporateTier = walletQuery.data?.corporate === true
  const boostKey = useRef<string | null>(null)

  // A verification credit is not a purchase: no coin moves, no idempotency key is needed.
  const claimMutation = useMutation({
    mutationFn: () => claimVerifiedBoost(strategyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
      void queryClient.invalidateQueries({ queryKey: ['strategy', strategyId] })
      void queryClient.invalidateQueries({ queryKey: ['discover'] })
      void queryClient.invalidateQueries({ queryKey: ['leaderboard-hub'] })
    }
  })

  const boostMutation = useMutation({
    mutationFn: async (sku: string) => {
      // One key per attempt: retrying the same attempt replays the original order server-side.
      boostKey.current ??= newPurchaseKey()
      return buyBoost(strategyId, sku, boostKey.current)
    },
    onSuccess: () => {
      boostKey.current = null
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
      void queryClient.invalidateQueries({ queryKey: ['strategy', strategyId] })
      void queryClient.invalidateQueries({ queryKey: ['discover'] })
      void queryClient.invalidateQueries({ queryKey: ['leaderboard'] })
    }
  })

  const trackMutation = useMutation({
    mutationFn: async (): Promise<OverlayState | null> => {
      const current = detailQuery.data
      const liveVersion = current ? selectCurrentVersion(current) : undefined
      if (!current || !liveVersion) throw new Error(t('detail.notPublished'))

      const parsed = strategyIrSchema.safeParse(buildIrInput(current, liveVersion))
      if (!parsed.success) throw new IrValidationError(describeIrIssues(parsed.error))

      // The detail row is published by definition, so this run is counted.
      // The catalogue's Turkish names and the step intelligence travel with the payload: the main
      // process has no database, and the overlay is the one place a member needs "12 denedi, 4'ü
      // tıkandı" and the tower's own language.
      const health = healthQuery.data ?? []
      const marks = marksQuery.data ?? []
      const marked = new Set(marks.map((mark) => mark.stepNo))
      const state = await call<OverlayState | null>(IPC_CHANNELS.strategyLoad, {
        ir: parsed.data,
        strategyId,
        towerNamesTr,
        stepHealth: health.map((entry) => ({
          stepNo: entry.stepNo,
          worked: entry.worked,
          stuck: entry.stuck,
          marked: marked.has(entry.stepNo),
          verdict: entry.stuck > entry.worked ? ('stuck' as const) : entry.worked > 0 ? ('worked' as const) : undefined
        }))
      })
      await call(IPC_CHANNELS.overlayShow)
      return state
    },
    onSuccess: (state) => {
      applyOverlayState(state)
      setOverlayVisible(true)
    }
  })

  const back = (
    <Row className="mb-1">
      <Button variant="subtle" onClick={() => navigate('/discover')}>
        {t('nav.discover')}
      </Button>
    </Row>
  )

  if (supabase === null) {
    return (
      <div className="space-y-4">
        {back}
        <Banner tone="warn">{t('discover.notConfigured')}</Banner>
      </div>
    )
  }

  if (strategyId.length === 0) {
    return (
      <div className="space-y-4">
        {back}
        <StateNotice title={t('detail.notPublished')} />
      </div>
    )
  }

  if (!detail) {
    if (detailQuery.isError) {
      return (
        <div className="space-y-4">
          {back}
          <StateError
            detail={isNotConfigured(detailQuery.error) ? t('discover.notConfigured') : rawMessage(detailQuery.error)}
            onRetry={() => void detailQuery.refetch()}
            busy={detailQuery.isFetching}
          />
        </div>
      )
    }
    return (
      <div className="space-y-4">
        {back}
        <StateLoading variant="cards" count={1} />
        <SkeletonCard lines={5} />
      </div>
    )
  }

  const difficulty = difficultyEntry(detail.difficulty)
  const waves = formatWaveRange(detail.wave_from, detail.wave_to)
  const players = playerCountKey(detail.player_count)
  const mode = detail.game_mode === 'unknown' ? t('common.none') : detail.game_mode
  const rating = detail.rating_count > 0 && detail.rating_avg !== null ? detail.rating_avg.toFixed(1) : null
  const published = isPublished(detail) && version !== undefined
  const canTrack = published && steps.length > 0
  const isFavorited = favoriteQuery.data === true
  const trackError = trackMutation.error
  const irLines = trackError instanceof IrValidationError ? trackError.lines : null

  const openSource = (): void => {
    if (!detail.credit_url) return
    setOpenError(null)
    void call<{ opened: boolean }>(IPC_CHANNELS.appOpenExternal, { url: detail.credit_url }).catch((error: unknown) => {
      setOpenError(rawMessage(error))
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        back={back}
        title={detail.name}
        subtitle={detail.subtitle ?? detail.description ?? undefined}
        badges={
          <>
            {detail.is_event_strategy ? <Chip tone="warn" icon={CalendarRange}>{t('overlay.eventRibbon')}</Chip> : null}
            <Chip tone={difficulty.tone === 'danger' ? 'danger' : difficulty.tone === 'warn' ? 'warn' : 'neutral'}>
              {difficulty.labelKey ? t(difficulty.labelKey) : detail.difficulty}
            </Chip>
            {version ? <Chip tone="brand" icon={GitCommitHorizontal}>{t('detail.version', { version: version.version_no })}</Chip> : null}
            {rating ? <Chip tone="good" icon={Star}>{`★ ${rating} · ${String(detail.rating_count)}`}</Chip> : null}
            {detail.event_key ? <Chip>{detail.event_key}</Chip> : null}
            {activeBoost ? (
              <Chip tone="good" icon={Flame}>
                {`${t('detail.boostActive')} · ${t('detail.boostEndsIn', { value: remainingLabel(new Date(activeBoost.endsAt).getTime() - now) })}`}
              </Chip>
            ) : null}
            {!published ? <Chip tone="warn" icon={TriangleAlert}>{t('detail.notPublished')}</Chip> : null}
          </>
        }
        actions={
          <>
            <Button variant="primary" busy={trackMutation.isPending} disabled={!canTrack} onClick={() => trackMutation.mutate()}>
              <Play size={14} />
              {tracked ? t('detail.retrack') : t('detail.track')}
            </Button>
            <Button
              variant={isFavorited ? 'primary' : 'ghost'}
              size="sm"
              busy={favoriteMutation.isPending}
              disabled={!signedIn}
              title={signedIn ? undefined : t('discover.needsSignIn')}
              onClick={() => favoriteMutation.mutate()}
            >
              <Bookmark size={14} className={isFavorited ? 'fill-current' : undefined} />
              {isFavorited ? t('discover.favoriteRemove') : t('discover.favoriteAdd')}
            </Button>
            {published && detail?.is_author_own && verifiedCredits > 0 && !activeBoost ? (
              <Button variant="primary" size="sm" busy={claimMutation.isPending} onClick={() => claimMutation.mutate()}>
                <BadgeCheck size={14} />
                {t(corporateTier ? 'verified.claimCorporate' : 'verified.claim')}
              </Button>
            ) : null}
            {published && boostItems.length > 0 ? (
              <Menu>
                <MenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    busy={boostMutation.isPending}
                    disabled={!signedIn}
                    title={signedIn ? undefined : t('discover.needsSignIn')}
                  >
                    <Flame size={14} />
                    {t('detail.boostBuy')}
                    {boostItem ? <CoinAmount value={boostCost(boostItem)} size="sm" /> : null}
                  </Button>
                </MenuTrigger>
                <MenuContent align="end" side="bottom" className="w-72">
                  <MenuSection label={t('market.pickPackage')} />
                  {boostItems.map((item, index) => (
                    <MenuItem
                      key={item.sku}
                      index={index}
                      disabled={(walletQuery.data?.balance ?? 0) < boostCost(item) || boostMutation.isPending}
                      onSelect={() => boostMutation.mutate(item.sku)}
                      aside={<CoinAmount value={boostCost(item)} size="sm" />}
                    >
                      {`${(item.name ?? item.sku)} · ${String(item.durationHours ?? 0)}s`}
                    </MenuItem>
                  ))}
                  <MenuFooter>{t('market.balanceNote', { balance: formatCoin(walletQuery.data?.balance ?? 0) })}</MenuFooter>
                </MenuContent>
              </Menu>
            ) : null}
            <WatchButton strategyId={strategyId} />
          </>
        }
      />

      {tracked ? (
        <Reveal>
          <div className="rounded-2xl border border-brand/40 bg-brand/[0.07] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-brand">
                <Radio size={13} />
                {t('detail.progressTitle')}
              </span>
              <span className="text-xs tabular-nums text-mute">
                {t('overlay.step', { current: (stepIndex ?? 0) + 1, total: stepTotal })}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-soft">
              <motion.div
                data-skin-part="progress"
                initial={false}
                animate={{ width: `${stepTotal > 0 ? Math.round((((stepIndex ?? 0) + 1) / stepTotal) * 100) : 0}%` }}
                transition={{ type: 'spring', stiffness: 220, damping: 28 }}
                className="h-full rounded-full bg-gradient-to-r from-brand to-brand/60"
              />
            </div>
            <Row className="mt-2.5 gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => overlay.step.mutate('prev')} disabled={overlay.step.isPending}>
                <ChevronLeft size={14} />
                {t('common.prev')}
              </Button>
              <Button size="sm" variant="primary" onClick={() => overlay.step.mutate('next')} disabled={overlay.step.isPending}>
                {t('common.next')}
                <ChevronRight size={14} />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => overlay.step.mutate('reset')} disabled={overlay.step.isPending}>
                <RotateCcw size={14} />
                {t('common.reset')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={overlay.show.isPending || overlay.hide.isPending}
                onClick={() => void (overlay.visible ? overlay.hide.mutate() : overlay.show.mutate())}
              >
                {overlay.visible ? <EyeOff size={14} /> : <Eye size={14} />}
                {overlay.visible ? t('common.hide') : t('common.show')}
              </Button>
              <span className="ml-auto hidden text-[11px] text-mute lg:block">{t('detail.kbdHint')}</span>
            </Row>
          </div>
        </Reveal>
      ) : null}

      <StatsPanel strategyId={strategyId} totalSteps={steps.length} />

      {trackMutation.isSuccess ? <Banner tone="good">{t('import.started')}</Banner> : null}
      {boostMutation.isSuccess ? (
        <Banner tone="good">{boostMutation.data.replayed ? t('wallet.replayed') : t('detail.boostDone')}</Banner>
      ) : null}
      {boostMutation.isError ? (
        <Banner tone="danger" title={t('common.errorTitle')}>
          {t(spendErrorKey(rawMessage(boostMutation.error)))}
        </Banner>
      ) : null}
      {favoriteMutation.isError ? (
        <Banner tone="danger" title={t('common.errorTitle')}>
          {rawMessage(favoriteMutation.error)}
        </Banner>
      ) : null}
      {irLines ? (
        <Banner tone="danger" title={t('common.errorTitle')}>
          <ul className="list-disc space-y-1 pl-5">
            {irLines.map((line) => (
              <li key={line} className="font-mono text-[11px]">
                {line}
              </li>
            ))}
          </ul>
        </Banner>
      ) : null}
      {trackError && !irLines ? (
        <Banner tone="danger" title={t('common.errorTitle')}>
          {rawMessage(trackError)}
        </Banner>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {version ? (
            <StepList
              steps={steps}
              currentIndex={stepIndex}
              onJump={tracked ? (index) => overlay.jump.mutate(index) : null}
              health={healthQuery.data ?? []}
              marks={signedIn ? (marksQuery.data ?? []) : []}
              busy={markMutation.isPending || verdictMutation.isPending}
              onRate={(stepNo, verdict) => verdictMutation.mutate({ stepNo, verdict })}
              onMark={(stepNo, note) => markMutation.mutate({ stepNo, note })}
            />
          ) : null}

          <MapSection detail={detail} version={version} language={language} />

          {version ? (
            <>
              <InventorySection version={version} language={language} />
              <ModifiersSection version={version} />
              <RequirementsSection version={version} />
              <WaveSkipSection version={version} />
              <TroubleshootingSection version={version} />
              <ProofsSection version={version} />
              <HallOfFameSection version={version} />
            </>
          ) : null}

          {published ? <DiscussionSection strategyId={strategyId} isOwner={detail.is_author_own} /> : null}
        </div>

        <aside className="space-y-4 self-start lg:sticky lg:top-4">
          <JourneyPanel strategyId={strategyId} totalSteps={steps.length} />

          <Section title={t('detail.facts')}>
            <div className="space-y-0">
              <KeyValue label={t('discover.difficulty')}>{difficulty.labelKey ? t(difficulty.labelKey) : detail.difficulty}</KeyValue>
              <KeyValue label={t('discover.mode')}>{mode}</KeyValue>
              <KeyValue label={t('detail.players')}>{players ? t(players) : detail.player_count}</KeyValue>
              <KeyValue label={t('detail.waves')}>{waves ?? t('common.none')}</KeyValue>
              <KeyValue label={t('detail.duration')}>
                {detail.duration_min ? t('detail.durationMinutes', { count: detail.duration_min }) : t('common.none')}
              </KeyValue>
              <KeyValue label={t('detail.steps')}>{t('detail.stepCount', { count: steps.length })}</KeyValue>
              <KeyValue label={t('detail.usedCount', { count: detail.times_used })}>
                {relativeTime(detail.updated_at, language)}
              </KeyValue>
            </div>
          </Section>

          {detail.strategy_versions && detail.strategy_versions.length > 1 ? (
            <Section title={t('detail.versions')} hint={t('detail.versionsHint')}>
              <ol className="space-y-1.5">
                {[...detail.strategy_versions]
                  .sort((a, b) => b.version_no - a.version_no)
                  .slice(0, 5)
                  .map((entry) => {
                    const current = entry.id === version?.id
                    return (
                      <li key={entry.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className={cn('truncate', current ? 'font-semibold text-ink' : 'text-mute')}>
                          {`${t('detail.version', { version: entry.version_no })}`}
                        </span>
                        {current ? <Chip tone="brand">{t('detail.currentVersion')}</Chip> : null}
                        <span className="shrink-0 text-mute">
                          {entry.published_at ? relativeTime(entry.published_at, language) : '—'}
                        </span>
                      </li>
                    )
                  })}
              </ol>
            </Section>
          ) : null}

          <CreditSection detail={detail} onOpenSource={openSource} openError={openError} />
        </aside>
      </div>
    </div>
  )
}
