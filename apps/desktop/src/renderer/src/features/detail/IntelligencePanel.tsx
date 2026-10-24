import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Bell, BellRing, Gauge, History, TrendingDown, TrendingUp, Trophy } from 'lucide-react'
import { formatDuration, trendDelta } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { navigate } from '../../lib/router'
import { fetchMyJourney, fetchStrategyStats, fetchWatchUpdates, markWatchSeen, toggleWatch } from '../../lib/intelligence-api'
import { selectSignedIn, useAuth } from '../../store/auth-store'
import { useAppStore } from '../../store/app-store'
import { Badge, Button, KeyValue, Row } from '../../components/ui'
import { Metric, MetricGrid, Section } from '../../components/ui/system'
import { CountUp } from '../../motion/primitives/CountUp'

/**
 * The read-side of 0023. Everything here is computed by the database from rows the app has been
 * writing since M6, which is the point: the client cannot know how a strategy plays out for other
 * people, and a client-side estimate would disagree with the ledger the moment two devices sync.
 */

function StatValue({ value, suffix }: { value: number; suffix?: string }): ReactNode {
  return (
    <span className="flex items-baseline gap-1">
      <CountUp value={value} />
      {suffix ? <span className="text-xs font-medium text-mute">{suffix}</span> : null}
    </span>
  )
}

export function StatsPanel({ strategyId, totalSteps }: { strategyId: string; totalSteps: number }): ReactNode {
  const t = useT()
  const query = useQuery({
    queryKey: ['strategy', strategyId, 'stats'],
    queryFn: () => fetchStrategyStats(strategyId),
    enabled: strategyId.length > 0,
    retry: 1,
    staleTime: 60_000
  })

  const stats = query.data
  const delta = stats ? trendDelta(stats.weekUses, stats.previousWeekUses) : null

  return (
    <Section title={t('detail.statsTitle')} hint={stats && stats.runs === 0 ? t('detail.statsEmpty') : undefined}>
      {query.isPending ? (
        <p className="text-xs text-mute">{t('common.loading')}</p>
      ) : stats ? (
        <MetricGrid columns={4}>
          <Metric
            index={0}
            icon={Activity}
            label={t('detail.statRuns')}
            value={<CountUp value={stats.runs} />}
            hint={`${t('detail.statPeople')}: ${String(stats.uniquePeople)}`}
          />
          <Metric
            index={1}
            icon={Gauge}
            label={t('detail.statCompletion')}
            value={<StatValue value={Math.round(stats.completionPercent)} suffix="%" />}
            hint={
              totalSteps > 0
                ? `${t('detail.statAvgStep')}: ${String(Math.round(stats.averageStepsReached))}/${String(totalSteps)}`
                : undefined
            }
          />
          <Metric
            index={2}
            icon={Trophy}
            label={t('detail.statMedian')}
            value={formatDuration(stats.medianSeconds) ?? '—'}
            hint={t('detail.statMedianHint')}
          />
          <Metric
            index={3}
            icon={delta && delta.up ? TrendingUp : TrendingDown}
            label={t('detail.statWeek')}
            value={<CountUp value={stats.weekUses} />}
            delta={delta?.percent ?? null}
            hint={`${t('detail.statPrevWeek')}: ${String(stats.previousWeekUses)}`}
          />
        </MetricGrid>
      ) : null}
    </Section>
  )
}

export function JourneyPanel({ strategyId, totalSteps }: { strategyId: string; totalSteps: number }): ReactNode {
  const t = useT()
  const signedIn = useAuth(selectSignedIn)
  const activeStrategy = useAppStore((state) => state.activeStrategy)
  const query = useQuery({
    queryKey: ['strategy', strategyId, 'journey'],
    queryFn: () => fetchMyJourney(strategyId),
    enabled: signedIn && strategyId.length > 0,
    retry: 1
  })

  if (!signedIn) return null

  const journey = query.data
  const percent = journey && totalSteps > 0 ? Math.min(100, Math.round((journey.bestStep / totalSteps) * 100)) : 0
  const tracked = activeStrategy?.strategyId === strategyId

  return (
    <Section title={t('detail.journeyTitle')}>
      {journey && journey.runs > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-mute">{t('detail.journeyBest', { step: String(journey.bestStep), total: String(totalSteps) })}</span>
            <span className="font-semibold tabular-nums text-ink">{`${String(percent)}%`}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-panel-soft">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand to-brand/50 transition-[width] duration-500"
              style={{ width: `${String(percent)}%` }}
            />
          </div>
          <Row className="gap-x-6 gap-y-1">
            <KeyValue label={t('detail.journeyRuns')}>{String(journey.runs)}</KeyValue>
            <KeyValue label={t('detail.journeyBestTime')}>{formatDuration(journey.bestSeconds) ?? '—'}</KeyValue>
            <KeyValue label={t('detail.journeyLast')}>
              {journey.lastRunAt ? new Date(journey.lastRunAt).toLocaleString() : '—'}
            </KeyValue>
          </Row>
          {journey.bestStep > 0 && !tracked ? (
            <Button
              size="sm"
              onClick={() => {
                navigate(`/strategy/${strategyId}`)
              }}
            >
              <History size={13} />
              {t('detail.journeyResume')}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-mute">{t('detail.journeyNone')}</p>
      )}
    </Section>
  )
}

export function WatchButton({ strategyId }: { strategyId: string }): ReactNode {
  const t = useT()
  const signedIn = useAuth(selectSignedIn)
  const queryClient = useQueryClient()
  const updates = useQuery({
    queryKey: ['watch', 'updates'],
    queryFn: fetchWatchUpdates,
    enabled: signedIn,
    retry: 1,
    staleTime: 60_000
  })
  const watching = (updates.data ?? []).some((entry) => entry.strategyId === strategyId)

  const toggle = useMutation({
    mutationFn: () => toggleWatch(strategyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['watch'] })
    }
  })

  if (!signedIn) return null

  return (
    <Row className="gap-2">
      <Button size="sm" variant={watching ? 'primary' : 'ghost'} busy={toggle.isPending} onClick={() => toggle.mutate()}>
        {watching ? <BellRing size={14} /> : <Bell size={14} />}
        {watching ? t('detail.watchOn') : t('detail.watchOff')}
      </Button>
      {!watching ? (
        <Button
          size="sm"
          variant="subtle"
          onClick={() => void markWatchSeen(strategyId).then(() => queryClient.invalidateQueries({ queryKey: ['watch'] }))}
        >
          {t('detail.markSeen')}
        </Button>
      ) : null}
    </Row>
  )
}

/** The bell in the title area: only appears when a watched strategy actually shipped a new version. */
export function WatchUpdatesBadge(): ReactNode {
  const t = useT()
  const signedIn = useAuth(selectSignedIn)
  const updates = useQuery({
    queryKey: ['watch', 'updates'],
    queryFn: fetchWatchUpdates,
    enabled: signedIn,
    retry: 1,
    staleTime: 60_000
  })
  const rows = updates.data ?? []
  if (rows.length === 0) return null

  return (
    <Badge tone="accent" className="gap-1.5">
      <BellRing size={12} />
      {t('detail.watchCount', { count: rows.length })}
    </Badge>
  )
}
