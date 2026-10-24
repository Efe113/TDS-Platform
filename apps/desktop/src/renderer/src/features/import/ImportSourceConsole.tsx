import { useState } from 'react'
import type { ReactNode } from 'react'
import i18next from 'i18next'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Clock3,
  FileText,
  FileUp,
  FolderOpen,
  History,
  Link2,
  RotateCcw,
  Sparkles,
  Trash2
} from 'lucide-react'
import { extractDocId } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { relativeTime } from '../../lib/text'
import { Badge, Banner, Button, Field, INPUT_CLASS, cn } from '../../components/ui'
import { Segmented } from '../../components/ui/system'
import type { StoredImport } from './import-draft'

export type SourceMode = 'link' | 'file' | 'paste'

const SOURCE_ICON = {
  link: Link2,
  file: FileText,
  paste: ClipboardPaste
} as const

export interface ImportSourceConsoleProps {
  expanded: boolean
  hasDraft: boolean
  currentSource: string
  mode: SourceMode
  onMode: (mode: SourceMode) => void
  link: string
  onLink: (value: string) => void
  pasteText: string
  onPasteText: (value: string) => void
  busy: SourceMode | null
  onImportLink: () => void
  onImportFile: () => void
  onImportPaste: () => void
  onSample: () => void
  onOpenFolder: () => void
  onToggle: () => void
  history: StoredImport[]
  onRestore: (entry: StoredImport) => void
  onDeleteHistory: (id: string) => void
  onClearHistory: () => void
  workingDraft: StoredImport | null
  onResumeWorking: () => void
  onDiscardWorking: () => void
}

function sourceTime(savedAt: number): string {
  return relativeTime(new Date(savedAt).toISOString(), i18next.language || 'tr')
}

function SourceBadge({ origin }: { origin: StoredImport['origin'] }): ReactNode {
  const Icon = SOURCE_ICON[origin]
  return <Icon size={11} />
}

