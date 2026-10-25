import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Crown,
  Info,
  Lock,
  Minus,
  Pause,
  Play,
  RefreshCw,
  Scale,
  Search,
  Sparkles,
  Star,
  Trophy,
  Users,
  X
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import {
  LEADERBOARD_WINDOWS,
  PLAYER_METRICS,
  formatLeaderboardScore,
  formatMetricValue,
  leagueForRank,
  storageUrl,
  type LeaderboardBoard,
  type LeaderboardHubMe,
  type LeaderboardHubRow,
  type LeaderboardLeague,
  type LeaderboardWindow,
  type PlayerMetric
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { navigate } from '../../lib/router'
import { fetchLeaderboardHub } from '../../lib/leaderboard-api'
import { fetchCatalogOptions, type CatalogOption } from '../../lib/discovery-api'
import { catalogName, pickLocalized, useCatalogLanguage } from '../../lib/catalog-labels'
import { SUPABASE_BASE_URL } from '../../lib/storage-base'
import { selectSignedIn, useAuth } from '../../store/auth-store'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { Button, INPUT_CLASS, cn } from '../../components/ui'
import { Chip, PageHeader, Segmented } from '../../components/ui/system'
import { StateEmpty, StateError, StateLoading } from '../../components/ui/states'
import { FrameRing, frameStyle } from '../../components/brand/frame'
import { TitleBadge } from '../../components/brand/title-badge'
import { VerifiedBadge } from '../../components/brand/verified-badge'
import { BadgeGlyph } from '../../components/brand/badge-glyph'
import { RevealItem, RevealList } from '../../motion/primitives/Reveal'

/**
 * The leaderboard is a field report, not a table dump: it answers "where am I", "who is moving",
 * "who do I want to watch" and "how does the score work" before it lists a hundred rows.
 */

const WINDOW_LABEL: Record<LeaderboardWindow, MessageKey> = {
  all_time: 'leaderboard.allTime',
  weekly: 'leaderboard.weekly',
  daily: 'leaderboard.daily'
}

const BOARD_LABEL: Record<LeaderboardBoard, MessageKey> = {
  strategies: 'leaderboard.boardStrategies',
  players: 'leaderboard.boardPlayers'
}

const METRIC_LABEL: Record<PlayerMetric, MessageKey> = {
  sessions: 'leaderboard.metricSessions',
  steps: 'leaderboard.metricSteps',
  coins: 'leaderboard.metricCoins',
  publishes: 'leaderboard.metricPublishes'
}

const LEAGUE_LABEL: Record<LeaderboardLeague, MessageKey> = {
  diamond: 'leaderboard.leagueDiamond',
  gold: 'leaderboard.leagueGold',
  silver: 'leaderboard.leagueSilver',
  bronze: 'leaderboard.leagueBronze'
}

const LEAGUE_TONE: Record<LeaderboardLeague, 'brand' | 'warn' | 'neutral' | 'good'> = {
  diamond: 'brand',
  gold: 'warn',
  silver: 'neutral',
  bronze: 'good'
}

const BADGE_TONE: Record<string, string> = {
  bronze: 'border-amber-700/50 bg-amber-700/15 text-amber-300',
  silver: 'border-slate-400/40 bg-slate-400/15 text-slate-200',
  gold: 'border-amber-300/50 bg-amber-300/15 text-amber-200',
  special: 'border-fuchsia-400/40 bg-fuchsia-400/15 text-fuchsia-200'
}

type SortKey = 'rank' | 'score' | 'movement' | 'name'

const SORT_LABEL: Record<SortKey, MessageKey> = {
  rank: 'leaderboard.sortRank',
  score: 'leaderboard.sortScore',
  movement: 'leaderboard.sortMovement',
  name: 'leaderboard.sortName'
}

const SORTS: SortKey[] = ['rank', 'score', 'movement', 'name']

const SELECT_CLASS = 'no-drag h-8 rounded-lg border border-line bg-base px-2 text-xs text-ink outline-none focus:border-brand'

function watchKey(board: LeaderboardBoard): string {
  return `tds.leaderboard.watch.v1.${board}`
}

function readWatch(board: LeaderboardBoard): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(watchKey(board)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function countText(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

function scoreText(board: LeaderboardBoard, metric: PlayerMetric, value: number): string {
  return board === 'strategies' ? formatLeaderboardScore(value) : formatMetricValue(metric, value)
}

function metricKey(board: LeaderboardBoard, metric: PlayerMetric): MessageKey {
  return board === 'strategies' ? 'leaderboard.scoreShort' : METRIC_LABEL[metric]
}

function profileHash(row: LeaderboardHubRow): string | null {
  if (row.playerId) return `#/profile/${row.playerId}`
  if (row.kind === 'strategy') return `#/strategy/${row.entityId}`
  return null
}

function openEntity(row: LeaderboardHubRow): void {
  if (row.kind === 'strategy') navigate(`/strategy/${row.entityId}`)
  else if (row.playerId) navigate(`/profile/${row.playerId}`)
}

function playerName(row: LeaderboardHubRow): string {
  return row.displayName ?? row.handle ?? row.name
}

/* ---------------------------------------------------------------- identity */

/**
 * The member's own marks. 0040 moved the tick, the tier and both title names into the hub RPC, so these
 * read the row instead of firing another profile query for every author on screen.
 */
function RowTitle({ row, size = 'sm' }: { row: LeaderboardHubRow; size?: 'sm' | 'md' }): ReactNode {
  const language = useCatalogLanguage()
  const label = pickLocalized(row.titleName, row.titleNameEn, language)
  if (label === null) return null
  return <TitleBadge label={label} refCode={row.titleKey ?? undefined} size={size} />
}

function RowTick({ row }: { row: LeaderboardHubRow }): ReactNode {
  const t = useT()
  return (
    <VerifiedBadge
      show={row.verified}
      tier={row.corporate ? 'corporate' : 'verified'}
      size="sm"
      label={t(row.corporate ? 'discover.corporate' : 'discover.verified')}
    />
  )
}

function RowAvatar({ row, size = 'md' }: { row: LeaderboardHubRow; size?: 'sm' | 'md' | 'lg' }): ReactNode {
  const src = row.avatarPath && SUPABASE_BASE_URL.length > 0 ? storageUrl(SUPABASE_BASE_URL, row.avatarPath) : null
  const initials = playerName(row).slice(0, 2).toLocaleUpperCase()
  const pixels = size === 'lg' ? 56 : size === 'sm' ? 32 : 40
  const text = size === 'lg' ? 'text-base' : size === 'sm' ? 'text-[10px]' : 'text-xs'

  return (
    <span className="relative inline-flex shrink-0 rounded-full">
      <FrameRing value={row.frameKey} />
      <Avatar
        className="border border-line/80"
        style={{ ...frameStyle(row.frameKey), width: pixels, height: pixels }}
      >
        {src ? <AvatarImage src={src} alt="" /> : null}
        <AvatarFallback className={cn('bg-brand/15 font-semibold text-brand', text)}>{initials}</AvatarFallback>
      </Avatar>
    </span>
  )
}

function MovementBadge({
  row,
  previousWindow
}: {
  row: LeaderboardHubRow
  previousWindow: LeaderboardWindow | null
}): ReactNode {
  const t = useT()
  if (!previousWindow) {
    return <span className="hud-num text-[10px] text-mute/40">{t('leaderboard.noMovement')}</span>
  }
  if (row.previousRank === null) {
    return <Chip tone="brand">{t('leaderboard.newEntry')}</Chip>
  }
  if (row.movement === null || row.movement === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] tabular-nums text-mute">
        <Minus size={10} />
        0
      </span>
    )
  }
  const climbed = row.movement > 0
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums', climbed ? 'text-good' : 'text-danger')}>
      {climbed ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
      {Math.abs(row.movement)}
    </span>
  )
}

function LeagueChip({ league }: { league: LeaderboardLeague | null }): ReactNode {
  const t = useT()
  if (!league) return null
  return (
    <Chip tone={LEAGUE_TONE[league]} icon={Sparkles}>
      {t(LEAGUE_LABEL[league])}
    </Chip>
  )
}

function BadgeShelf({ row }: { row: LeaderboardHubRow }): ReactNode {
  const t = useT()
  if (row.badges.length === 0) return null
  const shown = row.badges.slice(0, 3)
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((badge) => (
          <span
            key={badge.code}
            title={badge.name}
            className={cn(
              'grid size-5 place-items-center overflow-hidden rounded-[4px] border text-[9px] font-bold',
              BADGE_TONE[badge.tier] ?? BADGE_TONE.bronze
            )}
          >
            {/* A stored name draws the mark; only a badge with neither art nor name falls back to a letter. */}
            <BadgeGlyph path={badge.iconPath} size={14} fallback={badge.name.slice(0, 1).toLocaleUpperCase()} />
          </span>
      ))}
      {row.badgeCount > shown.length ? (
        <span className="text-[10px] text-mute">{t('leaderboard.badgeMore', { count: row.badgeCount - shown.length })}</span>
      ) : null}
    </span>
  )
}

