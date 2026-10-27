import type { ReactNode } from 'react'
import { BookmarkCheck, BookmarkPlus, Check, GitCompareArrows, TrendingUp, Users } from 'lucide-react'
import { motion } from 'framer-motion'
import { formatWaveRange, type SearchRow } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { difficultyEntry, playerCountKey, useCatalogLanguage } from '../../lib/catalog-labels'
import { relativeTime } from '../../lib/text'
import { Badge, Button, Card, Row, cn } from '../../components/ui'
import { VerifiedBadge } from '../../components/brand/verified-badge'
import type { BadgeTone } from '../../lib/catalog-labels'

export interface StrategyCardProps {
  row: SearchRow
  mapName: string | null
  signedIn: boolean
  favoriteBusy: boolean
  onOpen: (row: SearchRow) => void
  onToggleFavorite: (row: SearchRow) => void
  /** `list` is the dense reading mode; the grid card is the browsing one. */
  layout?: 'grid' | 'list'
  /** Compare selection: the card turns into a pick instead of a destination. */
  selected?: boolean
  onToggleCompare?: (row: SearchRow) => void
  compareDisabled?: boolean
}

/**
 * The difficulty tone drawn on the card edge. A board is scanned by colour first and by text second, and
 * the badge rail only says the word when the reader already stopped to look.
 */
const TONE_RAIL: Record<BadgeTone, string> = {
  neutral: 'bg-line',
  accent: 'bg-brand',
  warn: 'bg-warn/80',
  danger: 'bg-danger/80',
  good: 'bg-good/80'
}

function RatingBar({ average, count }: { average: number; count: number }): ReactNode {
  const t = useT()
  const filled = Math.max(0, Math.min(5, average))
  return (
    <span className="inline-flex items-center gap-1.5" title={`${t('social.average')}: ${average.toFixed(2)}`}>
      <span className="flex gap-0.5" aria-hidden>
        {[0, 1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className={cn('h-1.5 w-3 rounded-full', index + 1 <= Math.round(filled) ? 'bg-brand' : 'bg-panel-soft')}
          />
        ))}
      </span>
      <span className="tabular-nums">
        {`${average.toFixed(1)} · ${String(count)}`}
      </span>
    </span>
  )
}