export function ImportSourceConsole({
  expanded,
  hasDraft,
  currentSource,
  mode,
  onMode,
  link,
  onLink,
  pasteText,
  onPasteText,
  busy,
  onImportLink,
  onImportFile,
  onImportPaste,
  onSample,
  onOpenFolder,
  onToggle,
  history,
  onRestore,
  onDeleteHistory,
  onClearHistory,
  workingDraft,
  onResumeWorking,
  onDiscardWorking
}: ImportSourceConsoleProps): ReactNode {
  const t = useT()
  const [confirmClear, setConfirmClear] = useState(false)
  const linkInfo = link.trim().length > 0 ? extractDocId(link) : undefined
  const pasteLines = pasteText.trim().length === 0 ? 0 : pasteText.split('\n').length
  const pasteReady = pasteText.trim().length >= 20

  return (
    <section className="hud-panel overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-line/60 px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-brand/25 bg-brand/10 text-brand">
          <FileUp size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold tracking-wide text-ink">{t('import.v2.sourceTitle')}</p>
          <p className="mt-0.5 truncate text-[11px] text-mute">
            {hasDraft && currentSource.length > 0
              ? t('import.v2.currentSource', { value: currentSource })
              : t('import.v2.sourceHint')}
          </p>
        </div>
        <Button size="sm" variant="subtle" onClick={onOpenFolder} title={t('settings.data.imports')}>
          <FolderOpen size={13} />
          <span className="hidden sm:inline">{t('import.v2.openDrafts')}</span>
        </Button>
        <Button size="sm" variant="subtle" onClick={onToggle}>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? t('import.v2.collapse') : t('import.v2.expand')}
        </Button>
      </header>

      {expanded ? (
        <div className="space-y-3 p-4">
          <Segmented
            options={[
              { value: 'link', label: t('import.v2.mode.link'), icon: Link2 },
              { value: 'file', label: t('import.v2.mode.file'), icon: FileText },
              { value: 'paste', label: t('import.v2.mode.paste'), icon: ClipboardPaste }
            ]}
            value={mode}
            onChange={onMode}
          />

          {mode === 'link' ? (
            <div className="space-y-2.5">
              <Field label={t('import.v2.mode.link')} hint={t('import.linkHint')}>
                <div className="relative">
                  <Link2 size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-mute" />
                  <input
                    className={cn(INPUT_CLASS, 'no-drag pl-8')}
                    value={link}
                    placeholder="https://docs.google.com/document/d/…"
                    spellCheck={false}
                    onChange={(event) => onLink(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && linkInfo && busy === null) onImportLink()
                    }}
                  />
                </div>
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" busy={busy === 'link'} disabled={!linkInfo || busy !== null} onClick={onImportLink}>
                  <Link2 size={13} />
                  {t('import.linkAction')}
                </Button>
                {linkInfo ? (
                  <Badge tone="good">
                    <Check size={10} className="mr-1" />
                    {t('import.v2.linkDetected')}
                  </Badge>
                ) : link.trim().length > 0 ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-warn">
                    <AlertTriangle size={11} />
                    {t('import.v2.linkInvalid')}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {mode === 'file' ? (
            <div className="rounded-xl border border-dashed border-line bg-panel-soft/50 px-4 py-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-brand/25 bg-brand/10 text-brand">
                  <FileText size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{t('import.v2.fileTitle')}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-mute">{t('import.v2.fileHint')}</p>
                  <p className="mt-1 font-mono text-[10px] text-mute/70">.md · .markdown · .txt</p>
                </div>
                <Button variant="primary" busy={busy === 'file'} disabled={busy !== null} onClick={onImportFile}>
                  <FileUp size={13} />
                  {t('import.v2.pickFile')}
                </Button>
              </div>
            </div>
          ) : null}

          {mode === 'paste' ? (
            <div className="space-y-2">
              <textarea
                className={cn(INPUT_CLASS, 'no-drag min-h-44 resize-y font-mono text-[11px] leading-relaxed')}
                value={pasteText}
                placeholder={t('import.v2.pastePlaceholder')}
                spellCheck={false}
                onChange={(event) => onPasteText(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('text-[10px] tabular-nums', pasteReady ? 'text-mute' : 'text-warn')}>
                  {t('import.v2.pasteStats', { lines: pasteLines, chars: pasteText.trim().length })}
                </span>
                <Button size="sm" variant="subtle" onClick={onSample}>
                  <Sparkles size={12} />
                  {t('import.v2.pasteSample')}
                </Button>
                <Button
                  className="ml-auto"
                  variant="primary"
                  busy={busy === 'paste'}
                  disabled={!pasteReady || busy !== null}
                  onClick={onImportPaste}
                >
                  <ClipboardPaste size={13} />
                  {t('import.v2.parsePaste')}
                </Button>
              </div>
              <p className="text-[10px] text-mute">{t('import.v2.pasteMin')}</p>
            </div>
          ) : null}

          {busy !== null ? <Banner tone="info">{t('import.busy')}</Banner> : null}
        </div>
      ) : null}

      <div className="border-t border-line/60 p-4">
        {!hasDraft && workingDraft ? (
          <Banner tone="info" title={t('import.v2.resumeTitle')}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">
                {t('import.v2.resumeBody', {
                  name: workingDraft.ir.meta.name,
                  time: sourceTime(workingDraft.savedAt)
                })}
              </span>
              <Button size="sm" variant="primary" onClick={onResumeWorking}>
                <RotateCcw size={12} />
                {t('import.v2.resume')}
              </Button>
              <Button size="sm" variant="subtle" onClick={onDiscardWorking}>
                <Trash2 size={12} />
                {t('import.v2.discard')}
              </Button>
            </div>
          </Banner>
        ) : null}

        <div className="mt-3 first:mt-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <History size={13} className="text-brand" />
            <p className="text-[12px] font-semibold text-ink">{t('import.v2.historyTitle')}</p>
            <span className="text-[10px] text-mute">{t('import.v2.historyHint')}</span>
            {history.length > 0 ? (
              <Button
                size="sm"
                variant={confirmClear ? 'danger' : 'subtle'}
                className="ml-auto"
                onClick={() => {
                  if (!confirmClear) {
                    setConfirmClear(true)
                    return
                  }
                  onClearHistory()
                  setConfirmClear(false)
                }}
              >
                <Trash2 size={12} />
                {confirmClear ? t('import.v2.clearHistoryConfirm') : t('import.v2.clearHistory')}
              </Button>
            ) : null}
          </div>

          {history.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line bg-panel-soft/40 px-3 py-3 text-[11px] text-mute">
              {t('import.v2.historyEmpty')}
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {history.map((entry) => {
                const unresolved = entry.ir.steps.filter((step) => step.unresolved).length
                return (
                  <li
                    key={entry.id}
                    className="rounded-lg border border-line bg-panel-soft/70 px-3 py-2 transition-colors hover:border-brand/40"
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 text-brand">
                        <SourceBadge origin={entry.origin} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-ink">{entry.ir.meta.name}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-mute">
                          <Clock3 size={9} />
                          <span>{sourceTime(entry.savedAt)}</span>
                          <span>·</span>
                          <span>{t('import.stepsFound', { count: entry.ir.steps.length })}</span>
                          {unresolved > 0 ? <Badge tone="warn">{String(unresolved)}</Badge> : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button size="sm" variant="subtle" onClick={() => onRestore(entry)} title={t('import.v2.restore')}>
                          <RotateCcw size={12} />
                        </Button>
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={() => onDeleteHistory(entry.id)}
                          title={t('import.v2.delete')}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