function InlineActions({
  watched,
  compared,
  copied,
  onWatch,
  onCompare,
  onCopy
}: {
  watched: boolean
  compared: boolean
  copied: boolean
  onWatch: () => void
  onCompare: () => void
  onCopy?: () => void
}): ReactNode {
  const t = useT()
  const base = 'no-drag grid size-7 place-items-center rounded-md border transition-colors'
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        data-press
        title={watched ? t('leaderboard.unwatch') : t('leaderboard.watch')}
        aria-label={watched ? t('leaderboard.unwatch') : t('leaderboard.watch')}
        onClick={(event) => {
          event.stopPropagation()
          onWatch()
        }}
        className={cn(base, watched ? 'border-warn/45 bg-warn/10 text-warn' : 'border-line bg-base/40 text-mute hover:text-ink')}
      >
        <Star size={12} className={watched ? 'fill-current' : undefined} />
      </button>
      <button
        type="button"
        data-press
        title={t('leaderboard.compareAdd')}
        aria-label={t('leaderboard.compareAdd')}
        onClick={(event) => {
          event.stopPropagation()
          onCompare()
        }}
        className={cn(base, compared ? 'border-brand/45 bg-brand/10 text-brand' : 'border-line bg-base/40 text-mute hover:text-ink')}
      >
        <Scale size={12} />
      </button>
      {onCopy ? (
        <button
          type="button"
          data-press
          title={t('leaderboard.copyProfile')}
          aria-label={t('leaderboard.copyProfile')}
          onClick={(event) => {
            event.stopPropagation()
            onCopy()
          }}
          className={cn(base, copied ? 'border-good/45 bg-good/10 text-good' : 'border-line bg-base/40 text-mute hover:text-ink')}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      ) : null}
    </span>
  )
}

/* ---------------------------------------------------------------- standing */

function StatCell({ label, value, hint }: { label: string; value: string; hint?: string }): ReactNode {
  return (
    <div className="rounded-lg border border-line/60 bg-base/30 px-2.5 py-2">
      <p className="hud-label">{label}</p>
      <p className="hud-num mt-0.5 text-[15px] font-semibold text-ink">{value}</p>
      {hint ? <p className="text-[10px] leading-snug text-mute">{hint}</p> : null}
    </div>
  )
}

