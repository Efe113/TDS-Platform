import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDownToLine, Check, Copy, Filter, Search, StickyNote, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { StepHealthEntry, StepMark, StrategyStep } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { actionKey } from '../../lib/actions'
import { humanTowerLabel } from '../../lib/text'
import { Badge, Button, Card, EmptyState, INPUT_CLASS, Row, cn } from '../../components/ui'
import { StateEmpty } from '../../components/ui/states'

function stepHaystack(step: StrategyStep, actionLabel: string): string {
  return [
    String(step.stepNo),
    actionLabel,
    humanTowerLabel(step.towerKey) ?? '',
    step.towerKey ?? '',
    step.spec ?? '',
    step.note ?? '',
    step.raw
  ]
    .join(' ')
    .toLocaleLowerCase()
}

interface StepListProps {
  steps: StrategyStep[]
  /** The step the overlay is on while this document is the tracked one; null hides the tracker. */
  currentIndex?: number | null
  onJump?: ((index: number) => void) | null
  /** Retry telemetry and verdict counts per step, from the 0023 step_health RPC. */
  health?: StepHealthEntry[]
  marks?: StepMark[]
  busy?: boolean
  onRate?: ((stepNo: number, verdict: 'worked' | 'stuck') => void) | null
  onMark?: ((stepNo: number, note: string) => void) | null
}

