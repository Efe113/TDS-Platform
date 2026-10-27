import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Award, Check, Lock, Trophy } from 'lucide-react'
import type { MemberBadgeRow } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { navigate } from '../../lib/router'
import { useCatalogLanguage } from '../../lib/catalog-labels'
import { fetchBadgeCatalog } from '../../lib/badge-api'
import {
  criterionProgress,
  criteriaSentence,
  humanMetric,
  progressRatio,
  readCriteria,
  type CriterionRow
} from '../../lib/badge-criteria'
import { BadgeGlyph } from '../../components/brand/badge-glyph'
import { CoinAmount } from '../../components/brand/coin'
import { selectSignedIn, useAuth } from '../../store/auth-store'
import { Button, cn } from '../../components/ui'
import { Chip, Metric, MetricGrid, PageHeader, Section, Segmented } from '../../components/ui/system'
import { StateEmpty, StateError, StateLoading } from '../../components/ui/states'
import { RevealItem, RevealList } from '../../motion/primitives/Reveal'

const TIER_LABEL: Record<MemberBadgeRow['tier'], MessageKey> = {
  bronze: 'profile.tierBronze',
  silver: 'profile.tierSilver',
  gold: 'profile.tierGold',
  special: 'profile.tierSpecial'
}

const TIER_TONE: Record<MemberBadgeRow['tier'], 'neutral' | 'brand' | 'good' | 'warn'> = {
  bronze: 'neutral',
  silver: 'brand',
  gold: 'warn',
  special: 'good'
}

