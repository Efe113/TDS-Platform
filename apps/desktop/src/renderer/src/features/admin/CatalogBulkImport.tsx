import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ListChecks, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { Badge, Banner, Button, INPUT_CLASS, Row, Toggle, cn } from '../../components/ui'
import { saveCatalogBulk } from './admin-api'
import { parseCatalogBulk, type BulkCatalogIssueCode, type BulkCatalogKind } from './catalog-bulk'
import { catalogPresetText } from './catalog-presets'

const ISSUE_KEYS: Record<BulkCatalogIssueCode, MessageKey> = {
  key: 'admin.bulkIssue.key',
  name: 'admin.bulkIssue.name',
  duplicate: 'admin.bulkIssue.duplicate',
  multiplier: 'admin.bulkIssue.multiplier'
}

const PRESET_KEYS: Record<BulkCatalogKind, MessageKey> = {
  maps: 'admin.bulkPresetMaps',
  towers: 'admin.bulkPresetTowers',
  mutators: 'admin.bulkPresetMutators'
}

export interface CatalogBulkImportProps {
  kind: BulkCatalogKind
  existingKeys: string[]
  onClose: () => void
}

/**
 * Paste-first catalog entry. The preview is the safety net: nothing reaches PostgREST until every
 * line parses, and the image columns are omitted so a bulk run cannot wipe uploaded artwork.
 */
