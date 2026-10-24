import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Upload } from 'lucide-react'
import { storageUrl } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { supabase } from '../../lib/supabase'
import { SUPABASE_BASE_URL } from '../../lib/storage-base'
import { Badge, Banner, Button, Card, EmptyState, Field, INPUT_CLASS, Row, Toggle, cn } from '../../components/ui'
import {
  EMPTY_CATALOG_ENTRY,
  TAG_KIND_OPTIONS,
  catalogImagePath,
  deleteCatalog,
  fetchCatalog,
  formatAlias,
  isCatalogEntryValid,
  parseAlias,
  saveCatalog,
  uploadCatalogImage,
  type CatalogEntry,
  type CatalogKind
} from './admin-api'
import { ErrorBanner, LoadingBanner } from './admin-ui'
import { useAdminAccess } from './admin-access'
import { CatalogBulkImport } from './CatalogBulkImport'

export interface CatalogPrefill {
  kind: CatalogKind
  key: string
  alias: string[]
  /** Gaps carry one free-text sample; it becomes both names until a human fixes them. */
  name: string
}

const TITLE_KEYS: Record<CatalogKind, MessageKey> = {
  maps: 'admin.maps',
  towers: 'admin.towers',
  mutators: 'admin.mutators',
  tags: 'admin.tags'
}

const IMAGE_KINDS: readonly CatalogKind[] = ['maps', 'towers', 'mutators']

function entryFromPrefill(prefill: CatalogPrefill): CatalogEntry {
  return {
    key: prefill.key,
    nameEn: prefill.name,
    nameTr: prefill.name,
    kind: prefill.kind === 'tags' ? 'style' : '',
    grp: '',
    alias: prefill.alias,
    isEvent: false,
    multiplier: null,
    imagePath: ''
  }
}

function Thumbnail({ path }: { path: string }): ReactNode {
  const t = useT()
  const url = SUPABASE_BASE_URL.length > 0 ? storageUrl(SUPABASE_BASE_URL, path) : null
  if (!url) return <span className="text-xs text-mute">{t('common.none')}</span>
  return <img src={url} alt={path} loading="lazy" className="size-10 rounded-md border border-line object-contain" />
}

interface ImageFieldProps {
  kind: CatalogKind
  entry: CatalogEntry
  disabled: boolean
  onPath: (path: string) => void
}

function ImageField({ kind, entry, disabled, onPath }: ImageFieldProps): ReactNode {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadCatalogImage(kind, entry.key, file),
    onSuccess: (path) => {
      setUploadError(null)
      onPath(path)
    },
    onError: (error: unknown) => setUploadError(error instanceof Error ? error.message : String(error))
  })

  const previewPath = entry.imagePath.trim().length > 0 ? entry.imagePath : catalogImagePath(kind, entry.key)
  const canUpload = !disabled && entry.key.trim().length >= 2 && !uploadMutation.isPending

  return (
    <div className="space-y-2">
      <Field
        label={kind === 'maps' ? t('admin.image') : t('admin.icon')}
        hint={uploadMutation.isPending ? t('admin.uploading') : t('admin.imagePathHint')}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={cn(INPUT_CLASS, 'no-drag min-w-40 flex-1')}
            value={entry.imagePath}
            spellCheck={false}
            disabled={disabled}
            placeholder={previewPath}
            onChange={(event) => onPath(event.target.value)}
          />
          <Thumbnail path={entry.imagePath} />
        </div>
      </Field>

      <Row>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) uploadMutation.mutate(file)
            event.target.value = ''
          }}
        />
        <Button variant="ghost" disabled={!canUpload} busy={uploadMutation.isPending} onClick={() => inputRef.current?.click()}>
          {t('admin.uploadIcon')}
        </Button>
        {entry.imagePath.trim().length > 0 ? (
          <Button variant="subtle" disabled={disabled} onClick={() => onPath('')}>
            {t('admin.clearImage')}
          </Button>
        ) : null}
      </Row>

      {uploadError ? (
        <Banner tone="danger" title={t('common.errorTitle')}>
          {uploadError}
        </Banner>
      ) : null}
    </div>
  )
}

interface CatalogSectionProps {
  kind: CatalogKind
  prefill: CatalogPrefill | null
  onPrefillConsumed: () => void
}