export function StrategyCard({
  row,
  mapName,
  signedIn,
  favoriteBusy,
  onOpen,
  onToggleFavorite,
  layout = 'grid',
  selected = false,
  onToggleCompare,
  compareDisabled = false
}: StrategyCardProps): ReactNode {
  const t = useT()
  const language = useCatalogLanguage()
  const waves = formatWaveRange(row.wave_from, row.wave_to)
  const difficulty = difficultyEntry(row.difficulty)
  const playerKey = playerCountKey(row.player_count)
  const playerLabel = playerKey ? t(playerKey) : row.player_count
  const list = layout === 'list'

  const favorite = (
    <motion.span
      key={row.is_favorited ? 'on' : 'off'}
      initial={{ scale: 0.86 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 460, damping: 22 }}
      className="inline-flex"
    >
      <Button
        variant={row.is_favorited ? 'primary' : 'ghost'}
        size="sm"
        busy={favoriteBusy}
        disabled={!signedIn}
        title={signedIn ? undefined : t('discover.needsSignIn')}
        onClick={() => onToggleFavorite(row)}
      >
        {row.is_favorited ? <BookmarkCheck size={14} /> : <BookmarkPlus size={14} />}
        {row.is_favorited ? t('discover.favoriteRemove') : t('discover.favoriteAdd')}
      </Button>
    </motion.span>
  )

  const chips = (
    <Row className="gap-1.5">
      {row.is_event_strategy ? <Badge tone="warn">{t('overlay.eventRibbon')}</Badge> : null}
      <Badge tone={difficulty.tone}>{difficulty.labelKey ? t(difficulty.labelKey) : row.difficulty}</Badge>
      {row.game_mode !== 'unknown' ? <Badge tone="neutral">{row.game_mode}</Badge> : null}
      {mapName ? <Badge tone="neutral">{mapName}</Badge> : null}
      {row.player_count && row.player_count !== 'any' ? (
        <Badge tone="neutral" className="gap-1">
          <Users size={11} />
          {playerLabel}
        </Badge>
      ) : null}
      {/* trend_7d came back from 0023 and was only ever drawn in the compare table. */}
      {row.trend_7d > 0 ? (
        <Badge tone="good" className="gap-1">
          <TrendingUp size={11} />
          {t('discover.trendRuns', { count: row.trend_7d })}
        </Badge>
      ) : null}
    </Row>
  )

  const facts = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mute">
      {waves ? <span>{waves}</span> : null}
      <span>{t('detail.usedCount', { count: row.times_used })}</span>
      {row.rating_count > 0 && row.rating_avg !== null ? <RatingBar average={row.rating_avg} count={row.rating_count} /> : null}
      <span title={new Date(row.updated_at).toLocaleString()}>{relativeTime(row.updated_at, language)}</span>
    </div>
  )

  const compareToggle = onToggleCompare ? (
    <button
      type="button"
      aria-pressed={selected}
      title={t('discover.compareSelect')}
      disabled={compareDisabled && !selected}
      onClick={() => onToggleCompare(row)}
      className={cn(
        'no-drag flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors',
        selected
          ? 'border-brand bg-brand text-primary-foreground'
          : 'border-line bg-panel-soft text-mute hover:border-brand/60 hover:text-ink',
        compareDisabled && !selected && 'cursor-not-allowed opacity-40'
      )}
    >
      {selected ? <Check size={12} /> : <GitCompareArrows size={12} />}
    </button>
  ) : null

  const title = (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="no-drag min-w-0 flex-1 text-left transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      {/* The tier belongs to the author, so the mark sits with the name, not in the badge rail. */}
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm font-semibold leading-snug">{row.name}</span>
        <VerifiedBadge
          show={row.author_verified}
          tier={row.author_corporate ? 'corporate' : 'verified'}
          size="sm"
          label={t(row.author_corporate ? 'discover.corporate' : 'discover.verified')}
        />
      </span>
      {row.subtitle ? <span className="mt-0.5 block truncate text-xs text-mute">{row.subtitle}</span> : null}
    </button>
  )

  const rail = <span aria-hidden className={cn('pointer-events-none absolute inset-y-0 left-0 w-[2px]', TONE_RAIL[difficulty.tone])} />

  if (list) {
    return (
      <Card lift className={cn('relative flex-row items-center gap-4 overflow-hidden py-3 pl-5', selected && 'ring-1 ring-inset ring-brand/60')}>
        {rail}
        {title}
        <div className="hidden shrink-0 flex-col items-end gap-1 lg:flex">
          {chips}
          {facts}
        </div>
        {compareToggle}
        {favorite}
      </Card>
    )
  }

  return (
    <Card lift className={cn('relative flex h-full flex-col gap-2 overflow-hidden pl-5', selected && 'ring-1 ring-inset ring-brand/60')}>
      {rail}
      <div className="flex items-start justify-between gap-2">
        {title}
        <div className="flex shrink-0 items-center gap-1.5">
          {row.is_pinned ? <Badge tone="accent">{t('discover.pinned')}</Badge> : null}
          {compareToggle}
        </div>
      </div>
      {chips}
      <div className="mt-1">{facts}</div>
      {row.credit_creator ? (
        <p className="truncate text-[11px] text-mute">{`${t('discover.creator')}: ${row.credit_creator}`}</p>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1.5">
        {favorite}
        {!signedIn ? <p className="max-w-[11rem] text-[11px] leading-snug text-mute">{t('discover.needsSignIn')}</p> : null}
      </div>
    </Card>
  )
}
