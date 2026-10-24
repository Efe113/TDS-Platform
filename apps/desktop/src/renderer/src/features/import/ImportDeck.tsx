import type { ReactNode } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  ClipboardPaste,
  FileUp,
  FolderOpen,
  Import,
  Link2,
  ListOrdered,
  MonitorPlay,
  Play,
  Send,
  ShieldCheck,
  Sparkles,
  Wand2
} from 'lucide-react'
import type { StrategyIr } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { Badge, Button, cn } from '../../components/ui'
import { Chip } from '../../components/ui/system'
import type { ImportTab, Readiness } from './import-draft'
import type { SourceMode } from './ImportSourceConsole'

const FEATURES: Array<{ key: MessageKey; icon: typeof ShieldCheck }> = [
  { key: 'import.v2.landing.feature1', icon: ShieldCheck },
  { key: 'import.v2.landing.feature2', icon: Wand2 },
  { key: 'import.v2.landing.feature3', icon: MonitorPlay },
  { key: 'import.v2.landing.feature4', icon: Send },
  { key: 'import.v2.landing.feature5', icon: ClipboardPaste },
  { key: 'import.v2.landing.feature6', icon: ListOrdered }
]

export function ImportLanding({
  onChooseMode,
  onPickFile,
  onOpenDrafts
}: {
  onChooseMode: (mode: SourceMode) => void
  onPickFile: () => void
  onOpenDrafts: () => void
}): ReactNode {
  const t = useT()
  return (
    <section className="hud-panel relative overflow-hidden p-0">
      <div className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-brand/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -left-10 size-56 rounded-full bg-good/[0.08] blur-3xl" />
      <div className="relative grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="brand" icon={Import}>
              {t('import.v2.landing.eyebrow')}
            </Chip>
            <Chip tone="neutral" icon={Sparkles}>
              {t('import.v2.landing.tools')}
            </Chip>
          </div>
          <h2 className="mt-3 max-w-2xl text-xl leading-tight font-semibold tracking-tight text-ink">
            {t('import.v2.landing.title')}
          </h2>
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-mute">{t('import.v2.landing.body')}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => onChooseMode('link')}>
              <Link2 size={14} />
              {t('import.v2.landing.startLink')}
            </Button>
            <Button variant="ghost" onClick={() => onChooseMode('paste')}>
              <ClipboardPaste size={13} />
              {t('import.v2.landing.startPaste')}
            </Button>
            <Button variant="ghost" onClick={onPickFile}>
              <FileUp size={13} />
              {t('import.v2.landing.pickFile')}
            </Button>
            <Button variant="subtle" onClick={onOpenDrafts}>
              <FolderOpen size={13} />
              {t('import.v2.openDrafts')}
            </Button>
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-mute">
            <ShieldCheck size={11} className="mt-0.5 shrink-0 text-good" />
            {t('import.v2.landing.privacy')}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 self-start">
          {FEATURES.map((entry) => {
            const Icon = entry.icon
            return (
              <div key={entry.key} className="rounded-lg border border-line bg-panel-soft/60 px-2.5 py-2">
                <Icon size={13} className="text-brand" />
                <p className="mt-1 text-[10px] leading-snug text-ink/85">{t(entry.key)}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function ReadinessRing({ readiness }: { readiness: Readiness }): ReactNode {
  const t = useT()
  const blocked = readiness.blockers.length > 0
  const perfect = readiness.score === 100
  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative size-28">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90">
          <circle cx="60" cy="60" r="52" fill="none" strokeWidth="7" stroke="currentColor" className="text-line/60" />
          <circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            pathLength={100}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${String(readiness.score)} 100`}
            stroke="currentColor"
            className={cn('transition-all', blocked ? 'text-danger' : perfect ? 'text-good' : 'text-warn')}
          />
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <span className="text-2xl leading-none font-semibold tabular-nums text-ink">{String(readiness.score)}</span>
          <span className="mt-0.5 text-[9px] uppercase tracking-widest text-mute">/ 100</span>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] font-semibold text-ink">{t('import.v2.deck.readiness')}</p>
      <p className={cn('text-[10px]', blocked ? 'text-danger' : perfect ? 'text-good' : 'text-warn')}>
        {blocked
          ? t('import.v2.deck.blocked', { count: readiness.blockers.length })
          : perfect
            ? t('import.v2.deck.perfect')
            : t('import.v2.deck.warnings', { count: readiness.warnings.length })}
      </p>
    </div>
  )
}

const PHASES: Array<{ id: 'source' | 'review' | 'track' | 'publish'; labelKey: MessageKey; icon: typeof Import; tab: ImportTab | null }> = [
  { id: 'source', labelKey: 'import.v2.phase.source', icon: FileUp, tab: null },
  { id: 'review', labelKey: 'import.v2.phase.review', icon: Wand2, tab: 'overview' },
  { id: 'track', labelKey: 'import.v2.phase.track', icon: Play, tab: 'publish' },
  { id: 'publish', labelKey: 'import.v2.phase.publish', icon: Send, tab: 'publish' }
]

export interface ImportDeckProps {
  ir: StrategyIr
  readiness: Readiness
  errorCount: number
  sourceLabel: string
  tab: ImportTab
  started: boolean
  publishedId: string | null
  overlayVisible: boolean
  startBusy: boolean
  onStart: () => void
  onToggleOverlay: () => void
  onOpenSource: () => void
  onTab: (tab: ImportTab) => void
}

export function ImportDeck({
  ir,
  readiness,
  errorCount,
  sourceLabel,
  tab,
  started,
  publishedId,
  overlayVisible,
  startBusy,
  onStart,
  onToggleOverlay,
  onOpenSource,
  onTab
}: ImportDeckProps): ReactNode {
  const t = useT()
  const unresolved = ir.steps.filter((step) => step.unresolved).length
  const canStart = readiness.blockers.length === 0
  const phaseDone = {
    source: true,
    review: readiness.blockers.length === 0,
    track: started,
    publish: publishedId !== null
  }
  const phaseActive = {
    source: false,
    review: tab === 'overview' || tab === 'content' || tab === 'steps',
    track: tab === 'publish' && !started,
    publish: tab === 'publish' && (started || publishedId !== null)
  }

  return (
    <section className="hud-panel relative overflow-hidden p-0">
      <div className="pointer-events-none absolute -top-20 right-10 size-48 rounded-full bg-brand/10 blur-3xl" />
      <div className="relative grid gap-4 p-4 lg:grid-cols-[180px_minmax(0,1fr)_250px]">
        <ReadinessRing readiness={readiness} />

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="neutral" icon={Import}>
              {t('import.v2.deck.title')}
            </Chip>
            {started ? (
              <Chip tone="good" icon={BadgeCheck}>
                {t('import.v2.deck.tracking')}
              </Chip>
            ) : null}
            {publishedId !== null ? (
              <Chip tone="brand" icon={Send}>
                {t('import.v2.deck.published')}
              </Chip>
            ) : null}
          </div>
          <p className="mt-2 truncate text-base font-semibold text-ink">{ir.meta.name}</p>
          <p className="mt-0.5 line-clamp-1 text-[11px] text-mute">
            {ir.meta.subtitle ?? t('import.v2.deck.noSubtitle')}
            {sourceLabel.length > 0 ? <span className="text-mute/70"> · {sourceLabel}</span> : null}
          </p>

          <ol className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {PHASES.map((phase) => {
              const Icon = phase.icon
              const done = phaseDone[phase.id]
              const active = phaseActive[phase.id]
              return (
                <li key={phase.id}>
                  <button
                    type="button"
                    data-press
                    onClick={() => {
                      if (phase.id === 'source') {
                        onOpenSource()
                        return
                      }
                      if (phase.tab) onTab(phase.tab)
                    }}
                    className={cn(
                      'no-drag flex w-full items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left transition-colors',
                      active
                        ? 'border-brand/50 bg-brand/12'
                        : done
                          ? 'border-good/30 bg-good/[0.05]'
                          : 'border-line bg-panel-soft/60 hover:border-brand/40'
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-5 shrink-0 place-items-center rounded-md',
                        done ? 'bg-good/15 text-good' : active ? 'bg-brand text-primary-foreground' : 'bg-panel-soft text-mute'
                      )}
                    >
                      {done ? <BadgeCheck size={11} /> : <Icon size={11} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[10px] font-medium text-ink">{t(phase.labelKey)}</span>
                      <span className="block text-[9px] text-mute">
                        {done ? t('import.v2.phase.done') : active ? t('import.v2.phase.active') : t('import.v2.phase.waiting')}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" busy={startBusy} disabled={!canStart} onClick={onStart}>
              <Play size={13} />
              {t('import.startTracking')}
            </Button>
            <Button variant="ghost" onClick={onToggleOverlay} disabled={!started}>
              <MonitorPlay size={13} />
              {overlayVisible ? t('common.hide') : t('common.show')}
            </Button>
            <Button variant="ghost" onClick={() => onTab('publish')}>
              <Send size={13} />
              {t('import.v2.publish.publishTitle')}
              <ArrowRight size={12} />
            </Button>
            {!canStart ? <span className="text-[10px] text-warn">{t('import.v2.publish.startBlocked')}</span> : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5 self-start">
          {[
            { label: t('import.stat.steps'), value: String(ir.steps.length), tone: 'text-ink' },
            { label: t('import.v2.steps.unresolvedShort'), value: String(unresolved), tone: unresolved > 0 ? 'text-warn' : 'text-good' },
            { label: t('import.level.error'), value: String(errorCount), tone: errorCount > 0 ? 'text-danger' : 'text-good' },
            { label: t('import.level.warning'), value: String(readiness.warnings.length), tone: readiness.warnings.length > 0 ? 'text-warn' : 'text-good' }
          ].map((entry) => (
            <div key={entry.label} className="rounded-lg border border-line bg-panel-soft/60 px-2.5 py-2">
              <p className="truncate text-[9px] uppercase tracking-wide text-mute">{entry.label}</p>
              <p className={cn('mt-0.5 text-lg leading-none font-semibold tabular-nums', entry.tone)}>{entry.value}</p>
            </div>
          ))}
          <div className="col-span-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-panel-soft/60 px-2.5 py-2">
            <Badge tone={ir.inventory.length > 0 ? 'accent' : 'warn'}>
              {t('import.inventory.title')}: {String(ir.inventory.length)}
            </Badge>
            <Badge tone={ir.media.length > 0 ? 'good' : 'neutral'}>
              {t('import.stat.media')}: {String(ir.media.length)}
            </Badge>
            {overlayVisible ? <Badge tone="good">{t('import.v2.deck.overlayOn')}</Badge> : null}
          </div>
        </div>
      </div>
    </section>
  )
}
