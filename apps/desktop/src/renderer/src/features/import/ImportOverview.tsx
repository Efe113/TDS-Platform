import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  Hash,
  ListChecks,
  PenLine,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
  UserRound,
  X,
  XCircle
} from 'lucide-react'
import {
  DIFFICULTY_VALUES,
  PLAYER_COUNT_VALUES,
  type Difficulty,
  type PlayerCount,
  type ReportIssue,
  type StrategyIr,
  type ValidationReport
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { formatBytes } from '../../lib/text'
import { Badge, Button, Field, INPUT_CLASS, cn } from '../../components/ui'
import { Chip, Section } from '../../components/ui/system'
import { ImportChecklist } from './ImportChecklist'
import type { EventAnswer, ImportTab, Readiness, ReadinessId } from './import-draft'

const DIFFICULTY_LABEL: Record<Difficulty, MessageKey> = {
  easy: 'difficulty.easy',
  medium: 'difficulty.medium',
  hard: 'difficulty.hard',
  nightmare: 'difficulty.nightmare'
}

const PLAYER_LABEL: Record<PlayerCount, MessageKey> = {
  solo: 'playerCount.solo',
  duo: 'playerCount.duo',
  trio: 'playerCount.trio',
  quad: 'playerCount.quad',
  unknown: 'playerCount.unknown'
}

const CHECK_TAB: Partial<Record<ReadinessId, ImportTab>> = {
  inventory: 'content',
  inventoryKeys: 'content',
  unresolved: 'steps',
  signedIn: 'publish',
  duplicate: 'publish'
}

const ISSUE_LEVELS: Array<{ value: 'all' | ReportIssue['level']; key: MessageKey; tone: 'neutral' | 'danger' | 'warn' }> = [
  { value: 'all', key: 'import.v2.issue.all', tone: 'neutral' },
  { value: 'error', key: 'import.level.error', tone: 'danger' },
  { value: 'warning', key: 'import.level.warning', tone: 'warn' },
  { value: 'info', key: 'import.level.info', tone: 'neutral' }
]

export interface ImportOverviewProps {
  ir: StrategyIr
  report: ValidationReport | null
  readiness: Readiness
  eventAnswer: EventAnswer
  onEventAnswer: (answer: 'yes' | 'no') => void
  onPatchMeta: (patch: Partial<StrategyIr['meta']>) => void
  onPatchCredit: (patch: Partial<StrategyIr['meta']['credit']>) => void
  onGoToTab: (tab: ImportTab) => void
  onOpenSource: () => void
  onOpenDrafts: () => void
  onCopySummary: () => void
  summaryCopied: boolean
  identityName: string
}

export function ImportOverview({
  ir,
  report,
  readiness,
  eventAnswer,
  onEventAnswer,
  onPatchMeta,
  onPatchCredit,
  onGoToTab,
  onOpenSource,
  onOpenDrafts,
  onCopySummary,
  summaryCopied,
  identityName
}: ImportOverviewProps): ReactNode {
  const t = useT()
  const [tagDraft, setTagDraft] = useState('')
  const [issueFilter, setIssueFilter] = useState<'all' | ReportIssue['level']>('all')
  const [copied, setCopied] = useState<string | null>(null)

  const copy = (value: string, id: string): void => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(id)
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1600)
    })
  }

  const issues = (report?.issues ?? []).filter((issue) => issueFilter === 'all' || issue.level === issueFilter)
  const sourceUrl = ir.format.sourceUrl
  const canOpenSource = Boolean(sourceUrl && /^https?:\/\//i.test(sourceUrl))
  const waveFrom = ir.meta.waveRange?.[0]
  const waveTo = ir.meta.waveRange?.[1]
  const stats = report?.stats

  const addTag = (): void => {
    const value = tagDraft.trim()
    if (value.length === 0) return
    if (ir.meta.tags.some((tag) => tag.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      setTagDraft('')
      return
    }
    onPatchMeta({ tags: [...ir.meta.tags, value].slice(0, 12) })
    setTagDraft('')
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_312px]">
      <div className="min-w-0 space-y-4">
        <Section
          title={t('import.v2.identityTitle')}
          hint={t('import.v2.identityHint')}
          aside={
            <Button size="sm" variant="subtle" onClick={onCopySummary}>
              {summaryCopied ? <Check size={13} /> : <Copy size={13} />}
              {summaryCopied ? t('import.v2.publish.summaryCopied') : t('import.v2.copySummary')}
            </Button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('import.field.name')}>
              <input
                className={cn(INPUT_CLASS, 'no-drag h-9 py-1.5 text-sm')}
                value={ir.meta.name}
                maxLength={120}
                onChange={(event) => onPatchMeta({ name: event.target.value })}
              />
            </Field>
            <Field label={t('import.field.subtitle')}>
              <input
                className={cn(INPUT_CLASS, 'no-drag h-9 py-1.5 text-sm')}
                value={ir.meta.subtitle ?? ''}
                maxLength={160}
                onChange={(event) => onPatchMeta({ subtitle: event.target.value.trim() || undefined })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('import.v2.field.description')} hint={t('import.v2.field.descriptionHint')}>
                <textarea
                  className={cn(INPUT_CLASS, 'no-drag min-h-16 resize-y text-sm')}
                  value={ir.meta.description ?? ''}
                  maxLength={800}
                  onChange={(event) => onPatchMeta({ description: event.target.value.trim() || undefined })}
                />
              </Field>
            </div>
            <Field label={t('import.field.difficulty')}>
              <select
                className={cn(INPUT_CLASS, 'no-drag h-9 py-1.5 text-sm')}
                value={ir.meta.difficulty}
                onChange={(event) => onPatchMeta({ difficulty: event.target.value as Difficulty })}
              >
                {DIFFICULTY_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {t(DIFFICULTY_LABEL[value])}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('import.field.playerCount')}>
              <select
                className={cn(INPUT_CLASS, 'no-drag h-9 py-1.5 text-sm')}
                value={ir.meta.playerCount}
                onChange={(event) => onPatchMeta({ playerCount: event.target.value as PlayerCount })}
              >
                {PLAYER_COUNT_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {t(PLAYER_LABEL[value])}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('import.v2.field.gameModeKey')}>
              <div className="relative">
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-9 py-1.5 pr-16 text-sm')}
                  value={ir.meta.gameMode.key === 'unknown' ? '' : ir.meta.gameMode.key}
                  placeholder="classic"
                  onChange={(event) => {
                    const value = event.target.value.trim()
                    onPatchMeta({
                      gameMode: { key: value, raw: value, resolved: value.length > 0 }
                    })
                  }}
                />
                <span className="absolute top-1/2 right-2 -translate-y-1/2">
                  <Badge tone={ir.meta.gameMode.resolved ? 'good' : 'warn'}>
                    {ir.meta.gameMode.resolved ? t('import.v2.resolved') : t('import.field.unresolved')}
                  </Badge>
                </span>
              </div>
            </Field>
            <Field label={t('import.v2.field.mapKey')}>
              <div className="relative">
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-9 py-1.5 pr-16 text-sm')}
                  value={ir.meta.map.key ?? ir.meta.map.raw ?? ''}
                  placeholder="harbor"
                  onChange={(event) => {
                    const value = event.target.value.trim()
                    onPatchMeta({ map: { ...ir.meta.map, key: value || undefined, raw: value || undefined } })
                  }}
                />
                <span className="absolute top-1/2 right-2 -translate-y-1/2">
                  <Badge tone={(ir.meta.map.key ?? ir.meta.map.raw) ? 'good' : 'warn'}>
                    {(ir.meta.map.key ?? ir.meta.map.raw) ? t('import.v2.resolved') : t('import.field.unresolved')}
                  </Badge>
                </span>
              </div>
            </Field>
            <Field label={t('import.field.waveRange')}>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  className={cn(INPUT_CLASS, 'no-drag h-9 w-full py-1.5 text-sm tabular-nums')}
                  placeholder={t('import.v2.field.waveFrom')}
                  value={waveFrom ?? ''}
                  onChange={(event) => {
                    const value = Math.max(0, Math.trunc(event.target.valueAsNumber))
                    onPatchMeta({
                      waveRange: Number.isFinite(value) ? [value, waveTo ?? value] : undefined
                    })
                  }}
                />
                <span className="text-mute">–</span>
                <input
                  type="number"
                  min={0}
                  className={cn(INPUT_CLASS, 'no-drag h-9 w-full py-1.5 text-sm tabular-nums')}
                  placeholder={t('import.v2.field.waveTo')}
                  value={waveTo ?? ''}
                  onChange={(event) => {
                    const value = Math.max(0, Math.trunc(event.target.valueAsNumber))
                    if (waveFrom === undefined) return
                    onPatchMeta({ waveRange: Number.isFinite(value) ? [waveFrom, value] : [waveFrom, waveFrom] })
                  }}
                />
              </div>
            </Field>
            <Field label={t('import.field.duration')}>
              <input
                type="number"
                min={1}
                className={cn(INPUT_CLASS, 'no-drag h-9 py-1.5 text-sm tabular-nums')}
                placeholder={t('import.v2.field.durationPlaceholder')}
                value={ir.meta.durationMinutes ?? ''}
                onChange={(event) => {
                  const value = Math.trunc(event.target.valueAsNumber)
                  onPatchMeta({ durationMinutes: Number.isFinite(value) && value > 0 ? value : undefined })
                }}
              />
            </Field>
            <Field label={t('import.field.version')}>
              <input
                className={cn(INPUT_CLASS, 'no-drag h-9 py-1.5 text-sm')}
                value={ir.meta.versionLabel ?? ''}
                placeholder="v1.2"
                onChange={(event) => onPatchMeta({ versionLabel: event.target.value.trim() || undefined })}
              />
            </Field>
            <Field label={t('import.field.pov')}>
              <input
                className={cn(INPUT_CLASS, 'no-drag h-9 py-1.5 text-sm')}
                value={ir.meta.povVideoUrl ?? ''}
                placeholder="https://youtu.be/…"
                spellCheck={false}
                onChange={(event) => onPatchMeta({ povVideoUrl: event.target.value.trim() || undefined })}
              />
            </Field>
          </div>

          <div className="mt-3 space-y-1.5">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-mute/70">
              <Tag size={11} /> {t('import.field.tags')}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {ir.meta.tags.length === 0 ? <span className="text-[10px] text-mute">{t('import.v2.tagsEmpty')}</span> : null}
              {ir.meta.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-lg border border-brand/35 bg-brand/10 py-0.5 pr-1 pl-2 text-[11px] text-ink"
                >
                  {tag}
                  <button
                    type="button"
                    className="grid size-4 place-items-center rounded text-mute hover:text-danger"
                    title={t('import.v2.tagsRemove')}
                    onClick={() => onPatchMeta({ tags: ir.meta.tags.filter((entry) => entry !== tag) })}
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                className={cn(INPUT_CLASS, 'no-drag h-8 max-w-56 py-1 text-xs')}
                value={tagDraft}
                maxLength={24}
                placeholder={t('import.v2.tagsPlaceholder')}
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addTag()
                  }
                }}
              />
              <Button
                size="sm"
                variant="subtle"
                disabled={tagDraft.trim().length === 0 || ir.meta.tags.length >= 12}
                onClick={addTag}
              >
                <Plus size={12} />
                {t('import.v2.tagAdd')}
              </Button>
            </div>
          </div>
        </Section>

        <Section title={t('import.credit.title')} hint={t('import.credit.warning')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('import.credit.creator')}>
              <div className="flex items-center gap-1.5">
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-9 py-1.5 text-sm')}
                  value={ir.meta.credit.creator}
                  maxLength={80}
                  onChange={(event) => onPatchCredit({ creator: event.target.value })}
                />
                <Button
                  size="sm"
                  variant="subtle"
                  className="shrink-0"
                  disabled={identityName.trim().length === 0}
                  title={t('import.v2.useIdentity')}
                  onClick={() => onPatchCredit({ creator: identityName, isAuthorOwn: true })}
                >
                  <UserRound size={12} />
                </Button>
              </div>
            </Field>
            <div className="flex flex-col justify-end">
              <label className="flex items-start gap-2 rounded-lg border border-line bg-panel-soft px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--color-brand)]"
                  checked={!ir.meta.credit.isAuthorOwn}
                  onChange={(event) => onPatchCredit({ isAuthorOwn: !event.target.checked })}
                />
                <span>
                  {t('import.credit.notOwner')}
                  <span className="mt-0.5 block text-[10px] text-mute">{t('import.v2.ownerHint')}</span>
                </span>
              </label>
            </div>
          </div>
          {ir.meta.credit.contributors.length > 0 ? (
            <p className="mt-2 text-[11px] text-mute">
              {t('import.credit.contributors')}: {ir.meta.credit.contributors.join(', ')}
            </p>
          ) : null}
        </Section>

        <Section
          title={t('import.reportTitle')}
          hint={t('import.v2.reportHint')}
          aside={
            <div className="flex flex-wrap items-center gap-1">
              {ISSUE_LEVELS.map((entry) => {
                const count =
                  entry.value === 'all'
                    ? (report?.issues.length ?? 0)
                    : (report?.issues.filter((issue) => issue.level === entry.value).length ?? 0)
                return (
                  <button
                    key={entry.value}
                    type="button"
                    data-press
                    onClick={() => setIssueFilter(entry.value)}
                    className={cn(
                      'no-drag rounded-md border px-2 py-0.5 text-[10px] transition-colors',
                      issueFilter === entry.value
                        ? 'border-brand/50 bg-brand/15 text-ink'
                        : 'border-line bg-panel-soft text-mute hover:text-ink'
                    )}
                  >
                    {t(entry.key)} <span className="tabular-nums text-mute/80">{String(count)}</span>
                  </button>
                )
              })}
            </div>
          }
        >
          {report === null ? (
            <p className="text-[11px] text-mute">{t('import.v2.reportUnavailable')}</p>
          ) : report.issues.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-good/30 bg-good/[0.06] px-3 py-2 text-[11px] text-good">
              <ShieldCheck size={14} />
              {t('import.report.clean')}
            </div>
          ) : issues.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line bg-panel-soft/40 px-3 py-2 text-[11px] text-mute">
              {t('import.v2.issueEmpty')}
            </p>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {issues.map((issue, index) => {
                const id = `${issue.level}-${issue.code}-${String(index)}`
                return (
                  <li key={id} className="rounded-lg border border-line bg-panel-soft/70 px-3 py-2">
                    <div className="flex items-start gap-2">
                      <span
                        className={cn(
                          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-md text-[10px]',
                          issue.level === 'error'
                            ? 'bg-danger/15 text-danger'
                            : issue.level === 'warning'
                              ? 'bg-warn/15 text-warn'
                              : 'bg-brand/15 text-brand'
                        )}
                      >
                        {issue.level === 'error' ? <XCircle size={11} /> : issue.level === 'warning' ? <AlertTriangle size={11} /> : <FileText size={11} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] leading-snug text-ink">{issue.message}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-mute">
                          <Badge>{issue.code}</Badge>
                          {issue.path ? <span className="font-mono">{issue.path}</span> : null}
                          {issue.sample ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 hover:text-ink"
                              onClick={() => copy(issue.sample ?? '', id)}
                            >
                              {copied === id ? <Check size={9} /> : <Copy size={9} />}
                              {copied === id ? t('import.v2.sampleCopied') : t('import.v2.copySample')}
                            </button>
                          ) : null}
                          {issue.sample ? <span className="line-clamp-1 max-w-lg break-words opacity-80">{issue.sample}</span> : null}
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      </div>

      <aside className="min-w-0 space-y-4">
        <Section title={t('import.v2.checklistTitle')} hint={t('import.v2.checklistHint')}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] text-mute">
              <ListChecks size={12} className="text-brand" />
              {`${String(readiness.checks.filter((check) => check.done).length)}/${String(readiness.checks.length)}`}
            </span>
            <span className="flex items-center gap-1">
              {readiness.blockers.length > 0 ? (
                <Chip tone="danger">{t('import.v2.blockers', { count: readiness.blockers.length })}</Chip>
              ) : (
                <Chip tone="good" icon={CheckCircle2}>
                  {t('import.v2.noBlockers')}
                </Chip>
              )}
            </span>
          </div>
          <ImportChecklist checks={readiness.checks} onGo={(id) => onGoToTab(CHECK_TAB[id] ?? 'overview')} />
        </Section>

        <Section title={t('import.v2.eventTitle')} hint={t('import.v2.eventHint')}>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant={eventAnswer === 'yes' ? 'primary' : 'ghost'}
              onClick={() => onEventAnswer('yes')}
            >
              <Sparkles size={12} />
              {t('common.yes')}
            </Button>
            <Button
              size="sm"
              variant={eventAnswer === 'no' ? 'primary' : 'ghost'}
              onClick={() => onEventAnswer('no')}
            >
              {t('common.no')}
            </Button>
            {eventAnswer === null ? <Badge tone="warn">{t('common.none')}</Badge> : null}
          </div>
          {ir.meta.event.evidence ? (
            <p className="mt-2 rounded-md border border-line bg-panel-soft px-2 py-1 text-[10px] text-mute">
              {t('import.v2.eventEvidence', { value: ir.meta.event.evidence })}
            </p>
          ) : null}
        </Section>

        <Section
          title={t('import.v2.sourceTitleShort')}
          aside={
            canOpenSource ? (
              <Button size="sm" variant="subtle" onClick={onOpenSource} title={t('import.v2.openSource')}>
                <ExternalLink size={12} />
              </Button>
            ) : null
          }
        >
          <dl className="space-y-1.5 text-[10px]">
            <div className="flex items-start justify-between gap-2">
              <dt className="text-mute">{t('import.field.source')}</dt>
              <dd className="text-right font-mono text-ink">{ir.format.source}</dd>
            </div>
            <div className="flex items-start justify-between gap-2">
              <dt className="shrink-0 text-mute">{t('import.field.sourceUrl')}</dt>
              <dd className="min-w-0 break-all text-right text-ink/80">{sourceUrl ?? t('common.none')}</dd>
            </div>
            {ir.format.rawSha256 ? (
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-1 text-mute">
                  <Hash size={9} /> SHA-256
                </dt>
                <dd className="flex min-w-0 items-center gap-1">
                  <span className="truncate font-mono text-ink/70">{ir.format.rawSha256.slice(0, 12)}…</span>
                  <button
                    type="button"
                    className="rounded border border-line p-0.5 text-mute hover:text-ink"
                    title={t('import.v2.copySha')}
                    onClick={() => copy(ir.format.rawSha256 ?? '', 'sha')}
                  >
                    {copied === 'sha' ? <Check size={9} /> : <Copy size={9} />}
                  </button>
                </dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <dt className="text-mute">{t('import.v2.docId')}</dt>
              <dd className="truncate font-mono text-ink/70">{ir.format.docId ?? t('common.none')}</dd>
            </div>
          </dl>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" variant="subtle" onClick={onOpenDrafts}>
              <FolderOpen size={12} />
              {t('import.v2.openDrafts')}
            </Button>
            <Button size="sm" variant="subtle" onClick={() => copy(ir.format.rawSha256 ?? '', 'sha')} disabled={!ir.format.rawSha256}>
              <Copy size={12} />
              {copied === 'sha' ? t('import.v2.shaCopied') : t('import.v2.copySha')}
            </Button>
          </div>
        </Section>

        <Section title={t('import.statsTitle')}>
          {stats ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
              {[
                [t('import.stat.blocks'), String(stats.blocks)],
                [t('import.stat.sections'), String(stats.sections)],
                [t('import.stat.images'), String(stats.images)],
                [t('import.stat.imageBytes'), formatBytes(stats.imageBytes)],
                [t('import.stat.steps'), String(stats.steps)],
                [t('import.stat.unresolved'), String(stats.unresolvedClauses)],
                [t('import.stat.inventory'), String(stats.inventory)],
                [t('import.stat.media'), String(stats.mediaSaved)]
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-1 border-b border-line/40 pb-1">
                  <dt className="text-mute">{label}</dt>
                  <dd className="hud-num text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-[11px] text-mute">{t('import.v2.reportUnavailable')}</p>
          )}
        </Section>

        <div className="hud-panel border-brand/20 bg-brand/[0.04] p-3">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-brand">
            <PenLine size={11} /> {t('import.v2.tipTitle')}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-mute">{t('import.v2.tipBody')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" variant="subtle" onClick={() => onGoToTab('steps')}>
              <Search size={12} />
              {t('import.v2.tipSteps')}
            </Button>
            <Button size="sm" variant="subtle" onClick={() => onGoToTab('publish')}>
              <Check size={12} />
              {t('import.v2.tipPublish')}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  )
}
