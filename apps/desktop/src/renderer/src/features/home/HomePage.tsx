import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  BellRing,
  Check,
  ChevronRight,
  Compass,
  Cpu,
  EyeOff,
  Gauge,
  Import,
  Info,
  Play,
  RadioTower,
  Sparkles,
  Timer,
  TrendingUp,
  Trophy,
  Wallet
} from 'lucide-react'
import { IPC_CHANNELS, formatCoin, metricValue, type AppMeta, type HotkeyStatus } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { HOTKEY_LABEL_KEYS } from '../../lib/labels'
import { navigate } from '../../lib/router'
import { call } from '../../lib/ipc'
import { cn } from '../../lib/utils'
import { formatKeyCode, relativeTime } from '../../lib/text'
import { useCatalogLanguage } from '../../lib/catalog-labels'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/app-store'
import { selectSignedIn, selectUserId, useAuth } from '../../store/auth-store'
import { showcaseQueryKey, useIdentity } from '../../lib/identity'
import { fetchWallet } from '../../lib/wallet-api'
import { fetchShowcase } from '../../lib/profile-api'
import { searchStrategies } from '../../lib/discovery-api'
import { fetchRecentStrategies, fetchWatchUpdates, markWatchSeen } from '../../lib/intelligence-api'
import { useUsageStatus } from '../../lib/usage'
import { useMotion } from '../../motion/context'
import { STATUS_KEY } from '../settings/use-settings'
import { useOverlayControls } from '../shell/use-overlay'
import { OfflineShelfTile } from '../shell/OfflineShelf'
import { CreatorFeedTile } from '../discover/CreatorWatch'
import { CoinIcon } from '../../components/brand/coin'
import { Button } from '../../components/ui'
import { Chip, Section } from '../../components/ui/system'
import { CountUp } from '../../motion/primitives/CountUp'
import { Reveal, RevealItem, RevealList } from '../../motion/primitives/Reveal'
import { SkeletonRow } from '../../motion/primitives/Shimmer'

const HOW_KEYS: MessageKey[] = ['home.how1', 'home.how2', 'home.how3', 'home.how4']

/* ---------------------------------------------------------------- small pieces */

function Tile({
  label,
  icon: Icon,
  aside,
  children,
  className
}: {
  label: string
  icon: typeof Wallet
  aside?: ReactNode
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <Section
      title={
        <span className="flex items-center gap-1.5">
          <Icon size={13} className="text-brand" />
          {label}
        </span>
      }
      aside={aside}
      className={className}
    >
      {children}
    </Section>
  )
}

function MiniStat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }): ReactNode {
  return (
    <div className="min-w-0">
      <p className="hud-label truncate">{label}</p>
      <p className="hud-num mt-0.5 truncate text-[15px] font-semibold text-ink">{value}</p>
      {hint ? <p className="truncate text-[10px] text-mute">{hint}</p> : null}
    </div>
  )
}

/* ---------------------------------------------------------------- hero */