function BadgeCard({ badge, metrics, rows }: { badge: MemberBadgeRow; metrics: Record<string, number>; rows: CriterionRow[] }): ReactNode {
  const t = useT()
  const language = useCatalogLanguage()
  const name = language === 'en' && badge.nameEn ? badge.nameEn : badge.name
  // A manual badge is a staff decision, so a bar against a metric would promise a rule that does not
  // exist: app.evaluate_badges only ever reads the criteria of an auto badge.
  const tracked = badge.awardMode === 'auto' && rows.length > 0

  return (
    <RevealItem
      className={cn('flex gap-3 rounded-xl border px-3 py-2.5', badge.awarded ? 'border-good/40 bg-good/[0.05]' : 'border-line bg-panel-soft')}
    >
      <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-line/70 bg-base/60">
        <BadgeGlyph path={badge.iconPath} size={34} fallback={<Award size={17} className={badge.awarded ? 'text-brand' : 'text-mute'} />} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn('truncate text-[13px] font-semibold', badge.awarded ? 'text-ink' : 'text-mute')}>{name ?? badge.code}</span>
          <Chip tone={TIER_TONE[badge.tier]}>{t(TIER_LABEL[badge.tier])}</Chip>
          {badge.reward > 0 ? (
            <span title={t('badges.reward', { count: badge.reward })}>
              <CoinAmount value={badge.reward} size="sm" tone={badge.awarded ? 'good' : 'mute'} />
            </span>
          ) : null}
        </div>

        {badge.desc ? <p className="mt-1 text-[11px] leading-relaxed text-mute">{badge.desc}</p> : null}

        {tracked ? (
          <ul className="mt-2 space-y-1.5">
            {rows.map((row, index) => {
              const progress = criterionProgress(row, metrics)
              const ratio = progressRatio(row, progress.current)
              return (
                <li key={`${row.metric}-${row.op}-${String(index)}`} className="space-y-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px]">
                    <span className="truncate text-mute">{humanMetric(t, row.metric)}</span>
                    <span className={cn('tabular-nums', progress.met ? 'text-good' : 'text-mute')}>
                      {`${String(progress.current ?? '—')} / ${String(row.value)}`}
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-panel-soft">
                    <div
                      className={cn('h-full rounded-full', progress.met ? 'bg-good' : 'bg-brand/70')}
                      style={{ width: `${String(Math.max(ratio, 2))}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          {badge.awarded ? (
            <span className="flex items-center gap-1 font-medium text-good">
              <Check size={12} />
              {t('badges.owned')}
              {badge.awardedAt ? <span className="text-mute">{new Date(badge.awardedAt).toLocaleDateString()}</span> : null}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-mute">
              <Lock size={12} />
              {t('badges.notYet')}
            </span>
          )}
          {badge.awardMode === 'manual' ? <Chip tone="neutral">{t('badges.manual')}</Chip> : null}
        </div>

        {tracked ? (
          <p className="mt-1.5 text-[10px] leading-relaxed text-mute/80">
            <span className="uppercase tracking-wide">{t('badges.howEarned')}: </span>
            {criteriaSentence(t, rows)}
          </p>
        ) : null}
      </div>
    </RevealItem>
  )
}

/**
 * The member's own badge shelf (0053). The criteria sentence is built from the same declarative object
 * the award engine evaluates, so this page cannot say one thing and pay another.
 */
export function BadgesPage(): ReactNode {
  const t = useT()
  const signedIn = useAuth(selectSignedIn)

  const catalogQuery = useQuery({
    queryKey: ['badge-catalog'],
    queryFn: fetchBadgeCatalog,
    retry: 1,
    // stat_user_rollup is rebuilt by the server after a session, not in real time.
    staleTime: 30_000
  })

  const catalog = catalogQuery.data
  const badges = useMemo(() => catalog?.badges ?? [], [catalog])
  const metrics = useMemo(() => catalog?.metrics ?? {}, [catalog])
  const criteriaByCode = useMemo(() => new Map(badges.map((badge) => [badge.code, readCriteria(badge.conditions) ?? []])), [badges])

  const [tab, setTab] = useState<'mine' | 'catalog'>('catalog')
  const owned = badges.filter((badge) => badge.awarded)
  const list = tab === 'mine' && signedIn ? owned : badges
  const autoCount = badges.filter((badge) => badge.awardMode === 'auto').length
  const earned = owned.reduce((sum, badge) => sum + badge.reward, 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('badges.title')}
        subtitle={t('badges.hint')}
        badges={
          <>
            <Chip tone="brand" icon={Trophy}>{`${String(catalog?.owned ?? 0)} / ${String(catalog?.total ?? 0)}`}</Chip>
            {autoCount > 0 ? <Chip tone="neutral">{`${String(autoCount)} ${t('badges.auto')}`}</Chip> : null}
            {!signedIn ? <Chip tone="neutral">{t('discover.needsSignIn')}</Chip> : null}
          </>
        }
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/profile')}>
            {t('nav.profile')}
          </Button>
        }
      />

      <MetricGrid columns={3}>
        <Metric index={0} icon={Trophy} label={t('badges.mine')} value={String(catalog?.owned ?? 0)} hint={t('badges.owned')} />
        <Metric index={1} icon={Award} label={t('badges.catalog')} value={String(catalog?.total ?? 0)} hint={t('badges.empty')} />
        <Metric index={2} icon={Award} label={t('badges.rewardTotal')} value={<CoinAmount value={earned} size="md" />} hint={t('badges.reward', { count: earned })} />
      </MetricGrid>

      {catalogQuery.isError ? (
        <StateError detail={catalogQuery.error.message} onRetry={() => void catalogQuery.refetch()} busy={catalogQuery.isFetching} />
      ) : catalogQuery.isPending ? (
        <StateLoading variant="cards" count={3} />
      ) : (
        <Section
          title={tab === 'mine' ? t('badges.mine') : t('badges.catalog')}
          hint={t('badges.howEarned')}
          aside={
            signedIn ? (
              <Segmented
                size="sm"
                value={tab}
                onChange={(next) => setTab(next)}
                options={[
                  { value: 'catalog', label: t('badges.catalog'), icon: Award, count: badges.length },
                  { value: 'mine', label: t('badges.mine'), icon: Trophy, count: owned.length }
                ]}
              />
            ) : null
          }
        >
          {list.length === 0 ? (
            <StateEmpty icon={Award} title={t('badges.empty')} body={t('badges.hint')} />
          ) : (
            <RevealList className="grid gap-2 sm:grid-cols-2" count={Math.min(list.length, 12)}>
              {list.map((badge) => (
                <BadgeCard key={badge.code} badge={badge} metrics={metrics} rows={criteriaByCode.get(badge.code) ?? []} />
              ))}
            </RevealList>
          )}
        </Section>
      )}
    </div>
  )
}
