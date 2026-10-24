import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import {
  LayoutDashboard,
  Layers,
  ListOrdered,
  RotateCcw,
  Send,
  Sparkles
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  IPC_CHANNELS,
  emptyStats,
  strategyIrSchema,
  type ImportResultPayload,
  type OverlayState,
  type ReportIssue,
  type StrategyIr,
  type ValidationReport
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { actionKey } from '../../lib/actions'
import { call, IpcError } from '../../lib/ipc'
import { navigate } from '../../lib/router'
import { humanTowerLabel } from '../../lib/text'
import { PublishError, listOwnStrategies, submitForReview } from '../../lib/publish-api'
import { useIdentity } from '../../lib/identity'
import { useAppStore } from '../../store/app-store'
import { selectSignedIn, selectUserId, useAuth } from '../../store/auth-store'
import { Banner, Button } from '../../components/ui'
import { Chip, PageHeader } from '../../components/ui/system'
import { ReportPanel } from './ReportPanel'
import { ImportSourceConsole, type SourceMode } from './ImportSourceConsole'
import { ImportDeck, ImportLanding } from './ImportDeck'
import { ImportOverview } from './ImportOverview'
import { ImportContent } from './ImportContent'
import { ImportSteps } from './ImportSteps'
import { ImportPublish } from './ImportPublish'
import {
  baseReadiness,
  clearImportHistory,
  clearWorkingDraft,
  findOwnDuplicate,
  forgetImport,
  makeStoredImport,
  newStep,
  PASTE_SAMPLE,
  readImportHistory,
  readWorkingDraft,
  rememberImport,
  withLiveContentIssues,
  writeWorkingDraft,
  type EventAnswer,
  type ImportOrigin,
  type ImportTab,
  type StoredImport
} from './import-draft'

const TABS: Array<{ id: ImportTab; labelKey: MessageKey; icon: LucideIcon }> = [
  { id: 'overview', labelKey: 'import.v2.tab.overview', icon: LayoutDashboard },
  { id: 'content', labelKey: 'import.v2.tab.content', icon: Layers },
  { id: 'steps', labelKey: 'import.v2.tab.steps', icon: ListOrdered },
  { id: 'publish', labelKey: 'import.v2.tab.publish', icon: Send }
]

const ORIGIN_LABEL: Record<ImportOrigin, MessageKey> = {
  link: 'import.v2.source.link',
  file: 'import.v2.source.file',
  paste: 'import.v2.source.paste'
}

function toReport(value: unknown): ValidationReport | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { issues?: unknown; stats?: ValidationReport['stats']; ok?: boolean }
  if (!Array.isArray(candidate.issues)) return null
  const issues = candidate.issues as ReportIssue[]
  const errors = issues.filter((issue) => issue.level === 'error')
  return {
    issues,
    errors,
    warnings: issues.filter((issue) => issue.level === 'warning'),
    stats: candidate.stats ?? emptyStats(),
    ok: typeof candidate.ok === 'boolean' ? candidate.ok : errors.length === 0
  }
}