function Hero(): ReactNode {
  const t = useT()
  const identity = useIdentity()
  const overlay = useOverlayControls()
  const active = useAppStore((state) => state.activeStrategy)
  const run = useAppStore((state) => state.overlayState)
  const overlayVisible = useAppStore((state) => state.overlayVisible)
  const userId = useAuth(selectUserId)
  const signedIn = useAuth(selectSignedIn)

  const showcase = useQuery({
    queryKey: showcaseQueryKey(userId),
    queryFn: () => fetchShowcase(userId ?? ''),
    enabled: signedIn && userId !== null && supabase !== null,
    staleTime: 60_000,
    retry: 1
  })
  const metrics = showcase.data?.metrics
  const percent = active && active.totalSteps > 0 ? Math.round(((active.stepIndex + 1) / active.totalSteps) * 100) : 0

  return (
    <Reveal>
      <div className="hud-panel relative overflow-hidden px-5 py-5 sm:px-6 sm:py-6">
        <span aria-hidden className="hud-scan" />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.10]"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)',
            backgroundSize: '36px 36px',
            maskImage: 'radial-gradient(ellipse 70% 90% at 85% 0%, #000 20%, transparent 70%)'
          }}
        />

        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="brand" icon={Sparkles}>{t('app.alpha')}</Chip>
              <span className="hud-label truncate">{t('home.badge')}</span>
            </div>
            <h1 className="mt-3 text-[26px] leading-tight font-semibold tracking-tight text-ink sm:text-[30px]">
              {identity.signedIn ? t('home.greeting', { handle: identity.display }) : t('home.title')}
            </h1>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-mute">{t('home.intro')}</p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {active ? (
                <>
                  <Button
                    variant="primary"
                    disabled={overlay.show.isPending || overlay.hide.isPending}
                    onClick={() => void (overlayVisible ? overlay.hide.mutate() : overlay.show.mutate())}
                  >
                    {overlayVisible ? <EyeOff size={14} /> : <Play size={14} />}
                    {overlayVisible ? t('home.heroHideOverlay') : t('home.heroShowOverlay')}
                  </Button>
                  <Button variant="ghost" disabled={overlay.step.isPending} onClick={() => overlay.step.mutate('next')}>
                    {t('common.next')}
                    <ChevronRight size={14} />
                  </Button>
                  <Button variant="ghost" onClick={() => navigate(`/strategy/${active.strategyId}`)}>
                    <Compass size={14} />
                    {t('home.heroOpen')}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="primary" onClick={() => navigate('/import')}>
                    <Import size={14} />
                    {t('home.cta')}
                  </Button>
                  <Button variant="ghost" onClick={() => navigate('/discover')}>
                    <Compass size={14} />
                    {t('nav.discover')}
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 self-start">
            {active && run?.current ? (
              <div className="col-span-2 rounded-xl border border-brand/35 bg-brand/[0.07] px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="hud-label flex items-center gap-1.5 text-brand">
                    <RadioTower size={11} />
                    {t('home.heroLive')}
                  </span>
                  <span className="hud-num text-[11px] text-mute">{`${String(percent)}%`}</span>
                </div>
                <p className="mt-1 truncate text-[13px] font-semibold text-ink">{active.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-mute">
                  {`${t('overlay.step', { current: active.stepIndex + 1, total: active.totalSteps })} · ${run.current.action}`}
                </p>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-panel-soft">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${String(percent)}%` }} />
                </div>
              </div>
            ) : (
              <div className="col-span-2 rounded-xl border border-line bg-base/40 px-3 py-2.5">
                <span className="hud-label flex items-center gap-1.5">
                  <RadioTower size={11} />
                  {t('home.heroIdle')}
                </span>
                <p className="mt-1 text-[11px] leading-relaxed text-mute">{t('home.heroIdleHint')}</p>
              </div>
            )}

            <MiniStat
              label={t('profile.metricSessions')}
              value={<CountUp value={metrics ? metricValue(metrics, 'sessions_qualified') : 0} />}
              hint={t('home.heroAllTime')}
            />
            <MiniStat
              label={t('profile.metricStreak')}
              value={<CountUp value={metrics ? metricValue(metrics, 'streak') : 0} />}
              hint={t('home.heroDays')}
            />
            <MiniStat
              label={t('profile.metricSteps')}
              value={<CountUp value={metrics ? metricValue(metrics, 'steps_completed') : 0} />}
              hint={t('home.heroAllTime')}
            />
            <MiniStat
              label={t('profile.metricPublished')}
              value={<CountUp value={metrics ? metricValue(metrics, 'strategies_published') : 0} />}
              hint={t('home.heroAllTime')}
            />
          </div>
        </div>
      </div>
    </Reveal>
  )
}

/* ---------------------------------------------------------------- continue */

