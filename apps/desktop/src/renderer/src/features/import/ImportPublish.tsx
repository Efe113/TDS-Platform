import type { ReactNode } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Copy,
  Keyboard,
  ListChecks,
  MonitorPlay,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  XCircle
} from 'lucide-react'
import { useT } from '../../i18n/use-t'
import { Badge, Banner, Button, EmptyState, cn } from '../../components/ui'
import { Chip, Section } from '../../components/ui/system'
import { UsageStatusCard } from '../usage/UsageStatusCard'
import { ImportChecklist } from './ImportChecklist'
import { publishReadiness, type ImportTab, type Readiness } from './import-draft'

export interface OwnStrategy {
  id: string
  name: string
  status: string
  slug: string
}

export interface ImportPublishProps {
  ir: StrategyMetaForPublish
  readiness: Readiness
  signedIn: boolean
  duplicate: { name: string; status: string } | null
  own: OwnStrategy[] | undefined
  ownLoading: boolean
  ownError: string | null
  onRefreshOwn: () => void
  publishedId: string | null
  started: boolean
  overlayVisible: boolean
  startBusy: boolean
  startError: string | null
  publishBusy: boolean
  publishError: { friendly: string; raw: string } | null
  onStart: () => void
  onToggleOverlay: () => void
  onPublish: () => void
  onCopySummary: () => void
  summaryCopied: boolean
  onGoToTab: (tab: ImportTab) => void
  onOpenProfile: () => void
  onOpenAccount: () => void
  onOpenDiscover: () => void
  onOpenDrafts: () => void
}

interface StrategyMetaForPublish {
  name: string
  steps: number
  source: string
  sha?: string
}

