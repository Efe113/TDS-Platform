import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ClipboardCopy,
  Copy,
  Filter,
  Layers,
  ListFilter,
  MonitorPlay,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wand2
} from 'lucide-react'
import type { StepAction, StrategyIr, StrategyStep } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { STEP_ACTIONS, actionKey } from '../../lib/actions'
import { humanTowerLabel } from '../../lib/text'
import { Badge, Button, EmptyState, INPUT_CLASS, cn } from '../../components/ui'
import { Chip, Section } from '../../components/ui/system'
import {
  newStep,
  stepFlags,
  stepInsights,
  type StepFlagId,
  type StepInsights
} from './import-draft'

type StepFilter = 'all' | 'unresolved' | 'issues' | 'noWave'

const FILTERS: Array<{ value: StepFilter; key: 'import.v2.steps.filter.all' | 'import.v2.steps.filter.unresolved' | 'import.v2.steps.filter.issues' | 'import.v2.steps.filter.noWave' }> = [
  { value: 'all', key: 'import.v2.steps.filter.all' },
  { value: 'unresolved', key: 'import.v2.steps.filter.unresolved' },
  { value: 'issues', key: 'import.v2.steps.filter.issues' },
  { value: 'noWave', key: 'import.v2.steps.filter.noWave' }
]