export function CatalogBulkImport({ kind, existingKeys, onClose }: CatalogBulkImportProps): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [updateExisting, setUpdateExisting] = useState(true)
  const [applied, setApplied] = useState<number | null>(null)

  const parsed = useMemo(() => parseCatalogBulk(kind, text), [kind, text])
  const existing = useMemo(() => new Set(existingKeys), [existingKeys])
  const newCount = parsed.rows.filter((row) => !existing.has(row.key)).length
  const updateCount = parsed.rows.length - newCount
  const eventCount = parsed.rows.filter((row) => row.isEvent).length
  const preset = catalogPresetText(kind)
  const rowsToApply = updateExisting ? parsed.rows : parsed.rows.filter((row) => !existing.has(row.key))
  const canApply = rowsToApply.length > 0 && parsed.issues.length === 0

  const applyMutation = useMutation({
    mutationFn: () => saveCatalogBulk(kind, rowsToApply, updateExisting),
    onSuccess: (count) => {
      setApplied(count)
      setText('')
      void queryClient.invalidateQueries({ queryKey: ['admin', 'catalog', kind] })
    }
  })

  const onText = (value: string): void => {
    setText(value)
    setApplied(null)
  }

  return (
    <section className="space-y-3 rounded-xl border border-brand/30 bg-brand/[0.04] p-3">
      <header className="flex items-start gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-brand/25 bg-brand/10 text-brand">
          <Upload size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink">{t('admin.bulkTitle')}</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-mute">{t('admin.bulkHint')}</p>
        </div>
        <Button size="sm" variant="subtle" onClick={onClose} title={t('admin.bulkClose')}>
          <X size={13} />
        </Button>
      </header>

      {applied !== null ? (
        <Banner tone="good" title={t('admin.bulkApplied', { count: applied })}>
          {t('admin.bulkAppliedHint')}
        </Banner>
      ) : null}

      <div className="rounded-lg border border-line bg-base/50 px-2.5 py-1.5 font-mono text-[10px] text-mute">
        {kind === 'maps'
          ? 'key | name_tr | name_en | | event'
          : kind === 'mutators'
            ? 'key | name_tr | name_en | alias | group | multiplier'
            : 'key | name_tr | name_en | alias1, alias2'}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {preset ? (
          <Button size="sm" variant="ghost" onClick={() => onText(catalogPresetText(kind) ?? '')}>
            <Sparkles size={12} />
            {t(PRESET_KEYS[kind])}
          </Button>
        ) : null}
        {preset ? <span className="text-[10px] text-mute">{t('admin.bulkPresetHint')}</span> : null}
        {text.length > 0 ? (
          <Button size="sm" variant="subtle" className="ml-auto" onClick={() => onText('')}>
            <Trash2 size={12} />
            {t('admin.bulkClear')}
          </Button>
        ) : null}
      </div>

      <textarea
        className={cn(INPUT_CLASS, 'no-drag min-h-40 resize-y font-mono text-[11px] leading-relaxed')}
        value={text}
        placeholder={t('admin.bulkPlaceholder')}
        spellCheck={false}
        onChange={(event) => onText(event.target.value)}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{t('admin.bulkRows', { count: parsed.rows.length })}</Badge>
        <Badge tone="good">{t('admin.bulkNewCount', { count: newCount })}</Badge>
        <Badge tone="accent">{t('admin.bulkUpdateCount', { count: updateCount })}</Badge>
        {eventCount > 0 ? <Badge tone="warn">{t('admin.bulkEventCount', { count: eventCount })}</Badge> : null}
        {parsed.issues.length > 0 ? (
          <Badge tone="danger">{t('admin.bulkIssueCount', { count: parsed.issues.length })}</Badge>
        ) : null}
      </div>

      {parsed.issues.length > 0 ? (
        <ul className="max-h-32 space-y-1 overflow-y-auto pr-1">
          {parsed.issues.map((issue) => (
            <li
              key={`${String(issue.line)}-${issue.code}`}
              className="flex items-start gap-1.5 rounded-md border border-danger/30 bg-danger/[0.06] px-2 py-1 text-[10px] text-danger"
            >
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span>
                {t('admin.bulkIssueLine', { line: issue.line })} · {t(ISSUE_KEYS[issue.code])}
                {issue.key ? <span className="ml-1 font-mono opacity-80">{issue.key}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {text.trim().length > 0 && parsed.rows.length === 0 && parsed.issues.length === 0 ? (
        <p className="text-[10px] text-mute">{t('admin.bulkNoRows')}</p>
      ) : null}

      {parsed.rows.length > 0 ? (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-mute/70">
            <ListChecks size={11} /> {t('admin.bulkPreview')}
          </p>
          <ul className="max-h-56 divide-y divide-line/60 overflow-y-auto rounded-lg border border-line bg-panel-soft/40 pr-1">
            {parsed.rows.map((row) => {
              const isNew = !existing.has(row.key)
              return (
                <li key={`${String(row.line)}-${row.key}`} className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5">
                  <span className="w-6 shrink-0 text-right font-mono text-[9px] tabular-nums text-mute">{row.line}</span>
                  <span className="font-mono text-[10px] text-brand">{row.key}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
                    {row.nameTr}
                    {row.nameEn !== row.nameTr ? <span className="text-mute"> / {row.nameEn}</span> : null}
                  </span>
                  {row.group ? <Badge tone="neutral">{row.group}</Badge> : null}
                  {row.multiplier !== null ? <Badge tone="accent">{`×${row.multiplier.toFixed(2)}`}</Badge> : null}
                  {row.isEvent ? <Badge tone="warn">{t('admin.isEvent')}</Badge> : null}
                  <Badge tone={isNew ? 'good' : updateExisting ? 'accent' : 'neutral'}>
                    {isNew
                      ? t('admin.bulkStateNew')
                      : updateExisting
                        ? t('admin.bulkStateUpdate')
                        : t('admin.bulkStateSkip')}
                  </Badge>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      <Toggle
        checked={updateExisting}
        onChange={setUpdateExisting}
        label={t('admin.bulkUpdateExisting')}
      />
      <p className="-mt-1 text-[10px] leading-relaxed text-mute">{t('admin.bulkUpdateHint')}</p>
      {parsed.rows.length > 0 && rowsToApply.length === 0 ? (
        <p className="text-[10px] text-warn">{t('admin.bulkNothingNew')}</p>
      ) : null}
      <p className="text-[10px] leading-relaxed text-mute">{t('admin.bulkSeedNote')}</p>

      {applyMutation.isError ? (
        <Banner tone="danger" title={t('common.errorTitle')}>
          {applyMutation.error.message}
        </Banner>
      ) : null}

      <Row className="justify-end">
        <Button variant="ghost" disabled={applyMutation.isPending} onClick={onClose}>
          {t('admin.bulkClose')}
        </Button>
        <Button
          variant="primary"
          busy={applyMutation.isPending}
          disabled={!canApply}
          onClick={() => applyMutation.mutate()}
        >
          <CheckCircle2 size={13} />
          {t('admin.bulkApply', { count: rowsToApply.length })}
        </Button>
      </Row>
    </section>
  )
}