function summaryMarkdown(ir: StrategyIr, eventAnswer: EventAnswer, t: ReturnType<typeof useT>): string {
  const lines: string[] = [`# ${ir.meta.name}`]
  if (ir.meta.subtitle) lines.push('', ir.meta.subtitle)
  const difficulty = t(`difficulty.${ir.meta.difficulty}` as MessageKey)
  const players = t(`playerCount.${ir.meta.playerCount}` as MessageKey)
  const wave = ir.meta.waveRange ? `${String(ir.meta.waveRange[0])} – ${String(ir.meta.waveRange[1])}` : t('common.none')
  lines.push(
    '',
    `- ${t('import.field.difficulty')}: ${difficulty}`,
    `- ${t('import.field.playerCount')}: ${players}`,
    `- ${t('import.field.gameMode')}: ${ir.meta.gameMode.key || t('common.none')}`,
    `- ${t('import.field.map')}: ${ir.meta.map.key ?? ir.meta.map.raw ?? t('common.none')}`,
    `- ${t('import.field.waveRange')}: ${wave}`,
    `- ${t('import.v2.eventTitle')}: ${eventAnswer === 'yes' ? t('common.yes') : eventAnswer === 'no' ? t('common.no') : t('common.none')}`
  )
  if (ir.meta.tags.length > 0) lines.push(`- ${t('import.field.tags')}: ${ir.meta.tags.join(', ')}`)
  if (ir.inventory.length > 0) {
    lines.push('', `## ${t('import.inventory.title')}`)
    for (const slot of ir.inventory) {
      const label = humanTowerLabel(slot.towerKey) ?? slot.towerKey
      lines.push(`- ${label}${slot.count !== undefined ? ` ×${String(slot.count)}` : ''}`)
    }
  }
  lines.push('', `## ${t('import.stepsTitle')}`)
  for (const step of ir.steps) {
    const waveLabel = step.waveFrom !== undefined
      ? step.waveTo !== undefined && step.waveTo !== step.waveFrom
        ? `[${String(step.waveFrom)}–${String(step.waveTo)}] `
        : `[${String(step.waveFrom)}] `
      : ''
    const tower = humanTowerLabel(step.towerKey)
    const detail = [tower, step.level !== undefined ? `Sv.${String(step.level)}` : undefined, step.count !== undefined ? `×${String(step.count)}` : undefined, step.spec]
      .filter(Boolean)
      .join(' · ')
    lines.push(`${String(step.stepNo)}. ${waveLabel}${t(actionKey(step.action))}${detail ? ` — ${detail}` : ''}`)
    if (step.raw) lines.push(`   ${step.raw}`)
  }
  lines.push(
    '',
    `## ${t('import.credit.title')}`,
    `${t('import.credit.creator')}: ${ir.meta.credit.creator || t('common.none')}`
  )
  if (ir.format.sourceUrl) lines.push(`${t('import.field.sourceUrl')}: ${ir.format.sourceUrl}`)
  return lines.join('\n')
}

