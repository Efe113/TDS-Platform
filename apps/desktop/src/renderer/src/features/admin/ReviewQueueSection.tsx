import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatWaveRange, type QueueRow, type ReviewDecision } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { navigate } from '../../lib/router'
import { supabase } from '../../lib/supabase'
import { difficultyEntry, playerCountKey } from '../../lib/catalog-labels'
import { Badge, Banner, Button, Card, EmptyState, INPUT_CLASS, Row, cn } from '../../components/ui'
import { fetchQueue, reviewStrategy } from './admin-api'
import { ErrorBanner, LoadingBanner, formatDate } from './admin-ui'
import { useAdminAccess } from './admin-access'
import { VersionDiffCard } from './VersionDiffCard'

const DECISION_LABELS: Record<ReviewDecision, MessageKey> = {
  approve: 'admin.approve',
  feature: 'admin.feature',
  needs_changes: 'admin.needsChanges',
  reject: 'admin.reject',
  archive: 'admin.archive'
}

/** Fixed order so the destructive pair always sits at the end of the row. */
const DECISION_ORDER: readonly ReviewDecision[] = ['approve', 'feature', 'needs_changes', 'reject', 'archive']
const DESTRUCTIVE: readonly ReviewDecision[] = ['reject', 'archive']

interface DecisionRequest {
  strategyId: string
  decision: ReviewDecision
  note: string
}

function statusKey(status: string): MessageKey | null {
  if (status === 'submitted') return 'admin.statusSubmitted'
  if (status === 'needs_changes') return 'admin.statusNeedsChanges'
  return null
}

function latestVersion(row: QueueRow): number {
  return row.strategy_versions.reduce((highest, version) => Math.max(highest, version.version_no), 0)
}

function DecisionButton({
  decision,
  rowId,
  busy,
  onRequest
}: {
  decision: ReviewDecision
  rowId: string
  busy: boolean
  onRequest: (request: DecisionRequest) => void
}): ReactNode {
  const t = useT()
  const isDestructive = DESTRUCTIVE.includes(decision)
  return (
    <Button
      variant={isDestructive ? 'danger' : decision === 'approve' ? 'primary' : 'ghost'}
      busy={busy}
      onClick={() => onRequest({ strategyId: rowId, decision, note: '' })}
    >
      {t(DECISION_LABELS[decision])}
    </Button>
  )
}

interface QueueItemProps {
  row: QueueRow
  pending: DecisionRequest | null
  mutating: DecisionRequest | null
  note: string
  onNoteChange: (next: string) => void
  onRequest: (request: DecisionRequest) => void
  onCancel: () => void
  onConfirm: () => void
}