export function CatalogSection({ kind, prefill, onPrefillConsumed }: CatalogSectionProps): ReactNode {
  const t = useT()
  const access = useAdminAccess()
  const queryClient = useQueryClient()
  const [entry, setEntry] = useState<CatalogEntry | null>(null)
  const [isNew, setIsNew] = useState(true)
  const [fromGap, setFromGap] = useState(false)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [filter, setFilter] = useState('')

  const rowsQuery = useQuery({
    queryKey: ['admin', 'catalog', kind],
    queryFn: () => fetchCatalog(kind),
    enabled: supabase !== null && access.isModerator,
    retry: false
  })

  useEffect(() => {
    if (!prefill) return
    setEntry(entryFromPrefill(prefill))
    setIsNew(true)
    setFromGap(true)
    onPrefillConsumed()
  }, [prefill, onPrefillConsumed])

  const saveMutation = useMutation({
    mutationFn: (value: CatalogEntry) => saveCatalog(kind, value),
    onSuccess: () => {
      setEntry(null)
      setFromGap(false)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'catalog', kind] })
    }
  })

  const deleteMutation = useMutation({
    mutationFn: (key: string) => deleteCatalog(kind, key),
    onSuccess: () => {
      setConfirmKey(null)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'catalog', kind] })
    }
  })

  const rows = rowsQuery.data ?? []
  const editing = entry !== null
  const canSave = entry !== null && isCatalogEntryValid(kind, entry)
  const showsAlias = kind === 'towers' || kind === 'mutators'
  const needle = filter.trim().toLocaleLowerCase()
  const filteredRows = needle.length === 0
    ? rows
    : rows.filter((row) =>
        [row.key, row.nameTr, row.nameEn, row.alias.join(' ')]
          .join(' ')
          .toLocaleLowerCase()
          .includes(needle)
      )

  return (
    <div className="space-y-3">
      <Card
        title={t(TITLE_KEYS[kind])}
        hint={rowsQuery.data ? t('admin.rowCount', { count: rows.length }) : undefined}
      >
        <div className="space-y-3">
          {saveMutation.isSuccess || deleteMutation.isSuccess ? <Banner tone="good">{t('admin.saved')}</Banner> : null}
          {!access.isAdmin ? <Banner tone="warn">{t('admin.adminOnly')}</Banner> : null}
          {rowsQuery.isPending ? <LoadingBanner /> : null}
          {rowsQuery.isError ? <ErrorBanner error={rowsQuery.error} /> : null}

          {rowsQuery.data && rows.length === 0 ? <EmptyState title={t('admin.catalogEmpty')} /> : null}

          {rows.length > 0 ? (
            <div className="relative">
              <Search size={12} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-mute" />
              <input
                className={cn(INPUT_CLASS, 'no-drag h-8 py-1 pl-8 text-xs')}
                value={filter}
                placeholder={t('admin.catalogSearch')}
                aria-label={t('admin.catalogSearch')}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
          ) : null}

          {rows.length > 0 && filteredRows.length === 0 ? (
            <EmptyState title={t('admin.catalogNoMatch')} />
          ) : null}

          {filteredRows.length > 0 ? (
            <ul className="divide-y divide-line">
              {filteredRows.map((row) => (
                <li key={row.key} className="flex flex-wrap items-center gap-2 py-2">
                  {IMAGE_KINDS.includes(kind) ? <Thumbnail path={row.imagePath} /> : null}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm">
                      <span className="font-medium">{row.key}</span>
                      <span className="text-mute"> · {row.nameTr}</span>
                      {row.nameEn !== row.nameTr ? <span className="text-mute"> / {row.nameEn}</span> : null}
                    </p>
                    <Row className="gap-1.5">
                      {row.kind ? <Badge tone="neutral">{row.kind}</Badge> : null}
                      {row.grp ? <Badge tone="neutral">{row.grp}</Badge> : null}
                      {row.multiplier !== null ? (
                        <Badge tone="accent">{`×${row.multiplier.toFixed(2)}`}</Badge>
                      ) : null}
                      {row.isEvent ? <Badge tone="warn">{t('admin.isEvent')}</Badge> : null}
                      {row.alias.length > 0 ? <Badge tone="neutral">{t('admin.alias')}</Badge> : null}
                      {row.alias.length > 0 ? <span className="text-[11px] text-mute">{formatAlias(row.alias)}</span> : null}
                    </Row>
                  </div>
                  <Row className="gap-1.5">
                    <Button
                      variant="subtle"
                      disabled={editing || !access.isAdmin}
                      onClick={() => {
                        setIsNew(false)
                        setFromGap(false)
                        setEntry(row)
                      }}
                    >
                      {t('admin.edit')}
                    </Button>
                    {confirmKey === row.key ? (
                      <>
                        <span className="text-xs text-mute">{t('admin.confirmDelete')}</span>
                        <Button variant="danger" busy={deleteMutation.isPending} onClick={() => deleteMutation.mutate(row.key)}>
                          {t('common.yes')}
                        </Button>
                        <Button variant="ghost" disabled={deleteMutation.isPending} onClick={() => setConfirmKey(null)}>
                          {t('admin.cancel')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="subtle"
                        disabled={editing || !access.isAdmin}
                        onClick={() => setConfirmKey(row.key)}
                      >
                        {t('admin.delete')}
                      </Button>
                    )}
                  </Row>
                </li>
              ))}
            </ul>
          ) : null}

          {deleteMutation.isError ? <ErrorBanner error={deleteMutation.error} /> : null}

          {!editing && access.isAdmin ? (
            <Row>
              <Button
                variant="primary"
                disabled={rowsQuery.isPending}
                onClick={() => {
                  setIsNew(true)
                  setFromGap(false)
                  setEntry({ ...EMPTY_CATALOG_ENTRY, kind: kind === 'tags' ? 'style' : '' })
                }}
              >
                {t('admin.newRow')}
              </Button>
              {kind !== 'tags' ? (
                <Button variant="ghost" disabled={rowsQuery.isPending} onClick={() => setBulkOpen((current) => !current)}>
                  <Upload size={13} />
                  {bulkOpen ? t('admin.bulkClose') : t('admin.bulkOpen')}
                </Button>
              ) : null}
            </Row>
          ) : null}

          {access.isAdmin && kind !== 'tags' && bulkOpen ? (
            <div className={editing ? 'hidden' : undefined}>
              <CatalogBulkImport
                kind={kind}
                existingKeys={rows.map((row) => row.key)}
                onClose={() => setBulkOpen(false)}
              />
            </div>
          ) : null}

          {editing && entry ? (
            <div className="space-y-3 rounded-lg border border-line bg-panel-soft p-3">
              {fromGap ? <Banner tone="info">{t('admin.prefilled')}</Banner> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={t('admin.key')}
                  hint={isNew ? undefined : t('admin.keyLockedHint')}
                >
                  <input
                    className={cn(INPUT_CLASS, 'no-drag')}
                    value={entry.key}
                    spellCheck={false}
                    disabled={!isNew}
                    onChange={(event) => setEntry({ ...entry, key: event.target.value.toLowerCase() })}
                  />
                </Field>
                {kind === 'tags' ? (
                  <Field label={t('admin.kind')}>
                    <select
                      className={cn(INPUT_CLASS, 'no-drag')}
                      value={entry.kind}
                      onChange={(event) => setEntry({ ...entry, kind: event.target.value })}
                    >
                      {TAG_KIND_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                <Field label={t('admin.nameTr')}>
                  <input
                    className={cn(INPUT_CLASS, 'no-drag')}
                    value={entry.nameTr}
                    onChange={(event) => setEntry({ ...entry, nameTr: event.target.value })}
                  />
                </Field>
                <Field label={t('admin.nameEn')}>
                  <input
                    className={cn(INPUT_CLASS, 'no-drag')}
                    value={entry.nameEn}
                    spellCheck={false}
                    onChange={(event) => setEntry({ ...entry, nameEn: event.target.value })}
                  />
                </Field>
              </div>

              {showsAlias ? (
                <Field label={t('admin.alias')} hint={t('admin.aliasHint')}>
                  <input
                    className={cn(INPUT_CLASS, 'no-drag')}
                    value={formatAlias(entry.alias)}
                    spellCheck={false}
                    onChange={(event) => setEntry({ ...entry, alias: parseAlias(event.target.value) })}
                  />
                </Field>
              ) : null}

              {kind === 'mutators' ? (
                <>
                  <Field label={t('admin.grp')}>
                    <input
                      className={cn(INPUT_CLASS, 'no-drag')}
                      value={entry.grp}
                      onChange={(event) => setEntry({ ...entry, grp: event.target.value })}
                    />
                  </Field>
                  <Field label={t('admin.multiplier')} hint={t('admin.multiplierHint')}>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0.01}
                        step={0.05}
                        className={cn(INPUT_CLASS, 'no-drag max-w-40 tabular-nums')}
                        value={entry.multiplier ?? ''}
                        placeholder="1.30"
                        onChange={(event) => {
                          const value = event.target.valueAsNumber
                          setEntry({
                            ...entry,
                            multiplier: Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null
                          })
                        }}
                      />
                      {entry.multiplier !== null ? (
                        <Badge tone="accent">{`+${String(Math.round((entry.multiplier - 1) * 100))}%`}</Badge>
                      ) : null}
                    </div>
                  </Field>
                </>
              ) : null}

              {kind === 'maps' ? (
                <Toggle checked={entry.isEvent} onChange={(isEvent) => setEntry({ ...entry, isEvent })} label={t('admin.isEvent')} />
              ) : null}

              {IMAGE_KINDS.includes(kind) ? (
                <ImageField kind={kind} entry={entry} disabled={!access.isAdmin} onPath={(imagePath) => setEntry({ ...entry, imagePath })} />
              ) : null}

              {saveMutation.isError ? <ErrorBanner error={saveMutation.error} /> : null}

              <Row className="justify-end">
                <Button
                  variant="ghost"
                  disabled={saveMutation.isPending}
                  onClick={() => {
                    setFromGap(false)
                    setEntry(null)
                  }}
                >
                  {t('admin.cancel')}
                </Button>
                <Button variant="primary" busy={saveMutation.isPending} disabled={!canSave} onClick={() => saveMutation.mutate(entry)}>
                  {t('admin.save')}
                </Button>
              </Row>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