const FLAG_LABEL: Record<StepFlagId, 'import.v2.steps.flag.unresolved' | 'import.v2.steps.flag.noWave' | 'import.v2.steps.flag.placementNoTower' | 'import.v2.steps.flag.upgradeNoLevel' | 'import.v2.steps.flag.emptyRaw'> = {
  unresolved: 'import.v2.steps.flag.unresolved',
  noWave: 'import.v2.steps.flag.noWave',
  placementNoTower: 'import.v2.steps.flag.placementNoTower',
  upgradeNoLevel: 'import.v2.steps.flag.upgradeNoLevel',
  emptyRaw: 'import.v2.steps.flag.emptyRaw'
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function waveLabel(step: StrategyStep, t: ReturnType<typeof useT>): string | null {
  if (step.waveFrom === undefined) return null
  return step.waveTo !== undefined && step.waveTo !== step.waveFrom
    ? t('overlay.wave.range', { from: step.waveFrom, to: step.waveTo })
    : t('overlay.wave.single', { wave: step.waveFrom })
}

function stepLine(step: StrategyStep, actionLabel: string, t: ReturnType<typeof useT>): string {
  const wave = waveLabel(step, t)
  const tower = humanTowerLabel(step.towerKey)
  const detail = [tower, step.level !== undefined ? `Sv.${String(step.level)}` : undefined, step.count !== undefined ? `×${String(step.count)}` : undefined, step.spec]
    .filter(Boolean)
    .join(' · ')
  return `${String(step.stepNo)}. ${wave ? `[${wave}] ` : ''}${actionLabel}${detail ? ` — ${detail}` : ''}\n   ${step.raw}`
}

function Distribution({ insights }: { insights: StepInsights }): ReactNode {
  const t = useT()
  const maxAction = Math.max(1, ...insights.actions.slice(0, 4).map((entry) => entry.count))
  const maxTower = Math.max(1, ...insights.towers.slice(0, 4).map((entry) => entry.count))
  return (
    <Section
      title={t('import.v2.steps.distributionTitle')}
      hint={t('import.v2.steps.distributionHint')}
      aside={
        <div className="flex flex-wrap gap-1.5">
          <Chip tone={insights.unresolved === 0 ? 'good' : 'warn'} icon={Wand2}>
            {t('import.v2.steps.unresolvedChip', { count: insights.unresolved })}
          </Chip>
          <Chip tone={insights.flagged === 0 ? 'good' : 'warn'} icon={Filter}>
            {t('import.v2.steps.flaggedChip', { count: insights.flagged })}
          </Chip>
          <Chip tone={insights.withWave === insights.total ? 'good' : 'neutral'} icon={Layers}>
            {insights.span
              ? t('import.v2.steps.coverage', { withWave: insights.withWave, total: insights.total })
              : t('import.v2.steps.noCoverage')}
          </Chip>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-mute/70">
            {t('import.v2.steps.topActions')}
          </p>
          {insights.actions.length === 0 ? (
            <p className="text-[11px] text-mute">{t('common.none')}</p>
          ) : (
            <ul className="space-y-1">
              {insights.actions.slice(0, 4).map((entry) => (
                <li key={entry.action} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 truncate text-[10px] text-ink">{t(actionKey(entry.action))}</span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-panel-soft">
                    <span
                      className="block h-full rounded-full bg-brand/70"
                      style={{ width: `${String(Math.max(6, Math.round((entry.count / maxAction) * 100)))}%` }}
                    />
                  </span>
                  <span className="w-6 shrink-0 text-right text-[10px] tabular-nums text-mute">{String(entry.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-mute/70">
            {t('import.v2.steps.topTowers')}
          </p>
          {insights.towers.length === 0 ? (
            <p className="text-[11px] text-mute">{t('common.none')}</p>
          ) : (
            <ul className="space-y-1">
              {insights.towers.slice(0, 4).map((entry) => (
                <li key={entry.key} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 truncate text-[10px] text-ink">{humanTowerLabel(entry.key) ?? entry.key}</span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-panel-soft">
                    <span
                      className="block h-full rounded-full bg-good/60"
                      style={{ width: `${String(Math.max(6, Math.round((entry.count / maxTower) * 100)))}%` }}
                    />
                  </span>
                  <span className="w-6 shrink-0 text-right text-[10px] tabular-nums text-mute">{String(entry.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {insights.span ? (
        <p className="mt-3 text-[10px] text-mute">
          {t('import.v2.steps.span', { from: insights.span[0], to: insights.span[1], withWave: insights.withWave })}
        </p>
      ) : null}
    </Section>
  )
}

export interface ImportStepsProps {
  ir: StrategyIr
  onPatch: (updater: (ir: StrategyIr) => StrategyIr) => void
}

export function ImportSteps({ ir, onPatch }: ImportStepsProps): ReactNode {
  const t = useT()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StepFilter>('all')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [copied, setCopied] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const suggestions = useMemo(() => {
    const keys = new Set(ir.inventory.map((slot) => slot.towerKey))
    for (const step of ir.steps) if (step.towerKey) keys.add(step.towerKey)
    return [...keys].sort((a, b) => a.localeCompare(b))
  }, [ir.inventory, ir.steps])
  const insights = useMemo(() => stepInsights(ir.steps), [ir.steps])

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return ir.steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => {
        if (filter === 'unresolved') return step.unresolved
        if (filter === 'issues') return stepFlags(step).length > 0
        if (filter === 'noWave') return step.waveFrom === undefined
        return true
      })
      .filter(({ step }) => {
        if (needle.length === 0) return true
        return [
          String(step.stepNo),
          t(actionKey(step.action)),
          step.towerKey ?? '',
          humanTowerLabel(step.towerKey) ?? '',
          step.spec ?? '',
          step.note ?? '',
          step.raw
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(needle)
      })
  }, [ir.steps, filter, query, t])

  useEffect(() => {
    if (selectedIndex > ir.steps.length - 1) setSelectedIndex(Math.max(0, ir.steps.length - 1))
  }, [ir.steps.length, selectedIndex])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === '/' && !isTyping(event.target)) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const copy = (value: string, id: string): void => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(id)
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1600)
    })
  }

  const step = ir.steps[selectedIndex] ?? null

  const updateStep = (patch: Partial<StrategyStep>): void => {
    if (!step) return
    onPatch((current) => ({
      ...current,
      steps: current.steps.map((entry, index) =>
        index === selectedIndex ? { ...entry, ...patch, stepNo: index + 1 } : entry
      )
    }))
  }

  const renumber = (steps: StrategyStep[]): StrategyStep[] => steps.map((entry, index) => ({ ...entry, stepNo: index + 1 }))

  const addStep = (): void => {
    const next = newStep(ir.steps.length + 1)
    onPatch((current) => ({ ...current, steps: [...current.steps, { ...next, raw: t('import.v2.steps.newRaw') }] }))
    setSelectedIndex(ir.steps.length)
    setFilter('all')
  }

  const duplicateStep = (): void => {
    if (!step) return
    onPatch((current) => {
      const next = [...current.steps]
      next.splice(selectedIndex + 1, 0, {
        ...step,
        alternatives: [...step.alternatives],
        stepNo: selectedIndex + 2
      })
      return { ...current, steps: renumber(next) }
    })
    setSelectedIndex(selectedIndex + 1)
  }

  const removeStep = (): void => {
    if (!step) return
    onPatch((current) => ({
      ...current,
      steps: renumber(current.steps.filter((_, index) => index !== selectedIndex))
    }))
    setSelectedIndex(Math.max(0, Math.min(selectedIndex, ir.steps.length - 2)))
  }

  const moveStep = (delta: -1 | 1): void => {
    const target = selectedIndex + delta
    if (!step || target < 0 || target >= ir.steps.length) return
    onPatch((current) => {
      const next = [...current.steps]
      const moving = next[selectedIndex]
      const swapped = next[target]
      if (!moving || !swapped) return current
      next[selectedIndex] = swapped
      next[target] = moving
      return { ...current, steps: renumber(next) }
    })
    setSelectedIndex(target)
  }

  const resolveStep = (): void => {
    if (!step) return
    updateStep({
      unresolved: false,
      towerKey: step.towerKey ?? ir.inventory[0]?.towerKey
    })
  }

  const arrowCopy = (): void => {
    if (!step) return
    copy(stepLine(step, t(actionKey(step.action)), t), `one-${String(step.stepNo)}`)
  }

  const allCopy = (): void => {
    copy(ir.steps.map((entry) => stepLine(entry, t(actionKey(entry.action)), t)).join('\n\n'), 'all')
  }

  const filteredCount = rows.length

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <Section
          title={`${t('import.stepsTitle')} · ${t('import.stepsFound', { count: ir.steps.length })}`}
          hint={t('import.v2.steps.listHint')}
          aside={
            <div className="flex items-center gap-1">
              <Button size="sm" variant="subtle" onClick={allCopy} disabled={ir.steps.length === 0} title={t('detail.copySteps')}>
                {copied === 'all' ? <Check size={12} /> : <ClipboardCopy size={12} />}
              </Button>
              <Button size="sm" variant="primary" onClick={addStep}>
                <Plus size={12} />
                {t('import.v2.steps.add')}
              </Button>
            </div>
          }
        >
          <div className="mb-2 space-y-2">
            <div className="relative">
              <Search size={12} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-mute" />
              <input
                ref={searchRef}
                className={cn(INPUT_CLASS, 'no-drag h-8 py-1 pr-12 pl-8 text-xs')}
                value={query}
                placeholder={t('detail.stepFilter')}
                aria-label={t('detail.stepFilter')}
                onChange={(event) => setQuery(event.target.value)}
              />
              <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-line bg-panel-soft px-1 text-[9px] text-mute">
                /
              </kbd>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {FILTERS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  data-press
                  onClick={() => setFilter(entry.value)}
                  className={cn(
                    'no-drag inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] transition-colors',
                    filter === entry.value
                      ? 'border-brand/50 bg-brand/15 text-ink'
                      : 'border-line bg-panel-soft text-mute hover:text-ink'
                  )}
                >
                  <ListFilter size={9} />
                  {t(entry.key)}
                </button>
              ))}
              <span className="ml-auto text-[10px] text-mute">{`${String(filteredCount)}/${String(ir.steps.length)}`}</span>
            </div>
          </div>

          {ir.steps.length === 0 ? (
            <EmptyState title={t('import.steps.empty')} body={t('import.v2.steps.emptyHint')} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('import.v2.steps.noFiltered')} />
          ) : (
            <ul className="max-h-[560px] space-y-1.5 overflow-y-auto pr-1">
              {rows.map(({ step: row, index }) => {
                const flags = stepFlags(row)
                const active = index === selectedIndex
                return (
                  <li key={`${String(index)}-${row.stepNo}`}>
                    <button
                      type="button"
                      data-press
                      onClick={() => setSelectedIndex(index)}
                      className={cn(
                        'no-drag w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
                        active ? 'border-brand bg-brand/10' : 'border-line bg-panel-soft/60 hover:border-brand/40'
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            'grid size-6 shrink-0 place-items-center rounded-md text-[10px] font-semibold tabular-nums',
                            active ? 'bg-brand text-primary-foreground' : 'bg-brand/15 text-brand'
                          )}
                        >
                          {String(row.stepNo)}
                        </span>
                        {row.waveFrom !== undefined ? (
                          <Badge tone="neutral">{waveLabel(row, t)}</Badge>
                        ) : null}
                        <span className="text-[11px] font-medium text-ink">{t(actionKey(row.action))}</span>
                        {row.towerKey ? (
                          <span className="text-[11px] text-ink/80">
                            {humanTowerLabel(row.towerKey)}
                            {row.level !== undefined ? <span className="text-mute"> · Sv.{String(row.level)}</span> : null}
                            {row.count !== undefined ? <span className="text-mute"> · ×{String(row.count)}</span> : null}
                          </span>
                        ) : null}
                        {row.spec ? <Badge tone="accent">{row.spec}</Badge> : null}
                        {flags.length > 0 ? (
                          <span className="ml-auto flex items-center gap-1">
                            {flags.slice(0, 2).map((flag) => (
                              <Badge key={flag} tone={flag === 'unresolved' ? 'warn' : 'neutral'}>
                                {t(FLAG_LABEL[flag])}
                              </Badge>
                            ))}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-mute">{row.raw || row.note}</p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-mute">{t('import.v2.steps.keyboard')}</p>
        </Section>

        <div className="min-w-0 space-y-4">
          <Section
            title={t('import.v2.steps.editorTitle')}
            hint={t('import.v2.steps.editorHint')}
            aside={
              step ? (
                <div className="flex items-center gap-0.5">
                  <Button size="sm" variant="subtle" onClick={() => moveStep(-1)} disabled={selectedIndex <= 0} title={t('import.v2.steps.moveUp')}>
                    <ArrowUp size={12} />
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() => moveStep(1)}
                    disabled={selectedIndex >= ir.steps.length - 1}
                    title={t('import.v2.steps.moveDown')}
                  >
                    <ArrowDown size={12} />
                  </Button>
                  <Button size="sm" variant="subtle" onClick={duplicateStep} title={t('import.v2.steps.duplicate')}>
                    <Copy size={12} />
                  </Button>
                  <Button size="sm" variant="subtle" onClick={arrowCopy} title={t('import.v2.steps.copyOne')}>
                    {copied === `one-${String(step.stepNo)}` ? <Check size={12} /> : <ClipboardCopy size={12} />}
                  </Button>
                  <Button size="sm" variant="subtle" className="text-danger/80" onClick={removeStep} title={t('import.v2.steps.remove')}>
                    <Trash2 size={12} />
                  </Button>
                </div>
              ) : null
            }
          >
            {step ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <label className="space-y-1">
                    <span className="block text-[9px] uppercase tracking-wide text-mute">{t('import.v2.steps.action')}</span>
                    <select
                      className={cn(INPUT_CLASS, 'no-drag h-8 py-1 text-[11px]')}
                      value={step.action}
                      onChange={(event) => updateStep({ action: event.target.value as StepAction })}
                    >
                      {STEP_ACTIONS.map((action) => (
                        <option key={action} value={action}>
                          {t(actionKey(action))}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[9px] uppercase tracking-wide text-mute">{t('import.v2.steps.tower')}</span>
                    <input
                      list="import-step-towers"
                      className={cn(INPUT_CLASS, 'no-drag h-8 py-1 font-mono text-[11px]')}
                      value={step.towerKey ?? ''}
                      onChange={(event) => {
                        const value = event.target.value.trim().toLowerCase().replace(/\s+/g, '-')
                        updateStep({ towerKey: value || undefined, unresolved: value.length === 0 ? step.unresolved : false })
                      }}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[9px] uppercase tracking-wide text-mute">{t('import.v2.steps.level')}</span>
                    <input
                      type="number"
                      min={1}
                      className={cn(INPUT_CLASS, 'no-drag h-8 py-1 text-[11px] tabular-nums')}
                      value={step.level ?? ''}
                      onChange={(event) => {
                        const value = Math.max(1, Math.trunc(event.target.valueAsNumber))
                        updateStep({ level: Number.isFinite(value) ? value : undefined })
                      }}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[9px] uppercase tracking-wide text-mute">{t('import.v2.steps.count')}</span>
                    <input
                      type="number"
                      min={1}
                      className={cn(INPUT_CLASS, 'no-drag h-8 py-1 text-[11px] tabular-nums')}
                      value={step.count ?? ''}
                      onChange={(event) => {
                        const value = Math.max(1, Math.trunc(event.target.valueAsNumber))
                        updateStep({ count: Number.isFinite(value) ? value : undefined })
                      }}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[9px] uppercase tracking-wide text-mute">{t('import.v2.steps.waveFrom')}</span>
                    <input
                      type="number"
                      min={0}
                      className={cn(INPUT_CLASS, 'no-drag h-8 py-1 text-[11px] tabular-nums')}
                      value={step.waveFrom ?? ''}
                      onChange={(event) => {
                        const value = Math.max(0, Math.trunc(event.target.valueAsNumber))
                        updateStep({
                          waveFrom: Number.isFinite(value) ? value : undefined,
                          waveTo: Number.isFinite(value) ? step.waveTo : undefined
                        })
                      }}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[9px] uppercase tracking-wide text-mute">{t('import.v2.steps.waveTo')}</span>
                    <input
                      type="number"
                      min={0}
                      className={cn(INPUT_CLASS, 'no-drag h-8 py-1 text-[11px] tabular-nums')}
                      value={step.waveTo ?? ''}
                      onChange={(event) => {
                        const value = Math.max(0, Math.trunc(event.target.valueAsNumber))
                        updateStep({ waveTo: Number.isFinite(value) ? value : undefined })
                      }}
                    />
                  </label>
                  <label className="col-span-2 space-y-1 sm:col-span-1">
                    <span className="block text-[9px] uppercase tracking-wide text-mute">{t('import.v2.steps.spec')}</span>
                    <input
                      className={cn(INPUT_CLASS, 'no-drag h-8 py-1 text-[11px]')}
                      value={step.spec ?? ''}
                      maxLength={60}
                      onChange={(event) => updateStep({ spec: event.target.value.trim() || undefined })}
                    />
                  </label>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="block text-[9px] uppercase tracking-wide text-mute">{t('import.v2.steps.raw')}</span>
                    <textarea
                      className={cn(INPUT_CLASS, 'no-drag min-h-20 resize-y text-[11px]')}
                      value={step.raw}
                      maxLength={500}
                      onChange={(event) => updateStep({ raw: event.target.value })}
                    />
                    <span className="text-[9px] text-mute">{t('import.v2.steps.rawHint')}</span>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[9px] uppercase tracking-wide text-mute">{t('import.v2.steps.note')}</span>
                    <textarea
                      className={cn(INPUT_CLASS, 'no-drag min-h-20 resize-y text-[11px]')}
                      value={step.note ?? ''}
                      maxLength={240}
                      onChange={(event) => updateStep({ note: event.target.value.trim() || undefined })}
                    />
                    <span className="text-[9px] text-mute">{t('import.v2.steps.noteHint')}</span>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 rounded-lg border border-line bg-panel-soft px-2.5 py-1.5 text-[11px]">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-[var(--color-brand)]"
                      checked={step.unresolved}
                      onChange={(event) => updateStep({ unresolved: event.target.checked })}
                    />
                    {t('import.v2.steps.unresolvedCheck')}
                  </label>
                  {step.unresolved ? (
                    <Button size="sm" variant="ghost" onClick={resolveStep}>
                      <Wand2 size={12} />
                      {t('import.v2.steps.resolve')}
                    </Button>
                  ) : null}
                  <span className="ml-auto text-[10px] text-mute">{t('import.v2.steps.autoRenumber')}</span>
                </div>
                <datalist id="import-step-towers">
                  {suggestions.map((key) => (
                    <option key={key} value={key} />
                  ))}
                </datalist>
              </div>
            ) : (
              <EmptyState title={t('import.v2.steps.noSelection')} body={t('import.v2.steps.emptyHint')} />
            )}
          </Section>

          <Section
            title={t('import.v2.steps.previewTitle')}
            hint={t('import.v2.steps.previewHint')}
            aside={<MonitorPlay size={14} className="text-brand" />}
          >
            {step ? (
              <div className="relative overflow-hidden rounded-xl border border-brand/30 bg-base/85 p-3">
                <div className="pointer-events-none absolute -top-12 -right-10 size-32 rounded-full bg-brand/15 blur-2xl" />
                <div className="relative flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md bg-brand px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary-foreground">
                    {String(step.stepNo)}
                  </span>
                  <span className="text-[10px] text-mute">{t('import.v2.steps.of', { current: step.stepNo, total: ir.steps.length })}</span>
                  {waveLabel(step, t) ? <Badge tone="neutral">{waveLabel(step, t)}</Badge> : null}
                  <span className="ml-auto text-[10px] text-mute">{t(actionKey(step.action))}</span>
                </div>
                <p className="relative mt-2 text-base font-semibold text-ink">
                  {humanTowerLabel(step.towerKey) ?? step.raw}
                  {step.level !== undefined ? <span className="text-mute"> · Sv.{String(step.level)}</span> : null}
                  {step.count !== undefined ? <span className="text-mute"> · ×{String(step.count)}</span> : null}
                </p>
                {step.spec ? (
                  <p className="relative mt-1 inline-flex rounded border border-brand/40 bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">
                    {step.spec}
                  </p>
                ) : null}
                {step.note ? <p className="relative mt-1 text-[11px] text-mute">{step.note}</p> : null}
                <p className="relative mt-2 line-clamp-3 text-[11px] leading-relaxed text-ink/80">{step.raw}</p>
                <div className="relative mt-3 flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" disabled={selectedIndex <= 0} onClick={() => setSelectedIndex(selectedIndex - 1)}>
                    {t('common.prev')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={selectedIndex >= ir.steps.length - 1}
                    onClick={() => setSelectedIndex(selectedIndex + 1)}
                  >
                    {t('common.next')}
                  </Button>
                  <span className="ml-auto flex items-center gap-1 text-[9px] text-mute">
                    <Sparkles size={9} className="text-brand" />
                    {t('import.v2.steps.previewLive')}
                  </span>
                </div>
              </div>
            ) : (
              <EmptyState title={t('import.v2.steps.noSelection')} />
            )}
          </Section>
        </div>
      </div>

      <Distribution insights={insights} />
    </div>
  )
}