export function ImportPage(): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()
  const outcome = useAppStore((state) => state.importOutcome)
  const setOutcome = useAppStore((state) => state.setImportOutcome)
  const clearImportOutcome = useAppStore((state) => state.clearImportOutcome)
  const applyOverlayState = useAppStore((state) => state.applyOverlayState)
  const setOverlayVisible = useAppStore((state) => state.setOverlayVisible)
  const overlayVisible = useAppStore((state) => state.overlayVisible)
  const activeStrategy = useAppStore((state) => state.activeStrategy)
  const signedIn = useAuth(selectSignedIn)
  const userId = useAuth(selectUserId)
  const identity = useIdentity()

  const [draft, setDraft] = useState<StrategyIr | null>(null)
  const [report, setReport] = useState<ValidationReport | null>(null)
  const [origin, setOrigin] = useState<ImportOrigin>('link')
  const [sourceLabel, setSourceLabel] = useState('')
  const [eventAnswer, setEventAnswer] = useState<EventAnswer>(null)
  const [tab, setTab] = useState<ImportTab>('overview')
  const [sourceMode, setSourceMode] = useState<SourceMode>('link')
  const [sourceExpanded, setSourceExpanded] = useState(true)
  const [link, setLink] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [history, setHistory] = useState<StoredImport[]>(() => readImportHistory())
  const [workingDraft, setWorkingDraft] = useState<StoredImport | null>(() => readWorkingDraft())
  const [publishedId, setPublishedId] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [summaryCopied, setSummaryCopied] = useState(false)
  const [sourceFailure, setSourceFailure] = useState<string | null>(null)
  const [sourceNotice, setSourceNotice] = useState<string | null>(null)
  const [failedReport, setFailedReport] = useState<ValidationReport | null>(null)
  // Import callbacks resolve after an await; they must see the record the user has right now, not
  // the one that existed when the mutation was created.
  const liveImport = useRef({ draft, report, origin, sourceLabel, eventAnswer })
  liveImport.current = { draft, report, origin, sourceLabel, eventAnswer }

  useEffect(() => {
    const ir = outcome?.ir ?? null
    if (!ir) {
      setDraft(null)
      setReport(outcome?.report ?? null)
      setEventAnswer(null)
      setOrigin(outcome?.origin ?? 'link')
      setSourceLabel(outcome?.sourceLabel ?? '')
      setPublishedId(null)
      setStarted(false)
      return
    }
    const working = readWorkingDraft()
    const sameChecksum = Boolean(
      working && working.ir.format.rawSha256 && ir.format.rawSha256 && working.ir.format.rawSha256 === ir.format.rawSha256
    )
    const seed = sameChecksum && working
      ? working
      : {
          ir,
          report: outcome?.report ?? null,
          eventAnswer: (ir.meta.event.isEvent ? 'yes' : null) as EventAnswer,
          origin: outcome?.origin ?? ('link' as ImportOrigin),
          sourceLabel: outcome?.sourceLabel ?? ''
        }
    setDraft(seed.ir)
    setReport(seed.report)
    setEventAnswer(seed.eventAnswer)
    setOrigin(seed.origin)
    setSourceLabel(seed.sourceLabel)
    setPublishedId(null)
    setStarted(false)
    setTab('overview')
  }, [outcome])

  useEffect(() => {
    if (!draft) return
    const timer = window.setTimeout(() => {
      const entry = makeStoredImport({ ir: draft, report, origin, sourceLabel, eventAnswer })
      writeWorkingDraft(entry)
      setWorkingDraft(entry)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [draft, report, origin, sourceLabel, eventAnswer])

  const liveReport = useMemo(() => withLiveContentIssues(report), [report])
  const readiness = useMemo(
    () => (draft ? baseReadiness(draft, liveReport, eventAnswer) : null),
    [draft, liveReport, eventAnswer]
  )

  const ownQuery = useQuery({
    queryKey: ['import', 'own-strategies', userId],
    queryFn: listOwnStrategies,
    enabled: signedIn && userId !== null && draft !== null,
    staleTime: 30_000,
    retry: 1
  })

  const duplicate = draft ? findOwnDuplicate(draft, ownQuery.data) : null

  const consume = useCallback(
    (payload: ImportResultPayload, nextOrigin: ImportOrigin, nextSourceLabel: string): void => {
      const parsed = payload.ir === undefined || payload.ir === null ? null : strategyIrSchema.safeParse(payload.ir)
      let ir = parsed?.success ? parsed.data : null
      // A document with no recognizable steps fails the "at least one step" schema rule, but the
      // rest of the draft is usually sound. Seed one editable step instead of throwing the draft away.
      if (!ir && payload.ir && typeof payload.ir === 'object') {
        const candidate = payload.ir as { steps?: unknown }
        if (Array.isArray(candidate.steps) && candidate.steps.length === 0) {
          const retry = strategyIrSchema.safeParse({
            ...candidate,
            steps: [{ ...newStep(1), raw: t('import.v2.steps.newRaw') }]
          })
          if (retry.success) ir = retry.data
        }
      }
      const nextReport = toReport(payload.report)
      const previous = liveImport.current

      // A failed attempt must not silently discard the record the user is already editing. The
      // report is still surfaced, but the working draft stays exactly where it was.
      if (!ir && previous.draft) {
        if (payload.code === 'cancelled') {
          setSourceNotice(t('import.cancelled'))
        } else {
          setSourceNotice(null)
          setSourceFailure(payload.message ?? t('import.failed'))
          setFailedReport(nextReport)
        }
        return
      }

      setSourceFailure(null)
      setSourceNotice(null)
      setFailedReport(null)
      if (
        previous.draft &&
        ir &&
        previous.draft.format.rawSha256 &&
        ir.format.rawSha256 !== previous.draft.format.rawSha256
      ) {
        setHistory(
          rememberImport(
            makeStoredImport({
              ir: previous.draft,
              report: previous.report,
              origin: previous.origin,
              sourceLabel: previous.sourceLabel,
              eventAnswer: previous.eventAnswer
            })
          )
        )
      }
      setOutcome({
        origin: nextOrigin,
        ir,
        report: nextReport,
        sourceLabel: nextSourceLabel,
        code: payload.code,
        message: payload.ok ? undefined : payload.message
      })
      if (ir) {
        const entry = makeStoredImport({
          ir,
          report: nextReport,
          origin: nextOrigin,
          sourceLabel: nextSourceLabel,
          eventAnswer: ir.meta.event.isEvent ? 'yes' : null
        })
        setHistory(rememberImport(entry))
        setSourceExpanded(false)
      } else {
        setSourceExpanded(true)
      }
      setSummaryCopied(false)
    },
    [setOutcome, t]
  )

  const linkMutation = useMutation({
    mutationFn: async (value: string) => call<ImportResultPayload>(IPC_CHANNELS.importSubmitLink, { link: value }),
    onSuccess: (payload) => {
      consume(payload, 'link', payload.source?.sourceUrl ?? link)
    },
    onError: (error) => {
      setSourceNotice(null)
      setFailedReport(null)
      setSourceFailure(error.message)
    }
  })

  const fileMutation = useMutation({
    mutationFn: async () => call<ImportResultPayload>(IPC_CHANNELS.importPickFiles),
    onSuccess: (payload) => {
      consume(payload, 'file', payload.source?.sourceUrl ?? '')
    },
    onError: (error) => {
      setSourceNotice(null)
      setFailedReport(null)
      setSourceFailure(error.message)
    }
  })

  const pasteMutation = useMutation({
    mutationFn: async (value: string) => call<ImportResultPayload>(IPC_CHANNELS.importSubmitPaste, { markdown: value }),
    onSuccess: (payload) => {
      consume(payload, 'paste', '')
    },
    onError: (error) => {
      setSourceNotice(null)
      setFailedReport(null)
      setSourceFailure(error.message)
    }
  })

  const startMutation = useMutation({
    mutationFn: async (): Promise<OverlayState | null> => {
      if (!draft) throw new IpcError('no parsed strategy', 'no-ir')
      if (!readiness || readiness.blockers.length > 0) throw new IpcError(t('import.v2.publish.startBlocked'), 'not-ready')
      const state = await call<OverlayState | null>(IPC_CHANNELS.strategyLoad, { ir: draft, strategyId: publishedId })
      await call<unknown>(IPC_CHANNELS.overlayShow)
      return state
    },
    onSuccess: (state) => {
      applyOverlayState(state)
      setOverlayVisible(true)
      setStarted(true)
      setTab('publish')
    },
    onError: () => setTab('publish')
  })

  const publishMutation = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!draft) throw new IpcError('no parsed strategy', 'no-ir')
      return submitForReview(draft, {
        url: draft.format.sourceUrl ?? (sourceLabel.length > 0 ? sourceLabel : undefined),
        sha256: draft.format.rawSha256
      })
    },
    onSuccess: (strategyId) => {
      setPublishedId(strategyId)
      void queryClient.invalidateQueries({ queryKey: ['import', 'own-strategies'] })
      if (draft) {
        const entry = makeStoredImport({ ir: draft, report, origin, sourceLabel, eventAnswer })
        setHistory(rememberImport(entry))
      }
    }
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return
      if (!draft || !readiness || readiness.blockers.length > 0 || startMutation.isPending) return
      event.preventDefault()
      startMutation.mutate()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, readiness, startMutation])

  const patchIr = useCallback((updater: (current: StrategyIr) => StrategyIr): void => {
    setDraft((current) => (current ? updater(current) : current))
  }, [])

  const patchMeta = (patch: Partial<StrategyIr['meta']>): void => {
    patchIr((current) => ({ ...current, meta: { ...current.meta, ...patch } }))
  }

  const patchCredit = (patch: Partial<StrategyIr['meta']['credit']>): void => {
    patchIr((current) => ({ ...current, meta: { ...current.meta, credit: { ...current.meta.credit, ...patch } } }))
  }

  const answerEvent = (answer: 'yes' | 'no'): void => {
    setEventAnswer(answer)
    patchIr((current) => ({
      ...current,
      meta: {
        ...current.meta,
        event: {
          ...current.meta.event,
          isEvent: answer === 'yes',
          evidence: answer === 'yes' ? (current.meta.event.evidence ?? 'manual') : undefined
        }
      }
    }))
  }

  const sourceText = sourceLabel.length > 0 ? sourceLabel : t(ORIGIN_LABEL[origin])
  const code = outcome?.code
  const showNotPublic = code === 'not-public' || code === 'invalid-link'
  const showCancelled = code === 'cancelled'
  const showNeedsReview = code === 'needsReview'
  const otherFailure = Boolean(outcome?.message) && !showNotPublic && !showCancelled && !showNeedsReview
  const publishFailure = publishMutation.error
    ? publishMutation.error instanceof PublishError
      ? { friendly: t(publishMutation.error.messageKey), raw: publishMutation.error.message }
      : { friendly: publishMutation.error.message, raw: publishMutation.error.message }
    : null

  const toggleOverlay = (): void => {
    const next = !overlayVisible
    void call(IPC_CHANNELS[next ? 'overlayShow' : 'overlayHide'])
      .then(() => setOverlayVisible(next))
      .catch(() => undefined)
  }

  const openDrafts = (): void => {
    void call(IPC_CHANNELS.importOpenDraftFolder).catch(() => undefined)
  }

  const openSource = (): void => {
    const url = draft?.format.sourceUrl
    if (!url || !/^https?:\/\//i.test(url)) return
    void call(IPC_CHANNELS.appOpenExternal, { url }).catch(() => undefined)
  }

  const copySummary = (): void => {
    if (!draft) return
    void navigator.clipboard.writeText(summaryMarkdown(draft, eventAnswer, t)).then(() => {
      setSummaryCopied(true)
      window.setTimeout(() => setSummaryCopied(false), 1800)
    })
  }

  const scrollToSource = (): void => {
    window.setTimeout(() => {
      document.getElementById('import-source-console')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }

  const chooseSource = (mode: SourceMode): void => {
    setSourceMode(mode)
    setSourceExpanded(true)
    scrollToSource()
  }

  const openSourceConsole = (): void => {
    setSourceExpanded(true)
    scrollToSource()
  }

  const loadStored = (entry: StoredImport): void => {
    writeWorkingDraft(entry)
    setWorkingDraft(entry)
    setSourceFailure(null)
    setSourceNotice(null)
    setFailedReport(null)
    setOutcome({
      origin: entry.origin,
      ir: entry.ir,
      report: entry.report,
      sourceLabel: entry.sourceLabel
    })
    setSourceExpanded(false)
  }

  const discardWorking = (): void => {
    clearWorkingDraft()
    setWorkingDraft(null)
  }

  const startNew = (): void => {
    if (draft) {
      const entry = makeStoredImport({ ir: draft, report, origin, sourceLabel, eventAnswer })
      setHistory(rememberImport(entry))
      clearWorkingDraft()
      setWorkingDraft(null)
    }
    clearImportOutcome()
    setDraft(null)
    setReport(null)
    setEventAnswer(null)
    setOrigin('link')
    setSourceLabel('')
    setPublishedId(null)
    setStarted(false)
    setSummaryCopied(false)
    setSourceMode('link')
    setSourceExpanded(true)
    setLink('')
    setPasteText('')
    setTab('overview')
    setSourceFailure(null)
    setSourceNotice(null)
    setFailedReport(null)
    linkMutation.reset()
    fileMutation.reset()
    pasteMutation.reset()
    startMutation.reset()
    publishMutation.reset()
  }

  const savedAtLabel = workingDraft && draft
    ? new Date(workingDraft.savedAt).toLocaleTimeString(i18next.language || 'tr', { hour: '2-digit', minute: '2-digit' })
    : null
  const tracking = started || Boolean(
    draft &&
      activeStrategy &&
      activeStrategy.name === draft.meta.name &&
      activeStrategy.totalSteps === draft.steps.length
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('import.title')}
        subtitle={t('import.v2.subtitle')}
        badges={
          <>
            <Chip tone="brand" icon={Sparkles}>{t('import.v2.badge')}</Chip>
            {draft ? (
              <>
                <Chip tone="neutral">{t('import.stepsFound', { count: draft.steps.length })}</Chip>
                <Chip tone={readiness && readiness.blockers.length > 0 ? 'danger' : 'good'}>
                  {readiness && readiness.blockers.length > 0
                    ? t('import.v2.blockedBadge', { count: readiness.blockers.length })
                    : t('import.v2.readyBadge')}
                </Chip>
                <Chip tone="neutral">{sourceText}</Chip>
                {savedAtLabel ? <Chip tone="neutral">{t('import.v2.autoSaved', { time: savedAtLabel })}</Chip> : null}
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <Button size="sm" variant="subtle" onClick={openDrafts}>
              {t('import.v2.openDrafts')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={startNew}
              disabled={
                (!draft && !outcome && !workingDraft && !sourceFailure && !sourceNotice && !failedReport) ||
                linkMutation.isPending ||
                fileMutation.isPending ||
                pasteMutation.isPending ||
                startMutation.isPending ||
                publishMutation.isPending
              }
            >
              <RotateCcw size={13} />
              {t('import.v2.newImport')}
            </Button>
          </>
        }
      />

      {sourceFailure ? (
        <Banner tone="danger" title={t('common.errorTitle')}>
          {sourceFailure}
        </Banner>
      ) : null}
      {sourceNotice ? <Banner tone="info">{sourceNotice}</Banner> : null}
      {showNotPublic ? <Banner tone="warn">{t('import.notPublic')}</Banner> : null}
      {showCancelled ? <Banner tone="info">{t('import.cancelled')}</Banner> : null}
      {showNeedsReview ? <Banner tone="warn" title={t('import.review')}>{t('import.needsReview')}</Banner> : null}
      {otherFailure && !sourceFailure ? <Banner tone="danger" title={t('import.failed')}>{outcome?.message}</Banner> : null}
      {outcome && !draft && outcome.report ? <Banner tone="danger">{t('import.irFailed')}</Banner> : null}

      {!draft ? (
        <ImportLanding
          onChooseMode={chooseSource}
          onPickFile={() => fileMutation.mutate()}
          onOpenDrafts={openDrafts}
        />
      ) : null}

      <div id="import-source-console">
        <ImportSourceConsole
          expanded={sourceExpanded}
          hasDraft={draft !== null}
          currentSource={sourceText}
          mode={sourceMode}
          onMode={setSourceMode}
          link={link}
          onLink={setLink}
          pasteText={pasteText}
          onPasteText={setPasteText}
          busy={linkMutation.isPending ? 'link' : fileMutation.isPending ? 'file' : pasteMutation.isPending ? 'paste' : null}
          onImportLink={() => linkMutation.mutate(link.trim())}
          onImportFile={() => fileMutation.mutate()}
          onImportPaste={() => pasteMutation.mutate(pasteText.trim())}
          onSample={() => setPasteText(PASTE_SAMPLE)}
          onOpenFolder={openDrafts}
          onToggle={() => setSourceExpanded((current) => !current)}
          history={history}
          onRestore={loadStored}
          onDeleteHistory={(id) => setHistory(forgetImport(id))}
          onClearHistory={() => setHistory(clearImportHistory())}
          workingDraft={workingDraft}
          onResumeWorking={() => {
            if (workingDraft) loadStored(workingDraft)
          }}
          onDiscardWorking={discardWorking}
        />
      </div>

      {failedReport ? <ReportPanel report={failedReport} /> : null}

      {!draft ? (
        outcome?.report ? <ReportPanel report={outcome.report} /> : null
      ) : readiness ? (
        <>
          <ImportDeck
            ir={draft}
            readiness={readiness}
            errorCount={liveReport?.errors.length ?? 0}
            sourceLabel={sourceText}
            tab={tab}
            started={tracking}
            publishedId={publishedId}
            overlayVisible={overlayVisible}
            startBusy={startMutation.isPending}
            onStart={() => startMutation.mutate()}
            onToggleOverlay={toggleOverlay}
            onOpenSource={openSourceConsole}
            onTab={setTab}
          />

          <nav className="hud-panel flex gap-1 overflow-x-auto p-1.5">
            {TABS.map((entry) => {
              const Icon = entry.icon
              const active = tab === entry.id
              const count =
                entry.id === 'content'
                  ? draft.inventory.length
                  : entry.id === 'steps'
                    ? draft.steps.length
                    : entry.id === 'overview' && readiness.blockers.length > 0
                      ? readiness.blockers.length
                      : undefined
              return (
                <button
                  key={entry.id}
                  type="button"
                  data-press
                  onClick={() => setTab(entry.id)}
                  className={
                    active
                      ? 'no-drag flex min-w-max items-center gap-1.5 rounded-lg bg-brand/15 px-3 py-2 text-[12px] font-medium text-ink ring-1 ring-inset ring-brand/30'
                      : 'no-drag flex min-w-max items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-mute transition-colors hover:bg-panel-soft hover:text-ink'
                  }
                >
                  <Icon size={13} className={active ? 'text-brand' : undefined} />
                  {t(entry.labelKey)}
                  {count !== undefined ? (
                    <span className={entry.id === 'overview' ? 'rounded bg-danger/15 px-1 text-[10px] tabular-nums text-danger' : 'text-[10px] tabular-nums text-mute'}>
                      {String(count)}
                    </span>
                  ) : null}
                </button>
              )
            })}
            <span className="ml-auto hidden items-center gap-1 pr-1 text-[10px] text-mute sm:flex">
              Ctrl <span className="text-mute/60">+</span> ↵
            </span>
          </nav>

          {tab === 'overview' ? (
            <ImportOverview
              ir={draft}
              report={liveReport}
              readiness={readiness}
              eventAnswer={eventAnswer}
              onEventAnswer={answerEvent}
              onPatchMeta={patchMeta}
              onPatchCredit={patchCredit}
              onGoToTab={setTab}
              onOpenSource={openSource}
              onOpenDrafts={openDrafts}
              onCopySummary={copySummary}
              summaryCopied={summaryCopied}
              identityName={identity.display}
            />
          ) : null}

          {tab === 'content' ? <ImportContent ir={draft} onPatch={patchIr} /> : null}
          {tab === 'steps' ? <ImportSteps ir={draft} onPatch={patchIr} /> : null}
          {tab === 'publish' ? (
            <ImportPublish
              ir={{
                name: draft.meta.name,
                steps: draft.steps.length,
                source: draft.format.source,
                sha: draft.format.rawSha256
              }}
              readiness={readiness}
              signedIn={signedIn}
              duplicate={publishedId !== null ? null : duplicate}
              own={ownQuery.data}
              ownLoading={ownQuery.isFetching}
              ownError={ownQuery.isError ? ownQuery.error.message : null}
              onRefreshOwn={() => void ownQuery.refetch()}
              publishedId={publishedId}
              started={tracking}
              overlayVisible={overlayVisible}
              startBusy={startMutation.isPending}
              startError={startMutation.error?.message ?? null}
              publishBusy={publishMutation.isPending}
              publishError={publishFailure}
              onStart={() => startMutation.mutate()}
              onToggleOverlay={toggleOverlay}
              onPublish={() => publishMutation.mutate()}
              onCopySummary={copySummary}
              summaryCopied={summaryCopied}
              onGoToTab={setTab}
              onOpenProfile={() => navigate('/profile')}
              onOpenAccount={() => navigate('/account')}
              onOpenDiscover={() => navigate('/discover')}
              onOpenDrafts={openDrafts}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