function ContinueTile(): ReactNode {
  const t = useT()
  const signedIn = useAuth(selectSignedIn)
  const language = useCatalogLanguage()
  const query = useQuery({
    queryKey: ['me', 'recent-strategies'],
    queryFn: () => fetchRecentStrategies(4),
    enabled: signedIn && supabase !== null,
    retry: 1,
    staleTime: 60_000
  })
  const rows = query.data ?? []

  if (!signedIn) {
    return (
      <Tile label={t('home.continueTitle')} icon={Timer} className="sm:col-span-2">
        <p className="text-[11px] leading-relaxed text-mute">{t('home.continueSignedOut')}</p>
        <Button className="mt-2" size="sm" variant="ghost" onClick={() => navigate('/account')}>
          {t('auth.signIn')}
        </Button>
      </Tile>
    )
  }

  return (
    <Tile
      label={t('home.continueTitle')}
      icon={Timer}
      className="sm:col-span-2"
      aside={
        <Button size="sm" variant="ghost" onClick={() => navigate('/discover')}>
          {t('nav.discover')}
          <ChevronRight size={13} />
        </Button>
      }
    >
      {query.isPending ? (
        <div className="space-y-2">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-mute">{t('home.continueEmpty')}</p>
      ) : (
        <RevealList className="grid gap-2 sm:grid-cols-2" count={rows.length}>
          {rows.map((row) => {
            const percent = row.totalSteps > 0 ? Math.min(100, Math.round((row.bestStep / row.totalSteps) * 100)) : 0
            return (
              <RevealItem key={row.strategyId} className="h-full">
                <button
                  type="button"
                  data-lift
                  onClick={() => navigate(`/strategy/${row.strategyId}`)}
                  className="no-drag hud-panel flex h-full w-full flex-col gap-1.5 p-2.5 text-left"
                >
                  <span className="truncate text-[13px] font-medium text-ink">{row.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-panel-soft">
                      <span className="block h-full rounded-full bg-brand" style={{ width: `${String(percent)}%` }} />
                    </span>
                    <span className="hud-num shrink-0 text-[10px] text-mute">{`${String(row.bestStep)}/${String(row.totalSteps)}`}</span>
                  </span>
                  <span className="truncate text-[10px] text-mute">
                    {`${t('home.continueRuns', { count: row.runs })}${row.lastRunAt ? ` · ${relativeTime(row.lastRunAt, language)}` : ''}`}
                  </span>
                </button>
              </RevealItem>
            )
          })}
        </RevealList>
      )}
    </Tile>
  )
}

/* ---------------------------------------------------------------- watch */

function WatchTile(): ReactNode {
  const t = useT()
  const signedIn = useAuth(selectSignedIn)
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['watch', 'updates'],
    queryFn: fetchWatchUpdates,
    enabled: signedIn,
    retry: 1,
    staleTime: 60_000
  })
  const rows = query.data ?? []

  if (!signedIn) return null

  return (
    <Tile
      label={t('home.watchTitle')}
      icon={BellRing}
      aside={rows.length > 0 ? <Chip tone="brand">{String(rows.length)}</Chip> : undefined}
    >
      {rows.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-mute">{t('home.watchEmpty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 3).map((entry) => (
            <li key={entry.strategyId} className="flex items-center gap-2">
              <button
                type="button"
                className="no-drag min-w-0 flex-1 truncate text-left text-[12px] text-ink hover:text-brand"
                onClick={() => navigate(`/strategy/${entry.strategyId}`)}
              >
                {entry.name}
              </button>
              <Chip tone="brand">{`v${String(entry.toVersion ?? '?')}`}</Chip>
              <button
                type="button"
                title={t('detail.markSeen')}
                className="no-drag grid size-6 shrink-0 place-items-center rounded-md text-mute transition-colors hover:bg-panel-soft hover:text-ink"
                onClick={() => void markWatchSeen(entry.strategyId).then(() => queryClient.invalidateQueries({ queryKey: ['watch'] }))}
              >
                <Check size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  )
}

/* ---------------------------------------------------------------- wallet */

