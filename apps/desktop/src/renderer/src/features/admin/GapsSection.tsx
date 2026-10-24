import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT } from '../../i18n/use-t'
import { supabase } from '../../lib/supabase'
import { Badge, Button, Card, EmptyState, Row, cn } from '../../components/ui'
import { fetchUnmatchedRows, sampleLines, sampleText, type CatalogKind } from './admin-api'
import { ErrorBanner, LoadingBanner, formatDateTime } from './admin-ui'
import { useAdminAccess } from './admin-access'
import type { CatalogPrefill } from './CatalogSection'

const KIND_TO_CATALOG: Record<string, CatalogKind> = {
  tower: 'towers',
  mutator: 'mutators',
  map: 'maps'
}

const GAP_KIND_TONES: Record<string, 'neutral' | 'accent' | 'warn' | 'danger' | 'good'> = {
  tower: 'accent',
  mutator: 'accent',
  map: 'warn',
  icon: 'neutral',
  section: 'neutral'
}

/** Mirrors app.unique_slug closely enough that the suggested key matches the eventual slug style. */
export function suggestKey(value: string): string {
  const transliterated = value
    .toLowerCase()
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  // Too short to be a real key: keep the raw text so the editor can fix it instead of inventing one.
  if (transliterated.length < 2) return value.trim().toLowerCase().slice(0, 60)
  return transliterated.slice(0, 60)
}

function GapKindBadge({ kind }: { kind: string }): ReactNode {
  const tone = GAP_KIND_TONES[kind] ?? 'neutral'
  return <Badge tone={tone}>{kind}</Badge>
}

interface GapCardProps {
  id: string
  jobId: string
  kind: string
  sample: Record<string, unknown>
  createdAt: string
  onAddToCatalog: (prefill: CatalogPrefill) => void
}

function GapCard({ id, jobId, kind, sample, createdAt, onAddToCatalog }: GapCardProps): ReactNode {
  const t = useT()
  const catalogKind = KIND_TO_CATALOG[kind]
  const text = sampleText(sample)
  const lines = sampleLines(sample)

  return (
    <div className="space-y-2 rounded-lg border border-line bg-panel-soft p-3">
      <Row className="justify-between">
        <Row className="gap-1.5">
          <GapKindBadge kind={kind} />
          <span className="text-sm">{text ?? id}</span>
        </Row>
        <span className="text-[11px] text-mute">{formatDateTime(createdAt)}</span>
      </Row>

      {lines.length === 0 ? (
        <p className="text-xs text-mute">{t('common.none')}</p>
      ) : (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-mute">{t('admin.sample')}</p>
          <ul className="space-y-0.5">
            {lines.map((line) => (
              <li key={line} className={cn('break-all text-[11px] text-mute')}>
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Row className="justify-between">
        <span className="break-all text-[11px] text-mute">{`${t('admin.job')}: ${jobId}`}</span>
        {catalogKind && text ? (
          <Button
            variant="ghost"
            onClick={() =>
              onAddToCatalog({
                kind: catalogKind,
                key: suggestKey(text),
                name: text,
                alias: catalogKind === 'towers' || catalogKind === 'mutators' ? [text] : []
              })
            }
          >
            {t('admin.addToCatalog')}
          </Button>
        ) : (
          <span className="text-[11px] text-mute">{t('admin.noCatalogShortcut')}</span>
        )}
      </Row>
    </div>
  )
}

export function GapsSection({ onAddToCatalog }: { onAddToCatalog: (prefill: CatalogPrefill) => void }): ReactNode {
  const t = useT()
  const access = useAdminAccess()

  const gapsQuery = useQuery({
    queryKey: ['admin', 'unmatched'],
    queryFn: fetchUnmatchedRows,
    enabled: supabase !== null && access.isModerator,
    retry: false
  })

  const rows = gapsQuery.data ?? []

  return (
    <Card title={t('admin.gaps')} hint={gapsQuery.data ? t('admin.rowCount', { count: rows.length }) : undefined}>
      <div className="space-y-3">
        {gapsQuery.isPending ? <LoadingBanner /> : null}
        {gapsQuery.isError ? <ErrorBanner error={gapsQuery.error} /> : null}
        {gapsQuery.data && rows.length === 0 ? <EmptyState title={t('admin.gapEmpty')} body={t('admin.gapEmptyHint')} /> : null}
        {rows.map((row) => (
          <GapCard
            key={row.id}
            id={row.id}
            jobId={row.job_id}
            kind={row.kind}
            sample={row.sample}
            createdAt={row.created_at}
            onAddToCatalog={onAddToCatalog}
          />
        ))}
      </div>
    </Card>
  )
}