export function ImportPublish({
  ir,
  readiness,
  signedIn,
  duplicate,
  own,
  ownLoading,
  ownError,
  onRefreshOwn,
  publishedId,
  started,
  overlayVisible,
  startBusy,
  startError,
  publishBusy,
  publishError,
  onStart,
  onToggleOverlay,
  onPublish,
  onCopySummary,
  summaryCopied,
  onGoToTab,
  onOpenProfile,
  onOpenAccount,
  onOpenDiscover,
  onOpenDrafts
}: ImportPublishProps): ReactNode {
  const t = useT()
  const publish = publishReadiness(readiness, { signedIn, duplicate })
  const trackingBlockers = readiness.blockers
  const canTrack = trackingBlockers.length === 0
  const canPublish = publish.blockers.length === 0 && publishedId === null
  const nameOf = (entry: OwnStrategy): boolean =>
    entry.name.trim().toLocaleLowerCase() === ir.name.trim().toLocaleLowerCase()

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <Section
          title={t('import.v2.publish.preflightTitle')}
          hint={t('import.v2.publish.preflightHint')}
          aside={
            <Chip tone={publish.blockers.length === 0 ? 'good' : 'danger'} icon={ListChecks}>
              {t('import.v2.publish.readyScore', { score: publish.score })}
            </Chip>
          }
        >
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-panel-soft">
            <div
              className={cn('h-full rounded-full transition-all', publish.blockers.length === 0 ? 'bg-good' : 'bg-warn')}
              style={{ width: `${String(publish.score)}%` }}
            />
          </div>
          {publish.blockers.length === 0 ? (
            <Banner tone="good" title={t('import.v2.publish.readyTitle')}>
              {t('import.v2.publish.readyBody')}
            </Banner>
          ) : (
            <Banner tone="warn" title={t('import.v2.publish.blockedTitle')}>
              {t('import.v2.publish.blockedBody', { count: publish.blockers.length })}
            </Banner>
          )}
          <div className="mt-3">
            <ImportChecklist
              checks={publish.checks}
              onGo={(id) => {
                if (id === 'signedIn') {
                  onOpenAccount()
                  return
                }
                onGoToTab(
                  id === 'inventory' || id === 'inventoryKeys'
                    ? 'content'
                    : id === 'unresolved'
                      ? 'steps'
                      : 'overview'
                )
              }}
            />
          </div>
        </Section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t('import.v2.publish.trackTitle')} hint={t('import.v2.publish.trackHint')}>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" busy={startBusy} disabled={!canTrack} onClick={onStart}>
                <MonitorPlay size={14} />
                {t('import.startTracking')}
              </Button>
              <Button variant="ghost" onClick={onToggleOverlay} disabled={!started}>
                {overlayVisible ? t('common.hide') : t('common.show')}
              </Button>
              {started ? (
                <Chip tone="good" icon={BadgeCheck}>
                  {t('import.v2.publish.trackingActive')}
                </Chip>
              ) : null}
              {overlayVisible ? <Chip tone="brand" icon={MonitorPlay}>{t('import.v2.publish.overlayOn')}</Chip> : null}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-mute">{t('import.startTrackingHint')}</p>
            {!canTrack ? <p className="mt-1 text-[10px] text-warn">{t('import.v2.publish.startBlocked')}</p> : null}
            {startError ? (
              <Banner tone="danger" title={t('common.errorTitle')}>
                {startError}
              </Banner>
            ) : null}
            {started ? (
              <div className="mt-3">
                <UsageStatusCard />
              </div>
            ) : null}
          </Section>

          <Section title={t('import.v2.publish.publishTitle')} hint={t('import.v2.publish.publishHint')}>
            {publishedId !== null ? (
              <div className="space-y-2">
                <Banner tone="good" title={t('publish.submitted')}>{t('import.v2.publish.publishedBody')}</Banner>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="primary" onClick={onOpenDiscover}>
                    {t('import.v2.publish.openDiscover')}
                    <ArrowRight size={12} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onOpenProfile}>
                    <UserRound size={12} />
                    {t('import.v2.publish.openProfile')}
                  </Button>
                </div>
                <p className="break-all font-mono text-[9px] text-mute">{publishedId}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {!signedIn ? (
                  <div className="rounded-lg border border-warn/30 bg-warn/[0.06] px-3 py-2">
                    <p className="text-[11px] text-warn">{t('import.v2.publish.signedOut')}</p>
                    <Button size="sm" variant="primary" className="mt-2" onClick={onOpenAccount}>
                      <UserRound size={12} />
                      {t('import.v2.publish.signIn')}
                    </Button>
                  </div>
                ) : null}
                {duplicate ? (
                  <Banner tone="warn" title={t('import.v2.publish.duplicateTitle')}>
                    {t('import.v2.publish.duplicateBody', { name: duplicate.name, status: duplicate.status })}
                  </Banner>
                ) : null}
                <Button
                  variant="primary"
                  busy={publishBusy}
                  disabled={!canPublish}
                  onClick={onPublish}
                >
                  <Send size={13} />
                  {t('publish.action')}
                </Button>
                {!canPublish ? (
                  <p className="text-[10px] leading-relaxed text-mute">
                    {publishedId === null && publish.blockers.length > 0
                      ? t('import.v2.publish.publishBlocked', { count: publish.blockers.length })
                      : t('import.v2.publish.publishHint')}
                  </p>
                ) : null}
                {publishError ? (
                  <Banner tone="danger" title={t('common.errorTitle')}>
                    <p>{publishError.friendly}</p>
                    {publishError.raw !== publishError.friendly ? (
                      <p className="mt-1 break-words text-[10px] text-mute">{publishError.raw}</p>
                    ) : null}
                  </Banner>
                ) : null}
              </div>
            )}
          </Section>
        </div>

        <Section title={t('import.v2.publish.summaryTitle')} hint={t('import.v2.publish.summaryHint')}>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onCopySummary}>
              {summaryCopied ? <Check size={12} /> : <Copy size={12} />}
              {summaryCopied ? t('import.v2.publish.summaryCopied') : t('import.v2.copySummary')}
            </Button>
            <Button size="sm" variant="subtle" onClick={() => onGoToTab('steps')}>
              <ListChecks size={12} />
              {t('import.v2.tipSteps')}
            </Button>
            <Button size="sm" variant="subtle" onClick={onOpenDrafts}>
              {t('import.v2.openDrafts')}
            </Button>
          </div>
          <dl className="mt-3 grid gap-x-4 gap-y-1 text-[10px] sm:grid-cols-2">
            <div className="flex justify-between gap-2 border-b border-line/40 pb-1">
              <dt className="text-mute">{t('import.field.name')}</dt>
              <dd className="min-w-0 truncate text-ink">{ir.name}</dd>
            </div>
            <div className="flex justify-between gap-2 border-b border-line/40 pb-1">
              <dt className="text-mute">{t('import.stat.steps')}</dt>
              <dd className="hud-num text-ink">{String(ir.steps)}</dd>
            </div>
            <div className="flex justify-between gap-2 border-b border-line/40 pb-1">
              <dt className="text-mute">{t('import.field.source')}</dt>
              <dd className="font-mono text-ink">{ir.source}</dd>
            </div>
            <div className="flex justify-between gap-2 border-b border-line/40 pb-1">
              <dt className="text-mute">SHA</dt>
              <dd className="font-mono text-ink">{ir.sha ? `${ir.sha.slice(0, 12)}…` : t('common.none')}</dd>
            </div>
          </dl>
        </Section>
      </div>

      <aside className="min-w-0 space-y-4">
        <Section
          title={t('import.v2.publish.ownTitle')}
          hint={t('import.v2.publish.ownHint')}
          aside={
            <Button size="sm" variant="subtle" onClick={onRefreshOwn} title={t('import.v2.publish.ownRefresh')}>
              <RefreshCw size={12} className={ownLoading ? 'animate-spin' : undefined} />
            </Button>
          }
        >
          {!signedIn ? (
            <p className="text-[11px] text-mute">{t('import.v2.publish.ownSignedOut')}</p>
          ) : ownLoading && !own ? (
            <p className="text-[11px] text-mute">{t('common.loading')}</p>
          ) : ownError ? (
            <Banner tone="warn" title={t('import.v2.publish.ownError')}>
              <span className="break-words">{ownError}</span>
            </Banner>
          ) : !own || own.length === 0 ? (
            <EmptyState title={t('import.v2.publish.ownEmpty')} />
          ) : (
            <ul className="space-y-1.5">
              {own.slice(0, 8).map((entry) => {
                const isDuplicate = nameOf(entry) && entry.id !== publishedId
                return (
                  <li
                    key={entry.id}
                    className={cn(
                      'rounded-lg border px-2.5 py-1.5',
                      isDuplicate ? 'border-danger/40 bg-danger/[0.05]' : 'border-line bg-panel-soft/60'
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      {isDuplicate ? <XCircle size={11} className="shrink-0 text-danger" /> : <ShieldCheck size={11} className="shrink-0 text-mute" />}
                      <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{entry.name}</span>
                      <Badge tone={isDuplicate ? 'danger' : 'neutral'}>{entry.status}</Badge>
                    </div>
                    {isDuplicate ? <p className="mt-0.5 text-[9px] text-danger">{t('import.v2.publish.duplicateBadge')}</p> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section title={t('import.v2.publish.shortcutsTitle')}>
          <ul className="space-y-1.5 text-[10px] text-mute">
            <li className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Keyboard size={11} className="text-brand" />
                {t('import.v2.publish.shortcutSearch')}
              </span>
              <kbd className="rounded border border-line bg-panel-soft px-1.5 py-0.5 font-mono text-[9px]">/</kbd>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Sparkles size={11} className="text-brand" />
                {t('import.v2.publish.shortcutStart')}
              </span>
              <kbd className="rounded border border-line bg-panel-soft px-1.5 py-0.5 font-mono text-[9px]">Ctrl ↵</kbd>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span>{t('import.v2.publish.shortcutEscape')}</span>
              <kbd className="rounded border border-line bg-panel-soft px-1.5 py-0.5 font-mono text-[9px]">Esc</kbd>
            </li>
          </ul>
          <p className="mt-2 flex items-start gap-1 text-[10px] leading-relaxed text-mute">
            <Check size={11} className="mt-0.5 shrink-0 text-good" />
            {t('import.v2.publish.shortcutNote')}
          </p>
        </Section>
      </aside>
    </div>
  )
}