function WalletTile(): ReactNode {
  const t = useT()
  const signedIn = useAuth(selectSignedIn)
  const query = useQuery({ queryKey: ['wallet'], queryFn: fetchWallet, enabled: signedIn && supabase !== null, retry: 1 })
  const wallet = query.data

  const weekEarned = useMemo(() => {
    const since = Date.now() - 7 * 24 * 3_600_000
    return (wallet?.entries ?? []).reduce((sum, entry) => {
      const at = new Date(entry.at).getTime()
      return Number.isFinite(at) && at >= since && entry.delta > 0 ? sum + entry.delta : sum
    }, 0)
  }, [wallet?.entries])

  return (
    <Tile
      label={t('nav.wallet')}
      icon={Wallet}
      aside={
        <Button size="sm" variant="ghost" onClick={() => navigate('/wallet')}>
          {t('common.open')}
          <ChevronRight size={13} />
        </Button>
      }
    >
      {!signedIn ? (
        <p className="text-[11px] text-mute">{t('home.walletSignedOut')}</p>
      ) : query.isPending ? (
        <SkeletonRow />
      ) : (
        <div className="space-y-2">
          <p className="flex items-center gap-2">
            <CoinIcon size={22} className="text-brand" />
            <span className="hud-num text-2xl font-semibold text-ink">
              <CountUp value={wallet?.balance ?? 0} format={formatCoin} />
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Chip tone="good" icon={TrendingUp}>{`+${formatCoin(weekEarned)} · ${t('home.thisWeek')}`}</Chip>
            {wallet && !wallet.reconciled ? <Chip tone="danger">{t('wallet.unreconciledTitle')}</Chip> : null}
          </div>
        </div>
      )}
    </Tile>
  )
}

/* ---------------------------------------------------------------- instruments */