function StandingPanel({
  me,
  board,
  metric,
  total,
  signedIn
}: {
  me: LeaderboardHubMe | null
  board: LeaderboardBoard
  metric: PlayerMetric
  total: number
  signedIn: boolean
}): ReactNode {
  const t = useT()

  if (!me) {
    const cta = signedIn
      ? board === 'players'
        ? { label: t('leaderboard.ctaTrack'), onClick: () => navigate('/discover') }
        : { label: t('leaderboard.ctaPublish'), onClick: () => navigate('/import') }
      : { label: t('auth.signIn'), onClick: () => navigate('/account') }
    return (
      <section className="hud-panel relative overflow-hidden p-4">
        <span aria-hidden className="absolute -right-10 -top-16 size-48 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl border border-line bg-panel-soft text-mute">
            <Lock size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="hud-label">{t('leaderboard.standing')}</p>
            <p className="text-[15px] font-semibold text-ink">{t('leaderboard.unranked')}</p>
            <p className="mt-0.5 max-w-xl text-[11px] leading-relaxed text-mute">
              {board === 'players' ? t('leaderboard.unrankedPlayersHint') : t('leaderboard.unrankedStrategiesHint')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip tone="neutral">{t('leaderboard.totalLabel')}: {countText(total)}</Chip>
            <Button size="sm" variant="primary" onClick={cta.onClick}>
              {cta.label}
            </Button>
          </div>
        </div>
      </section>
    )
  }

  const league = leagueForRank(me.rank, total)
  const gap = me.gapToNext
  const progress =
    me.rank <= 1
      ? 100
      : gap !== null && gap >= 0
        ? Math.max(6, Math.min(100, Math.round((me.score / (me.score + gap || 1)) * 100)))
        : 100
  const name = me.displayName ?? me.handle ?? me.name
  const subtitle = board === 'strategies' ? me.name : me.handle ? `@${me.handle}` : ''
  const metricLabel = t(metricKey(board, metric))

  return (
    <section className="hud-panel relative overflow-hidden p-4">
      <span aria-hidden className="hud-scan" />
      <span aria-hidden className="absolute -right-12 -top-20 size-56 rounded-full bg-brand/10 blur-3xl" />

      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <RowAvatar row={me} size="lg" />
          <div className="min-w-0">
            <p className="hud-label">{t('leaderboard.standing')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="hud-num text-3xl leading-none font-semibold text-ink">#{me.rank}</span>
              <span className="text-[11px] text-mute">/ {countText(total)}</span>
              <LeagueChip league={league} />
              {me.rank === 1 ? <Chip tone="good" icon={Crown}>{t('leaderboard.topRank')}</Chip> : null}
            </div>
            <p className="mt-1 truncate text-[13px] font-medium text-ink">{name}</p>
            {subtitle ? <p className="truncate text-[11px] text-mute">{subtitle}</p> : null}
          </div>
        </div>

        <div className="min-w-0 flex-1 lg:max-w-md">
          <div className="flex items-baseline justify-between gap-2">
            <span className="hud-label">{metricLabel}</span>
            <span className="hud-num text-xl font-semibold text-brand">{scoreText(board, metric, me.score)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-soft">
            <span className="block h-full rounded-full bg-brand transition-[width]" style={{ width: `${String(progress)}%` }} />
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-mute">
            <span>{t('leaderboard.progressToNext')}</span>
            <span className="tabular-nums">
              {me.rank <= 1 ? t('leaderboard.topRank') : gap !== null ? t('leaderboard.gapToNext', { value: scoreText(board, metric, gap) }) : t('leaderboard.noPrevious')}
            </span>
          </div>
        </div>

        <Button size="sm" variant="subtle" onClick={() => navigate(`/profile/${me.playerId ?? ''}`)} disabled={!me.playerId}>
          {t('leaderboard.viewProfile')}
        </Button>
      </div>

      <div className="relative mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {me.percentile !== null ? (
          <StatCell
            label={t('leaderboard.percentileLabel')}
            value={t('leaderboard.percentile', { value: me.percentile })}
            hint={metricLabel}
          />
        ) : null}
        <StatCell label={t('leaderboard.bestRank')} value={me.bestRank !== null ? `#${String(me.bestRank)}` : '—'} />
        {board === 'players' ? (
          <>
            <StatCell label={t('leaderboard.streak')} value={countText(me.streak)} />
            <StatCell label={t('leaderboard.activeDays')} value={countText(me.activeDays)} />
          </>
        ) : (
          <>
            <StatCell label={t('leaderboard.sessions')} value={countText(me.sessions)} hint={t('leaderboard.careerStats')} />
            <StatCell label={t('leaderboard.steps')} value={countText(me.steps)} hint={t('leaderboard.careerStats')} />
          </>
        )}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- podium */

function PodiumCard({
  row,
  place,
  board,
  metric,
  previousWindow,
  watched,
  compared,
  copied,
  onWatch,
  onCompare,
  onCopy
}: {
  row: LeaderboardHubRow
  place: number
  board: LeaderboardBoard
  metric: PlayerMetric
  previousWindow: LeaderboardWindow | null
  watched: boolean
  compared: boolean
  copied: boolean
  onWatch: () => void
  onCompare: () => void
  onCopy: () => void
}): ReactNode {
  const t = useT()
  const order = place === 1 ? 'order-1 md:order-2' : place === 2 ? 'order-2 md:order-1' : 'order-3'
  const tone =
    place === 1
      ? 'border-brand/45 bg-brand/[0.06] md:-mt-2'
      : place === 2
        ? 'border-line/80'
        : 'border-warn/35'

  return (
    <article className={cn('hud-panel relative flex h-full flex-col items-center gap-2 p-3 text-center', order, tone)}>
      <div className="flex w-full items-center justify-between gap-1">
        <span
          className={cn(
            'grid size-7 place-items-center rounded-full border text-[11px] font-bold',
            place === 1 ? 'border-brand/50 bg-brand/15 text-brand' : 'border-line bg-base/50 text-mute'
          )}
        >
          {place === 1 ? <Crown size={13} /> : String(place)}
        </span>
        <MovementBadge row={row} previousWindow={previousWindow} />
      </div>

      <RowAvatar row={row} size="lg" />

      <div className="min-w-0">
        <button
          type="button"
          className="no-drag max-w-full break-words text-[13px] font-semibold text-ink hover:text-brand"
          onClick={() => openEntity(row)}
        >
          {row.name}
        </button>
        <p className="text-[10px] text-mute">
          {board === 'strategies' ? (row.handle ? `@${row.handle}` : t('leaderboard.owner')) : row.handle ? `@${row.handle}` : ''}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-1">
          <RowTitle row={row} />
          <RowTick row={row} />
          {row.vip ? <Chip tone="warn" icon={Crown}>VIP</Chip> : null}
        </div>
      </div>

      <div>
        <p className="hud-num text-xl font-semibold text-ink">{scoreText(board, metric, row.score)}</p>
        <p className="hud-label">{t(metricKey(board, metric))}</p>
      </div>

      <BadgeShelf row={row} />

      {row.topStrategyId && board === 'players' && row.topStrategyName ? (
        <button
          type="button"
          className="no-drag max-w-full truncate text-[10px] text-mute hover:text-brand"
          onClick={() => navigate(`/strategy/${row.topStrategyId as string}`)}
        >
          {row.topStrategyName}
        </button>
      ) : null}

      <div className="mt-auto pt-1">
        <InlineActions
          watched={watched}
          compared={compared}
          copied={copied}
          onWatch={onWatch}
          onCompare={onCompare}
          onCopy={onCopy}
        />
      </div>
    </article>
  )
}

/* ---------------------------------------------------------------- rows */

function RankRow({
  row,
  board,
  metric,
  previousWindow,
  topScore,
  me,
  watched,
  compared,
  copied,
  mapLabel,
  onWatch,
  onCompare,
  onCopy
}: {
  row: LeaderboardHubRow
  board: LeaderboardBoard
  metric: PlayerMetric
  previousWindow: LeaderboardWindow | null
  topScore: number
  me: LeaderboardHubMe | null
  watched: boolean
  compared: boolean
  copied: boolean
  mapLabel: string | null
  onWatch: () => void
  onCompare: () => void
  onCopy: () => void
}): ReactNode {
  const t = useT()
  const isMe = Boolean(me?.playerId) && me?.playerId === row.playerId
  const progress = topScore > 0 ? Math.max(3, Math.round((row.score / topScore) * 100)) : 0
  const topStrategy = row.topStrategyId && row.topStrategyName ? { id: row.topStrategyId, name: row.topStrategyName } : null

  return (
    <div
      className={cn(
        'grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2 border-t border-line/50 px-3 py-2.5 transition-colors first:border-t-0 md:grid-cols-[44px_minmax(0,1fr)_140px_110px_88px]',
        isMe && 'bg-brand/[0.055]'
      )}
    >
      <div className="text-center">
        <p className={cn('hud-num text-[15px] font-semibold', row.rank <= 3 ? 'text-brand' : 'text-ink')}>{row.rank}</p>
        <div className="mt-0.5 flex justify-center">
          <MovementBadge row={row} previousWindow={previousWindow} />
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <RowAvatar row={row} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="no-drag min-w-0 break-words text-left text-[13px] font-medium text-ink hover:text-brand"
                onClick={() => openEntity(row)}
              >
                {row.name}
              </button>
              <RowTitle row={row} />
              <RowTick row={row} />
              {row.vip ? <Chip tone="warn" icon={Crown}>VIP</Chip> : null}
              {isMe ? <Chip tone="good">{t('leaderboard.you')}</Chip> : null}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-mute">
              {board === 'strategies' ? (
                <>
                  {row.playerId ? (
                    <button
                      type="button"
                      className="no-drag break-words hover:text-ink"
                      onClick={() => navigate(`/profile/${row.playerId as string}`)}
                    >
                      {row.handle ? `@${row.handle}` : t('leaderboard.owner')}
                    </button>
                  ) : (
                    <span>{t('leaderboard.owner')}</span>
                  )}
                  {mapLabel ? <Chip tone="neutral">{mapLabel}</Chip> : null}
                  {row.isEvent ? <Chip tone="warn">{t('leaderboard.event')}</Chip> : null}
                </>
              ) : (
                <>
                  {row.handle ? <span>@{row.handle}</span> : null}
                  {topStrategy ? (
                    <button
                      type="button"
                      className="no-drag max-w-full break-words text-left hover:text-brand"
                      onClick={() => navigate(`/strategy/${topStrategy.id}`)}
                    >
                      {topStrategy.name}
                    </button>
                  ) : null}
                </>
              )}
            </div>
            {board === 'players' ? (
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-mute">
                <span>{t('leaderboard.sessions')} <b className="hud-num text-ink/80">{countText(row.sessions)}</b></span>
                <span>{t('leaderboard.steps')} <b className="hud-num text-ink/80">{countText(row.steps)}</b></span>
                <span>{t('leaderboard.coins')} <b className="hud-num text-ink/80">{countText(row.coins)}</b></span>
                <span>{t('leaderboard.publishes')} <b className="hud-num text-ink/80">{countText(row.publishes)}</b></span>
                <span>{t('leaderboard.streak')} <b className="hud-num text-ink/80">{countText(row.streak)}</b></span>
              </div>
            ) : (
              <div className="mt-1 hidden text-[10px] text-mute md:block">
                {t('leaderboard.careerStats')}: {t('leaderboard.sessions')} {countText(row.sessions)} · {t('leaderboard.steps')} {countText(row.steps)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="hidden md:block">
        <BadgeShelf row={row} />
      </div>

      <div className="text-right">
        <p className="hud-num text-[15px] font-semibold text-ink">{scoreText(board, metric, row.score)}</p>
        <p className="hud-label">{t(metricKey(board, metric))}</p>
        <div className="mt-1 ml-auto h-1 w-16 overflow-hidden rounded-full bg-panel-soft">
          <span className="block h-full rounded-full bg-brand/80" style={{ width: `${String(progress)}%` }} />
        </div>
        <div className="mt-1 flex justify-end md:hidden">
          <InlineActions
            watched={watched}
            compared={compared}
            copied={copied}
            onWatch={onWatch}
            onCompare={onCompare}
            onCopy={onCopy}
          />
        </div>
      </div>

      <div className="hidden justify-end md:flex">
        <InlineActions
          watched={watched}
          compared={compared}
          copied={copied}
          onWatch={onWatch}
          onCompare={onCompare}
          onCopy={onCopy}
        />
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- rail */

function RailSection({
  title,
  hint,
  icon: Icon,
  action,
  children
}: {
  title: string
  hint?: string
  icon: LucideIcon
  action?: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <section className="hud-panel p-3">
      <div className="mb-2 flex items-start gap-1.5">
        <Icon size={12} className="mt-0.5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <h3 className="hud-label">{title}</h3>
          {hint ? <p className="mt-0.5 text-[10px] leading-snug text-mute">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function MiniRow({
  row,
  board,
  metric,
  me,
  previousWindow,
  onUnwatch
}: {
  row: LeaderboardHubRow
  board: LeaderboardBoard
  metric: PlayerMetric
  me: LeaderboardHubMe | null
  previousWindow: LeaderboardWindow | null
  onUnwatch?: () => void
}): ReactNode {
  const t = useT()
  const isMe = Boolean(me?.playerId) && me?.playerId === row.playerId
  return (
    <div className={cn('flex items-center gap-2 border-t border-line/40 py-1.5 first:border-t-0', isMe && 'text-brand')}>
      <span className="hud-num w-6 shrink-0 text-right text-[11px] text-mute">{row.rank}</span>
      <button type="button" className="no-drag min-w-0 flex-1 break-words text-left text-[11px] font-medium text-ink hover:text-brand" onClick={() => openEntity(row)}>
        {row.name}
      </button>
      <RowTick row={row} />
      <span className="hud-num shrink-0 text-[11px] text-ink">{scoreText(board, metric, row.score)}</span>
      <span className="shrink-0">
        <MovementBadge row={row} previousWindow={previousWindow} />
      </span>
      {onUnwatch ? (
        <button
          type="button"
          className="no-drag shrink-0 text-warn"
          title={t('leaderboard.unwatch')}
          aria-label={t('leaderboard.unwatch')}
          onClick={onUnwatch}
        >
          <Star size={11} className="fill-current" />
        </button>
      ) : null}
    </div>
  )
}

function ComparePanel({
  me,
  selected,
  board,
  metric,
  onRemove,
  onClear
}: {
  me: LeaderboardHubMe | null
  selected: LeaderboardHubRow[]
  board: LeaderboardBoard
  metric: PlayerMetric
  onRemove: (id: string) => void
  onClear: () => void
}): ReactNode {
  const t = useT()
  const columns = me
    ? [me, ...selected.filter((row) => row.entityId !== me.entityId)].slice(0, 3)
    : selected.slice(0, 2)

  if (selected.length === 0) {
    return (
      <RailSection title={t('leaderboard.compareTitle')} hint={t('leaderboard.compareHint')} icon={Scale}>
        <p className="text-[11px] leading-relaxed text-mute">{t('leaderboard.compareEmpty')}</p>
      </RailSection>
    )
  }

  const fields = [
    { key: 'rank', label: t('leaderboard.rankShort'), value: (row: LeaderboardHubRow) => row.rank, format: (value: number) => `#${String(value)}`, lower: true },
    { key: 'score', label: t(metricKey(board, metric)), value: (row: LeaderboardHubRow) => row.score, format: (value: number) => scoreText(board, metric, value), lower: false },
    { key: 'sessions', label: t('leaderboard.sessions'), value: (row: LeaderboardHubRow) => row.sessions, format: countText, lower: false },
    { key: 'steps', label: t('leaderboard.steps'), value: (row: LeaderboardHubRow) => row.steps, format: countText, lower: false },
    { key: 'coins', label: t('leaderboard.coins'), value: (row: LeaderboardHubRow) => row.coins, format: countText, lower: false },
    { key: 'publishes', label: t('leaderboard.publishes'), value: (row: LeaderboardHubRow) => row.publishes, format: countText, lower: false },
    { key: 'streak', label: t('leaderboard.streak'), value: (row: LeaderboardHubRow) => row.streak, format: countText, lower: false },
    { key: 'activeDays', label: t('leaderboard.activeDays'), value: (row: LeaderboardHubRow) => row.activeDays, format: countText, lower: false }
  ]

  return (
    <RailSection
      title={t('leaderboard.compareTitle')}
      hint={t('leaderboard.compareHint')}
      icon={Scale}
      action={
        <button type="button" className="no-drag text-[10px] text-mute hover:text-ink" onClick={onClear}>
          {t('leaderboard.clear')}
        </button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[17rem] border-collapse text-[10px]">
          <thead>
            <tr>
              <th className="w-16 pb-1 text-left font-normal text-mute" />
              {columns.map((row) => (
                <th key={row.entityId} className="px-1 pb-1 text-left font-medium align-bottom">
                  <div className="flex items-start gap-1">
                    <span className="min-w-0 break-words text-ink">{row.entityId === me?.entityId ? t('leaderboard.you') : row.name}</span>
                    {row.entityId !== me?.entityId ? (
                      <button
                        type="button"
                        className="no-drag mt-0.5 shrink-0 text-mute hover:text-danger"
                        title={t('leaderboard.clear')}
                        aria-label={t('leaderboard.clear')}
                        onClick={() => onRemove(row.entityId)}
                      >
                        <X size={10} />
                      </button>
                    ) : null}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => {
              const values = columns.map((row) => field.value(row))
              const best = field.lower ? Math.min(...values) : Math.max(...values)
              return (
                <tr key={field.key} className="border-t border-line/40">
                  <td className="py-1 pr-2 text-mute">{field.label}</td>
                  {columns.map((row) => {
                    const value = field.value(row)
                    return (
                      <td key={`${field.key}-${row.entityId}`} className={cn('px-1 py-1 text-right tabular-nums', value === best ? 'font-semibold text-brand' : 'text-ink/80')}>
                        {field.format(value)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </RailSection>
  )
}

/* ---------------------------------------------------------------- page */

export function LeaderboardPage(): ReactNode {
  const t = useT()
  const language = useCatalogLanguage()
  const signedIn = useAuth(selectSignedIn)

  const [board, setBoard] = useState<LeaderboardBoard>('strategies')
  const [boardWindow, setBoardWindow] = useState<LeaderboardWindow>('all_time')
  const [metric, setMetric] = useState<PlayerMetric>('sessions')
  const [limit, setLimit] = useState(30)
  const [live, setLive] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('rank')
  const [mapFilter, setMapFilter] = useState('')
  const [eventOnly, setEventOnly] = useState(false)
  const [watchOnly, setWatchOnly] = useState(false)
  const [watched, setWatched] = useState<string[]>(() => readWatch('strategies'))
  const [compare, setCompare] = useState<string[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const searchRef = useRef<HTMLInputElement>(null)
  const copyTimer = useRef<number | null>(null)

  const hubQuery = useQuery({
    queryKey: ['leaderboard-hub', board, metric, boardWindow, limit],
    queryFn: () => fetchLeaderboardHub({ board, metric, window: boardWindow, limit }),
    refetchInterval: live ? 60_000 : false,
    retry: 1
  })
  const hub = hubQuery.data

  // 0040: the hub carries the tick, the tier and both title names, so the board is one query instead of
  // a second profile read for every distinct author on screen.
  const me = hub?.me ?? null
  const rows = hub?.rows ?? []

  const mapsQuery = useQuery({
    queryKey: ['catalog', 'maps'],
    queryFn: () => fetchCatalogOptions('maps'),
    staleTime: 600_000,
    enabled: board === 'strategies'
  })

  const maps = mapsQuery.data ?? []
  const mapNames = useMemo(() => new Map<string, CatalogOption>(maps.map((option) => [option.key, option])), [maps])

  useEffect(() => {
    setWatched(readWatch(board))
    setCompare([])
    setWatchOnly(false)
    setSearch('')
    setMapFilter('')
    setEventOnly(false)
    setSort('rank')
  }, [board])

  useEffect(() => {
    setCompare([])
  }, [metric, boardWindow])

  useEffect(() => {
    if (!live || hubQuery.dataUpdatedAt === 0) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [live, hubQuery.dataUpdatedAt])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      if (event.key === '/' && !typing) {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if (event.key === 'Escape' && target === searchRef.current && search.length > 0) {
        setSearch('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [search])

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    }
  }, [])

  const flashCopied = useCallback((key: string) => {
    setCopied(key)
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(null), 1700)
  }, [])

  const copyText = (text: string, key: string): void => {
    if (!navigator.clipboard) return
    void navigator.clipboard.writeText(text).then(() => flashCopied(key)).catch(() => undefined)
  }

  const toggleWatch = useCallback(
    (id: string) => {
      setWatched((previous) => {
        const next = previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id]
        try {
          localStorage.setItem(watchKey(board), JSON.stringify(next))
        } catch {
          // storage is best-effort; the in-memory list still works
        }
        return next
      })
    },
    [board]
  )

  const toggleCompare = useCallback((id: string) => {
    setCompare((previous) => {
      if (previous.includes(id)) return previous.filter((entry) => entry !== id)
      if (previous.length >= 2) return [...previous.slice(1), id]
      return [...previous, id]
    })
  }, [])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('tr')
    const subset = rows.filter((row) => {
      if (watchOnly && !watched.includes(row.entityId)) return false
      if (board === 'strategies') {
        if (mapFilter.length > 0 && row.mapKey !== mapFilter) return false
        if (eventOnly && !row.isEvent) return false
      }
      if (query.length === 0) return true
      const haystack = [row.name, row.displayName, row.handle, row.topStrategyName, row.titleName]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join(' ')
        .toLocaleLowerCase('tr')
      return haystack.includes(query)
    })
    return [...subset].sort((a, b) => {
      switch (sort) {
        case 'score':
          return b.score - a.score || a.rank - b.rank
        case 'movement':
          return (b.movement ?? -999) - (a.movement ?? -999) || a.rank - b.rank
        case 'name':
          return a.name.localeCompare(b.name, 'tr') || a.rank - b.rank
        default:
          return a.rank - b.rank
      }
    })
  }, [rows, search, watchOnly, watched, board, mapFilter, eventOnly, sort])

  const isFiltering = search.trim().length > 0 || mapFilter.length > 0 || eventOnly || watchOnly || sort !== 'rank'
  const showPodium = !isFiltering && filtered.length >= 3
  const canShowMore = Boolean(hub && hub.rows.length >= limit && limit < 100)
  const topScore = hub?.rows[0]?.score ?? filtered[0]?.score ?? 0

  const knownRows = useMemo(() => {
    const map = new Map<string, LeaderboardHubRow>()
    const add = (list: LeaderboardHubRow[]): void => {
      for (const row of list) map.set(row.entityId, row)
    }
    add(rows)
    add(hub?.nearMe ?? [])
    add(hub?.movers.climbers ?? [])
    add(hub?.movers.fallers ?? [])
    if (hub?.me) map.set(hub.me.entityId, hub.me)
    return map
  }, [rows, hub])

  const comparedRows = compare
    .map((id) => knownRows.get(id))
    .filter((row): row is LeaderboardHubRow => row !== undefined)
  const watchedRows = watched
    .map((id) => knownRows.get(id))
    .filter((row): row is LeaderboardHubRow => row !== undefined)

  const secondsLeft =
    live && hubQuery.dataUpdatedAt > 0
      ? Math.min(60, Math.max(0, Math.ceil((60_000 - (now - hubQuery.dataUpdatedAt)) / 1000)))
      : null
  const lastUpdated = hubQuery.dataUpdatedAt > 0 ? new Date(hubQuery.dataUpdatedAt).toLocaleTimeString() : null
  const windowStart = hub?.windowStart ? new Date(hub.windowStart).toLocaleDateString() : null
  const metricLabel = t(metricKey(board, metric))

  const clearFilters = (): void => {
    setSearch('')
    setMapFilter('')
    setEventOnly(false)
    setWatchOnly(false)
    setSort('rank')
  }

  const copySummary = (): void => {
    if (!hub || !me) return
    const parts = [
      `${t('leaderboard.title')} · ${t(BOARD_LABEL[board])} · ${t(WINDOW_LABEL[boardWindow])}`,
      `#${String(me.rank)} / ${countText(hub.total)} · ${scoreText(board, metric, me.score)} ${metricLabel}`
    ]
    if (me.percentile !== null) parts.push(t('leaderboard.percentile', { value: me.percentile }))
    copyText(parts.join('\n'), 'summary')
  }

  const boardOptions = [
    { value: 'strategies' as const, label: t('leaderboard.boardStrategies'), icon: Trophy },
    { value: 'players' as const, label: t('leaderboard.boardPlayers'), icon: Users }
  ]
  const windowOptions = LEADERBOARD_WINDOWS.map((value) => ({ value, label: t(WINDOW_LABEL[value]) }))
  const metricOptions = PLAYER_METRICS.map((value) => ({ value, label: t(METRIC_LABEL[value]) }))

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('leaderboard.title')}
        subtitle={t(board === 'players' ? 'leaderboard.subtitlePlayers' : 'leaderboard.subtitleStrategies')}
        badges={
          hub ? (
            <>
              <Chip tone="brand" icon={board === 'players' ? Users : Trophy}>
                {t(board === 'players' ? 'leaderboard.totalPlayers' : 'leaderboard.totalStrategies', { count: hub.total })}
              </Chip>
              <Chip tone="neutral">{t(WINDOW_LABEL[boardWindow])}</Chip>
              {hub.previousWindow ? <Chip tone="neutral">{t('leaderboard.previousWindow', { window: t(WINDOW_LABEL[hub.previousWindow]) })}</Chip> : null}
            </>
          ) : null
        }
        actions={
          <>
            <Button size="sm" variant="ghost" disabled={!me} onClick={copySummary}>
              {copied === 'summary' ? <Check size={13} /> : <Copy size={13} />}
              <span className="hidden sm:inline">{copied === 'summary' ? t('leaderboard.copied') : t('leaderboard.copySummary')}</span>
            </Button>
            <Button size="sm" variant="ghost" busy={hubQuery.isFetching} onClick={() => void hubQuery.refetch()}>
              <RefreshCw size={13} />
              <span className="hidden sm:inline">{t('leaderboard.refresh')}</span>
            </Button>
            <Button
              size="sm"
              variant={live ? 'primary' : 'ghost'}
              onClick={() => {
                if (!live) {
                  setLive(true)
                  void hubQuery.refetch()
                } else {
                  setLive(false)
                }
              }}
            >
              {live ? <Pause size={13} /> : <Play size={13} />}
              {live
                ? secondsLeft !== null
                  ? `${t('leaderboard.live')} · ${t('leaderboard.refreshIn', { seconds: secondsLeft })}`
                  : t('leaderboard.live')
                : t('leaderboard.paused')}
            </Button>
          </>
        }
      />

      {hub ? <StandingPanel me={me} board={board} metric={metric} total={hub.total} signedIn={signedIn} /> : null}

      <section className="hud-panel space-y-2.5 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Segmented options={boardOptions} value={board} onChange={setBoard} size="sm" />
          <Segmented options={windowOptions} value={boardWindow} onChange={setBoardWindow} size="sm" />
          {board === 'players' ? (
            <Segmented options={metricOptions} value={metric} onChange={setMetric} size="sm" label={t('leaderboard.metric')} />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-mute" />
            <input
              ref={searchRef}
              className={cn(INPUT_CLASS, 'no-drag h-8 w-full pl-8 pr-8 text-xs')}
              value={search}
              placeholder={t('leaderboard.searchPlaceholder')}
              aria-label={t('leaderboard.searchPlaceholder')}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-line bg-panel-soft px-1 text-[9px] text-mute">/</kbd>
          </div>

          {board === 'strategies' ? (
            <>
              <select
                className={SELECT_CLASS}
                value={mapFilter}
                aria-label={t('leaderboard.map')}
                onChange={(event) => setMapFilter(event.target.value)}
              >
                <option value="">{t('leaderboard.allMaps')}</option>
                {maps.map((option) => (
                  <option key={option.key} value={option.key}>
                    {catalogName(option, language) ?? option.key}
                  </option>
                ))}
              </select>
              <Button size="sm" variant={eventOnly ? 'primary' : 'ghost'} onClick={() => setEventOnly((value) => !value)}>
                {t('leaderboard.eventOnly')}
              </Button>
            </>
          ) : null}

          <select
            className={SELECT_CLASS}
            value={sort}
            aria-label={t('leaderboard.sort')}
            onChange={(event) => setSort(event.target.value as SortKey)}
          >
            {SORTS.map((value) => (
              <option key={value} value={value}>
                {t(SORT_LABEL[value])}
              </option>
            ))}
          </select>

          <Button size="sm" variant={watchOnly ? 'primary' : 'ghost'} onClick={() => setWatchOnly((value) => !value)}>
            <Star size={12} className={watchOnly ? 'fill-current' : undefined} />
            {t('leaderboard.watchOnly')}
            {watched.length > 0 ? <span className="tabular-nums text-mute/80">{watched.length}</span> : null}
          </Button>

          {isFiltering ? (
            <Button size="sm" variant="subtle" onClick={clearFilters}>
              <X size={12} />
              {t('leaderboard.clearFilters')}
            </Button>
          ) : null}
        </div>
      </section>

      {hubQuery.isError ? (
        <StateError detail={hubQuery.error instanceof Error ? hubQuery.error.message : String(hubQuery.error)} onRetry={() => void hubQuery.refetch()} busy={hubQuery.isFetching} />
      ) : null}

      {hubQuery.isPending ? (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-3">
            <div className="grid gap-2.5 md:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <div key={index} className="hud-panel h-44 animate-pulse bg-panel-soft/40" />
              ))}
            </div>
            <div className="hud-panel p-3">
              <StateLoading count={7} />
            </div>
          </div>
          <div className="hud-panel h-72 animate-pulse bg-panel-soft/40" />
        </div>
      ) : null}

      {hub && rows.length === 0 ? (
        <StateEmpty
          icon={board === 'players' ? Users : Trophy}
          title={t(board === 'players' ? 'leaderboard.emptyPlayers' : 'leaderboard.emptyStrategies')}
          body={t(board === 'players' ? 'leaderboard.emptyPlayersHint' : 'leaderboard.emptyStrategiesHint')}
          action={
            <Button
              size="sm"
              variant="primary"
              onClick={() => navigate(signedIn ? (board === 'players' ? '/discover' : '/import') : '/account')}
            >
              {signedIn ? t(board === 'players' ? 'leaderboard.ctaTrack' : 'leaderboard.ctaPublish') : t('auth.signIn')}
            </Button>
          }
        />
      ) : null}

      {hub && rows.length > 0 ? (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-3">
            {showPodium ? (
              <section className="space-y-2">
                <div className="flex flex-wrap items-end justify-between gap-1">
                  <h2 className="text-[13px] font-semibold tracking-wide text-ink">{t('leaderboard.podium')}</h2>
                  <span className="text-[10px] text-mute">{t('leaderboard.podiumHint')}</span>
                </div>
                <div className="grid gap-2.5 md:grid-cols-3">
                  {filtered.slice(0, 3).map((row, index) => (
                    <PodiumCard
                      key={row.entityId}
                      row={row}
                      place={index + 1}
                      board={board}
                      metric={metric}
                      previousWindow={hub.previousWindow}
                      watched={watched.includes(row.entityId)}
                      compared={compare.includes(row.entityId)}
                      copied={copied === `copy-${row.entityId}`}
                      onWatch={() => toggleWatch(row.entityId)}
                      onCompare={() => toggleCompare(row.entityId)}
                      onCopy={() => {
                        const hash = profileHash(row)
                        if (hash) copyText(hash, `copy-${row.entityId}`)
                      }}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="hud-panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h2 className="text-[13px] font-semibold tracking-wide text-ink">{t('leaderboard.ranking')}</h2>
                    <Chip tone={isFiltering ? 'warn' : 'neutral'}>
                      {t('leaderboard.showing', { shown: filtered.length, total: hub.total })}
                    </Chip>
                  </div>
                  <p className="mt-0.5 text-[10px] text-mute">{t('leaderboard.rankingHint')}</p>
                </div>
                {hub.previousWindow ? (
                  <span className="text-[10px] text-mute">{t('leaderboard.previousWindow', { window: t(WINDOW_LABEL[hub.previousWindow]) })}</span>
                ) : (
                  <span className="text-[10px] text-mute">{t('leaderboard.noPrevious')}</span>
                )}
              </div>

              <div className="hidden grid-cols-[44px_minmax(0,1fr)_140px_110px_88px] gap-2 border-b border-line/40 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-mute/70 md:grid">
                <span className="text-center">{t('leaderboard.rankShort')}</span>
                <span>{t(board === 'players' ? 'leaderboard.profile' : 'leaderboard.strategy')}</span>
                <span>{t('leaderboard.badges')}</span>
                <span className="text-right">{t(metricKey(board, metric))}</span>
                <span />
              </div>

              {filtered.length === 0 ? (
                <div className="px-3 py-8 text-center">
                  <Search size={20} className="mx-auto text-mute" />
                  <p className="mt-2 text-sm font-medium text-ink">{t('leaderboard.noResults')}</p>
                  <p className="mt-0.5 text-[11px] text-mute">{t('leaderboard.noResultsHint')}</p>
                  <Button size="sm" variant="ghost" className="mt-3" onClick={clearFilters}>
                    {t('leaderboard.clearFilters')}
                  </Button>
                </div>
              ) : (
                <RevealList count={Math.min(filtered.length, 12)}>
                  {filtered.map((row) => {
                    const mapOption = row.mapKey ? mapNames.get(row.mapKey) : undefined
                    return (
                      <RevealItem key={row.entityId}>
                        <RankRow
                          row={row}
                          board={board}
                          metric={metric}
                          previousWindow={hub.previousWindow}
                          topScore={topScore}
                          me={me}
                          watched={watched.includes(row.entityId)}
                          compared={compare.includes(row.entityId)}
                          copied={copied === `copy-${row.entityId}`}
                          mapLabel={mapOption ? catalogName(mapOption, language) ?? mapOption.key : row.mapKey}
                          onWatch={() => toggleWatch(row.entityId)}
                          onCompare={() => toggleCompare(row.entityId)}
                          onCopy={() => {
                            const hash = profileHash(row)
                            if (hash) copyText(hash, `copy-${row.entityId}`)
                          }}
                        />
                      </RevealItem>
                    )
                  })}
                </RevealList>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/50 px-3 py-2 text-[10px] text-mute">
                <span>{t('leaderboard.showing', { shown: filtered.length, total: hub.total })}</span>
                <div className="flex items-center gap-2">
                  {lastUpdated ? <span>{t('leaderboard.lastUpdated', { time: lastUpdated })}</span> : null}
                  {canShowMore ? (
                    <Button size="sm" variant="ghost" busy={hubQuery.isFetching} onClick={() => setLimit((value) => Math.min(100, value + 30))}>
                      <ChevronDown size={12} />
                      {t('leaderboard.showMore')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </section>
          </div>

          <aside className="min-w-0 space-y-3">
            {me && hub.nearMe.length > 0 ? (
              <RailSection title={t('leaderboard.nearMe')} hint={t('leaderboard.nearMeHint')} icon={Users}>
                {hub.nearMe.map((row) => (
                  <MiniRow key={row.entityId} row={row} board={board} metric={metric} me={me} previousWindow={hub.previousWindow} />
                ))}
              </RailSection>
            ) : null}

            <RailSection title={t('leaderboard.movers')} icon={ArrowUp}>
              {hub.previousWindow === null || (hub.movers.climbers.length === 0 && hub.movers.fallers.length === 0) ? (
                <p className="text-[11px] text-mute">{t('leaderboard.noMovers')}</p>
              ) : (
                <div className="space-y-2">
                  <p className="hud-label text-good">{t('leaderboard.climbers')}</p>
                  {hub.movers.climbers.length === 0 ? <p className="text-[10px] text-mute">{t('leaderboard.noMovers')}</p> : null}
                  {hub.movers.climbers.map((row) => (
                    <MiniRow key={row.entityId} row={row} board={board} metric={metric} me={me} previousWindow={hub.previousWindow} />
                  ))}
                  <p className="hud-label pt-1 text-danger">{t('leaderboard.fallers')}</p>
                  {hub.movers.fallers.length === 0 ? <p className="text-[10px] text-mute">{t('leaderboard.noMovers')}</p> : null}
                  {hub.movers.fallers.map((row) => (
                    <MiniRow key={row.entityId} row={row} board={board} metric={metric} me={me} previousWindow={hub.previousWindow} />
                  ))}
                </div>
              )}
            </RailSection>

            <ComparePanel me={me} selected={comparedRows} board={board} metric={metric} onRemove={toggleCompare} onClear={() => setCompare([])} />

            <RailSection title={t('leaderboard.watchlist')} hint={t('leaderboard.watchlistHint')} icon={Star}>
              {watchedRows.length === 0 ? (
                <p className="text-[11px] text-mute">{t('leaderboard.watchlistEmpty')}</p>
              ) : (
                watchedRows.map((row) => (
                  <MiniRow
                    key={row.entityId}
                    row={row}
                    board={board}
                    metric={metric}
                    me={me}
                    previousWindow={hub.previousWindow}
                    onUnwatch={() => toggleWatch(row.entityId)}
                  />
                ))
              )}
            </RailSection>

            <RailSection title={t('leaderboard.howTitle')} icon={Info}>
              <p className="text-[11px] leading-relaxed text-mute">{t(board === 'players' ? 'leaderboard.howPlayers' : 'leaderboard.howStrategies')}</p>
              <p className="mt-1.5 text-[10px] leading-relaxed text-mute/80">{t('leaderboard.howMovement')}</p>
            </RailSection>

            <RailSection title={t('leaderboard.metaTitle')} icon={Info}>
              <dl className="space-y-1.5 text-[10px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-mute">{t('leaderboard.totalLabel')}</dt>
                  <dd className="hud-num text-ink">{countText(hub.total)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-mute">{t('leaderboard.windowLabel')}</dt>
                  <dd className="text-ink">{t(WINDOW_LABEL[boardWindow])}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-mute">{t('leaderboard.previousLabel')}</dt>
                  <dd className="text-ink">{hub.previousWindow ? t(WINDOW_LABEL[hub.previousWindow]) : t('leaderboard.noPrevious')}</dd>
                </div>
                {windowStart ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-mute">{t('leaderboard.windowStartLabel')}</dt>
                    <dd className="text-ink">{windowStart}</dd>
                  </div>
                ) : null}
                {lastUpdated ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-mute">{t('leaderboard.lastUpdatedLabel')}</dt>
                    <dd className="text-ink">{lastUpdated}</dd>
                  </div>
                ) : null}
              </dl>
            </RailSection>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