function QueueItem({ row, pending, mutating, note, onNoteChange, onRequest, onCancel, onConfirm }: QueueItemProps): ReactNode {
  const t = useT()
  const status = statusKey(row.status)
  const difficulty = difficultyEntry(row.difficulty)
  const players = playerCountKey(row.player_count)
  const wave = formatWaveRange(row.wave_from, row.wave_to)
  const owner = row.profiles?.display_name ?? row.profiles?.handle ?? null
  const pendingHere = pending !== null && pending.strategyId === row.id

  return (
    <Card>
      <div className="space-y-3">
        <Row className="justify-between">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-semibold">{row.name}</p>
            <p className="truncate text-xs text-mute">{row.slug}</p>
          </div>
          <Row className="gap-1.5">
            <Badge tone={status === 'admin.statusNeedsChanges' ? 'accent' : 'warn'}>{status ? t(status) : row.status}</Badge>
            <Badge tone={difficulty.tone}>{difficulty.labelKey ? t(difficulty.labelKey) : row.difficulty}</Badge>
            <Badge tone="neutral">{row.game_mode}</Badge>
            {players ? <Badge tone="neutral">{t(players)}</Badge> : null}
            {row.is_event_strategy ? <Badge tone="warn">{t('overlay.eventRibbon')}</Badge> : null}
          </Row>
        </Row>

        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          <p className="text-xs text-mute">
            <span className="uppercase tracking-wide">{t('admin.owner')}: </span>
            {row.profiles?.handle ?? t('common.none')}
            {owner && owner !== row.profiles?.handle ? ` · ${owner}` : ''}
          </p>
          <p className="text-xs text-mute">
            <span className="uppercase tracking-wide">{t('admin.creditCreator')}: </span>
            {row.credit_creator ?? t('common.none')}
          </p>
          <p className="text-xs text-mute">
            <span className="uppercase tracking-wide">{t('discover.map')}: </span>
            {row.map_key ?? t('common.none')}
          </p>
          <p className="text-xs text-mute">
            <span className="uppercase tracking-wide">{t('detail.waves')}: </span>
            {wave ?? t('common.none')}
          </p>
          <p className="text-xs text-mute">
            <span className="uppercase tracking-wide">{t('admin.authorOwn')}: </span>
            {t(row.is_author_own ? 'common.yes' : 'common.no')}
          </p>
          <p className="text-xs text-mute">
            <span className="uppercase tracking-wide">{t('admin.created')}: </span>
            {formatDate(row.created_at)}
          </p>
          <p className="text-xs text-mute">
            <span className="uppercase tracking-wide">{t('admin.versions')}: </span>
            {`${String(row.strategy_versions.length)} (v${String(latestVersion(row))})`}
          </p>
          <p className="text-xs text-mute">{t('detail.usedCount', { count: row.times_used })}</p>
        </div>

        {row.credit_url ? <p className="break-all text-[11px] text-mute">{row.credit_url}</p> : null}

        <Row className="justify-between">
          <Row className="gap-1.5">
            {DECISION_ORDER.map((decision) => (
              <DecisionButton
                key={decision}
                decision={decision}
                rowId={row.id}
                busy={mutating !== null && mutating.strategyId === row.id && mutating.decision === decision}
                onRequest={onRequest}
              />
            ))}
          </Row>
          <Button variant="subtle" onClick={() => navigate(`/strategy/${row.id}`)}>
            {t('admin.open')}
          </Button>
        </Row>

        {pendingHere && pending ? (
          <div className={cn('space-y-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2')}>
            <p className="text-sm">
              {t('admin.confirmDecision')} <span className="font-medium">{t(DECISION_LABELS[pending.decision])}</span>
            </p>
            <input
              className={cn(INPUT_CLASS, 'no-drag')}
              value={note}
              placeholder={t('admin.note')}
              spellCheck={false}
              onChange={(event) => onNoteChange(event.target.value.slice(0, 500))}
            />
            <Row>
              <Button variant="danger" busy={mutating !== null} onClick={onConfirm}>
                {t('common.yes')}
              </Button>
              <Button variant="ghost" disabled={mutating !== null} onClick={onCancel}>
                {t('admin.cancel')}
              </Button>
            </Row>
          </div>
        ) : null}

        <VersionDiffCard strategyId={row.id} versionCount={row.strategy_versions.length} />
      </div>
    </Card>
  )
}

export function ReviewQueueSection(): ReactNode {
  const t = useT()
  const access = useAdminAccess()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<DecisionRequest | null>(null)
  const [note, setNote] = useState('')

  const queueQuery = useQuery({
    queryKey: ['admin', 'queue'],
    queryFn: fetchQueue,
    enabled: supabase !== null && access.isModerator,
    retry: false
  })

  const decideMutation = useMutation({
    mutationFn: (request: DecisionRequest) => reviewStrategy(request.strategyId, request.decision, request.note),
    onSuccess: () => {
      setPending(null)
      setNote('')
      void queryClient.invalidateQueries({ queryKey: ['admin', 'queue'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] })
    },
    onError: () => setPending(null)
  })

  const rows = queueQuery.data ?? []

  // Only the destructive decisions ask for a confirmation; the rest fire on click without a note.
  const handleRequest = (request: DecisionRequest): void => {
    if (DESTRUCTIVE.includes(request.decision)) {
      setNote('')
      setPending(request)
      return
    }
    setPending(null)
    decideMutation.mutate(request)
  }

  return (
    <div className="space-y-3">
      {decideMutation.isSuccess ? <Banner tone="good">{t('admin.decided')}</Banner> : null}
      {decideMutation.isError ? <ErrorBanner error={decideMutation.error} /> : null}

      {queueQuery.isPending ? <LoadingBanner /> : null}
      {queueQuery.isError ? <ErrorBanner error={queueQuery.error} /> : null}

      {!queueQuery.isPending && !queueQuery.isError && rows.length === 0 ? <EmptyState title={t('admin.queueEmpty')} /> : null}

      {rows.map((row) => (
        <QueueItem
          key={row.id}
          row={row}
          pending={pending}
          mutating={decideMutation.variables ?? null}
          note={note}
          onNoteChange={setNote}
          onRequest={handleRequest}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            if (pending) decideMutation.mutate({ ...pending, note })
          }}
        />
      ))}
    </div>
  )
}