function LiveTile(): ReactNode {
  const t = useT()
  const overlayVisible = useAppStore((state) => state.overlayVisible)
  const recentKeys = useAppStore((state) => state.recentKeys)
  const usage = useUsageStatus()
  const motion = useMotion()
  const hook = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => call<HotkeyStatus>(IPC_CHANNELS.hotkeysGetStatus),
    retry: false
  })
  const status = hook.data
  const pending = usage.data?.pending ?? 0
  const hookOk = status?.running === true && !status.degraded && !status.paused && !status.disabledByRemoteFlag

  return (
    <Tile
      label={t('home.liveTitle')}
      icon={Cpu}
      className="sm:col-span-2"
      aside={<Chip tone={motion.downgraded ? 'warn' : 'neutral'} icon={Gauge}>{motion.tier}</Chip>}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat
          label={t('title.overlay')}
          value={
            <span className={cn('flex items-center gap-1.5', overlayVisible ? 'text-good' : 'text-mute')}>
              <span className={cn('size-1.5 rounded-full', overlayVisible ? 'bg-good' : 'bg-mute/50')} />
              {overlayVisible ? t('title.overlayVisible') : t('title.overlayHidden')}
            </span>
          }
          hint={t('home.liveRealtime')}
        />
        <MiniStat
          label={t('title.hook')}
          value={
            <span className={cn('flex items-center gap-1.5', hookOk ? 'text-good' : 'text-warn')}>
              {hookOk ? <Check size={12} /> : <Info size={12} />}
              {status ? (hookOk ? t('settings.running') : status.paused ? t('settings.paused') : t('settings.degraded.title')) : '—'}
            </span>
          }
          hint={status?.backend ?? '—'}
        />
        <MiniStat
          label={t('title.sync')}
          value={<span className={cn(pending > 0 ? 'text-warn' : 'text-ink')}>{pending > 0 ? String(pending) : t('title.syncClean')}</span>}
          hint={usage.data?.lastError ? t('usage.retrying', { attempts: usage.data.attempts }) : t('home.liveQueue')}
        />
        <MiniStat
          label={t('settings.motionTier')}
          value={motion.averageFps === null ? motion.tier : `${String(Math.round(motion.averageFps))} fps`}
          hint={motion.reason}
        />
      </div>

      {recentKeys.length > 0 ? (
        <div className="mt-3 border-t border-line/60 pt-2">
          <p className="hud-label mb-1">{t('home.feedTitle')}</p>
          <ul className="flex flex-wrap gap-1.5">
            {recentKeys.slice(0, 5).map((event) => (
              <li key={`${String(event.at)}-${event.action}`} className="flex items-center gap-1.5 rounded-md border border-line bg-panel-soft/60 px-1.5 py-0.5 text-[10px]">
                <span className="hud-num text-brand">{formatKeyCode(event.code)}</span>
                <span className="text-mute">{t(HOTKEY_LABEL_KEYS[event.action])}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Tile>
  )
}

/* ---------------------------------------------------------------- featured */

function FeaturedTile(): ReactNode {
  const t = useT()
  const query = useQuery({
    queryKey: ['discover', 'home-rating'],
    queryFn: () => searchStrategies({ q: '', mode: null, map: null, difficulty: null, event: null, tag: null, sort: 'rating', offset: 0 }),
    enabled: supabase !== null,
    staleTime: 300_000,
    retry: 1
  })
  const rows = (query.data ?? []).slice(0, 3)

  return (
    <Tile
      label={t('home.featuredTitle')}
      icon={Trophy}
      aside={
        <Button size="sm" variant="ghost" onClick={() => navigate('/leaderboard')}>
          {t('nav.leaderboard')}
          <ChevronRight size={13} />
        </Button>
      }
    >
      {query.isPending ? (
        <SkeletonRow />
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-mute">{t('home.featuredEmpty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row, index) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => navigate(`/strategy/${row.id}`)}
                className="no-drag flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-panel-soft/60"
              >
                <span className="hud-num w-5 shrink-0 text-[11px] text-brand/80">{String(index + 1).padStart(2, '0')}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-ink">{row.name}</span>
                  <span className="block truncate text-[10px] text-mute">
                    {`${t('detail.usedCount', { count: row.times_used })}${row.rating_count > 0 && row.rating_avg !== null ? ` · ★ ${row.rating_avg.toFixed(1)}` : ''}`}
                  </span>
                </span>
                <ArrowRight size={12} className="shrink-0 text-mute" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  )
}

/* ---------------------------------------------------------------- page */

export function HomePage(): ReactNode {
  const t = useT()
  const metaQuery = useQuery({
    queryKey: ['app', 'meta'],
    queryFn: () => call<AppMeta>(IPC_CHANNELS.appGetMeta),
    retry: false
  })

  return (
    <div className="space-y-4">
      <Hero />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <ContinueTile />
        <WalletTile />
        <WatchTile />
        <LiveTile />
        <FeaturedTile />
        <CreatorFeedTile />
        <OfflineShelfTile />
      </div>

      <Section title={t('home.howTitle')} hint={t('home.howHint')}>
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {HOW_KEYS.map((key, index) => (
            <li key={key} className="flex gap-2.5 rounded-xl border border-line/70 bg-base/40 px-3 py-2.5">
              <span className="hud-num grid size-6 shrink-0 place-items-center rounded-md border border-brand/30 bg-brand/12 text-[11px] font-semibold text-brand">
                {String(index + 1)}
              </span>
              <span className="pt-0.5 text-[11px] leading-snug text-mute">{t(key)}</span>
            </li>
          ))}
        </ol>
      </Section>

      {metaQuery.data ? (
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3">
          <span className="hud-label flex items-center gap-1.5">
            <Timer size={11} />
            {`v${metaQuery.data.version} · ${metaQuery.data.policyVersion}`}
          </span>
          <span className="hud-label">{metaQuery.data.platform}</span>
          <span className="hud-label">{`electron ${metaQuery.data.electron}`}</span>
          <span className="hud-label truncate font-mono">{metaQuery.data.userDataPath}</span>
          <span className="ml-auto flex items-center gap-3">
            <button type="button" className="hud-label no-drag hover:text-ink" onClick={() => navigate('/about')}>
              {t('nav.about')}
            </button>
            <button type="button" className="hud-label no-drag hover:text-ink" onClick={() => navigate('/legal')}>
              {t('nav.legal')}
            </button>
          </span>
        </footer>
      ) : null}
    </div>
  )
}