export function StepList({
  steps,
  currentIndex = null,
  onJump,
  health = [],
  marks = [],
  busy = false,
  onRate = null,
  onMark = null
}: StepListProps): ReactNode {
  const t = useT()
  const [query, setQuery] = useState('')
  const [unresolvedOnly, setUnresolvedOnly] = useState(false)
  const [copied, setCopied] = useState(false)
  const [openMark, setOpenMark] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const activeRef = useRef<HTMLLIElement>(null)

  const healthByStep = useMemo(() => new Map(health.map((entry) => [entry.stepNo, entry])), [health])
  const marksByStep = useMemo(() => new Map(marks.map((mark) => [mark.stepNo, mark.note])), [marks])
  const worst = useMemo(() => {
    let top: { stepNo: number; pressure: number } | null = null
    for (const entry of health) {
      const pressure = entry.backs + entry.resets + entry.stuck
      if (pressure > 0 && (!top || pressure > top.pressure)) top = { stepNo: entry.stepNo, pressure }
    }
    return top
  }, [health])

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => (unresolvedOnly ? step.unresolved : true))
      .filter(({ step }) => (needle.length === 0 ? true : stepHaystack(step, t(actionKey(step.action)).toLocaleLowerCase()).includes(needle)))
  }, [steps, query, unresolvedOnly, t])

  // Following the overlay is the whole point of showing the cursor here.
  useEffect(() => {
    if (currentIndex === null) return
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [currentIndex])

  // Opening a note seeds the draft from the stored one, so the textarea is never empty by accident.
  const toggleMark = (stepNo: number): void => {
    if (openMark === stepNo) {
      setOpenMark(null)
      return
    }
    setDraft(marksByStep.get(stepNo) ?? '')
    setOpenMark(stepNo)
  }

  const copyAll = (): void => {    const text = steps.map((step) => `${String(step.stepNo)}. ${step.raw}`).join('\n')
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    })
  }

  const tracker = onJump ? (
    <div className="space-y-2">
      <Row className="gap-2">
        <div className="relative min-w-48 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
          <input
            className={cn(INPUT_CLASS, 'no-drag py-1.5 pl-8 text-xs')}
            placeholder={t('detail.stepFilter')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button size="sm" variant={unresolvedOnly ? 'primary' : 'ghost'} onClick={() => setUnresolvedOnly((current) => !current)}>
          <Filter size={13} />
          {t('detail.onlyUnresolved')}
        </Button>
        <Button size="sm" onClick={copyAll} disabled={steps.length === 0}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? t('detail.copied') : t('detail.copySteps')}
        </Button>
      </Row>
      <p className="text-[11px] text-mute">{t('detail.stepFilterHint')}</p>
      {worst ? (
        <p className="text-[11px] text-warn">
          {`${t('detail.hardestStep')}: ${String(worst.stepNo)}`}
        </p>
      ) : null}
    </div>
  ) : null

  return (
    <Card title={`${t('import.stepsTitle')} · ${t('import.stepsFound', { count: steps.length })}`}>
      <div className="space-y-3">
        {tracker}

        {steps.length === 0 ? (
          <EmptyState title={t('import.steps.empty')} />
        ) : rows.length === 0 ? (
          <StateEmpty icon={Search} title={t('discover.empty')} />
        ) : (
          <ul data-stagger className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {rows.map(({ step, index }, shown) => {
              const tower = humanTowerLabel(step.towerKey)
              const active = index === currentIndex
              const entry = healthByStep.get(step.stepNo) ?? null
              return (
                <li
                  key={String(step.stepNo)}
                  ref={active ? activeRef : undefined}
                  style={{ ['--i' as string]: String(shown) }}
                  className={cn(
                    'rounded-lg border px-3 py-2 transition-colors',
                    active ? 'border-brand bg-brand/10' : 'border-line bg-panel-soft'
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums',
                        active ? 'bg-brand text-primary-foreground' : 'bg-brand/15 text-brand'
                      )}
                    >
                      {String(step.stepNo)}
                    </span>
                    {step.waveFrom !== undefined ? (
                      <Badge tone="neutral">
                        {step.waveTo !== undefined && step.waveTo !== step.waveFrom
                          ? t('overlay.wave.range', { from: step.waveFrom, to: step.waveTo })
                          : t('overlay.wave.single', { wave: step.waveFrom })}
                      </Badge>
                    ) : null}
                    <span className="text-sm font-medium">{t(actionKey(step.action))}</span>
                    {tower ? (
                      <span className="text-sm text-ink">
                        {tower}
                        {step.level !== undefined ? <span className="text-mute"> · Sv.{String(step.level)}</span> : null}
                        {step.count !== undefined ? <span className="text-mute"> · ×{String(step.count)}</span> : null}
                      </span>
                    ) : null}
                    {step.spec ? <Badge tone="accent">{step.spec}</Badge> : null}
                    {step.unresolved ? <Badge tone="warn">{t('overlay.unresolved')}</Badge> : null}

                    {onJump ? (
                      <Button
                        size="sm"
                        variant="subtle"
                        className="ml-auto"
                        title={t('detail.stepJump')}
                        onClick={() => onJump(index)}
                      >
                        <ArrowDownToLine size={13} />
                      </Button>
                    ) : null}
                  </div>

                  {step.note ? <p className="mt-1 text-xs text-mute">{step.note}</p> : null}
                  {step.unresolved && !tower ? (
                    <p className="mt-1 text-xs text-warn">{t('import.unresolvedTower', { value: step.raw })}</p>
                  ) : null}
                  <p className="mt-1 line-clamp-2 text-xs text-mute/80">{step.raw}</p>

                  {entry && entry.backs + entry.resets + entry.stuck + entry.worked > 0 ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {entry.backs > 0 ? <Badge tone="warn">{t('detail.healthBacks', { count: entry.backs })}</Badge> : null}
                      {entry.resets > 0 ? <Badge tone="danger">{t('detail.healthResets', { count: entry.resets })}</Badge> : null}
                      {entry.worked > 0 ? <Badge tone="good">{`${t('detail.verdictWorked')}: ${String(entry.worked)}`}</Badge> : null}
                      {entry.stuck > 0 ? <Badge tone="neutral">{`${t('detail.verdictStuck')}: ${String(entry.stuck)}`}</Badge> : null}
                    </div>
                  ) : null}

                  {marksByStep.get(step.stepNo) ? (
                    <p className="mt-1.5 rounded-md border border-brand/40 bg-brand/[0.08] px-2 py-1 text-[11px] text-ink">
                      {marksByStep.get(step.stepNo)}
                    </p>
                  ) : null}

                  {onRate || onMark ? (
                    <Row className="mt-1.5 gap-1.5">
                      {onRate ? (
                        <>
                          <Button size="sm" variant="subtle" busy={busy} onClick={() => onRate(step.stepNo, 'worked')}>
                            <ThumbsUp size={12} />
                            {t('detail.verdictWorked')}
                          </Button>
                          <Button size="sm" variant="subtle" busy={busy} onClick={() => onRate(step.stepNo, 'stuck')}>
                            <ThumbsDown size={12} />
                            {t('detail.verdictStuck')}
                          </Button>
                        </>
                      ) : null}
                      {onMark ? (
                        <Button size="sm" variant="subtle" onClick={() => toggleMark(step.stepNo)}>
                          <StickyNote size={12} />
                          {openMark === step.stepNo ? t('common.close') : t('detail.stepMarkAdd')}
                        </Button>
                      ) : null}
                    </Row>
                  ) : null}

                  {onMark && openMark === step.stepNo ? (
                    <div className="mt-1.5 space-y-1.5">
                      <textarea
                        className={cn(INPUT_CLASS, 'no-drag py-1.5 text-xs')}
                        rows={2}
                        maxLength={500}
                        placeholder={t('detail.stepMarkPlaceholder')}
                        defaultValue={marksByStep.get(step.stepNo) ?? ''}
                        onChange={(event) => setDraft(event.target.value)}
                      />
                      <Row className="gap-1.5">
                        <Button
                          size="sm"
                          variant="primary"
                          busy={busy}
                          onClick={() => {
                            const note = draft.trim().length > 0 ? draft : marksByStep.get(step.stepNo) ?? ''
                            onMark(step.stepNo, note)
                            setOpenMark(null)
                          }}
                        >
                          {t('social.post')}
                        </Button>
                        {marksByStep.has(step.stepNo) ? (
                          <Button
                            size="sm"
                            variant="danger"
                            busy={busy}
                            onClick={() => {
                              onMark(step.stepNo, '')
                              setOpenMark(null)
                            }}
                          >
                            {t('detail.stepMarkClear')}
                          </Button>
                        ) : null}
                      </Row>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}
