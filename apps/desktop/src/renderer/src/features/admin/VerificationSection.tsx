import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, X } from 'lucide-react'
import type { AccountQueueRow } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { navigate } from '../../lib/router'
import { fetchAccountQueue, reviewAccountRequest } from '../../lib/account-api'
import { Banner, Button, Card, Field, INPUT_CLASS, Row } from '../../components/ui'
import { Chip, Segmented } from '../../components/ui/system'
import { ErrorBanner, LoadingBanner, formatDateTime } from './admin-ui'

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const KIND_LABEL: Record<string, MessageKey> = {
  verified: 'verified.title',
  corporate: 'admin.accountKind'
}

function QueueItem({
  row,
  busy,
  onDecide
}: {
  row: AccountQueueRow
  busy: boolean
  onDecide: (input: { id: string; decision: 'approve' | 'reject'; note: string; credits: number | null }) => void
}): ReactNode {
  const t = useT()
  const [note, setNote] = useState('')
  const [credits, setCredits] = useState('')
  const [open, setOpen] = useState(false)

  return (
    <article className="hud-panel space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone={row.kind === 'verified' ? 'brand' : 'neutral'}>{t(KIND_LABEL[row.kind] ?? 'admin.accountKind')}</Chip>
        {row.alreadyVerified ? <Chip tone="good" icon={BadgeCheck}>{t('admin.verifiedTag')}</Chip> : null}
        <span className="hud-num text-[10px] text-mute">{formatDateTime(row.createdAt)}</span>
        <span className="ml-auto text-[11px] text-mute">{t('admin.accountPublished', { count: String(row.published) })}</span>
      </div>

      <button
        type="button"
        className="no-drag text-left text-[13px] font-semibold text-ink hover:text-brand"
        onClick={() => navigate(`/profile/${row.userId}`)}
      >
        {row.displayName ?? `@${row.handle}`}
      </button>

      <p className="whitespace-pre-line break-words text-[12px] leading-relaxed text-ink/85">{row.message}</p>

      {row.links ? (
        <div className="space-y-0.5 rounded-lg border border-line/60 bg-base/40 p-2">
          <span className="hud-label text-mute">{t('admin.accountLinks')}</span>
          <p className="whitespace-pre-line break-all text-[11px] text-mute">{row.links}</p>
        </div>
      ) : null}

      {row.strategyName ? (
        <button
          type="button"
          className="no-drag text-left text-[11px] text-mute hover:text-brand"
          onClick={() => row.strategyId ? navigate(`/strategy/${row.strategyId}`) : undefined}
        >
          {`${t('admin.accountStrategy')}: ${row.strategyName}`}
        </button>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="primary" busy={busy} onClick={() => { setOpen(true); onDecide({ id: row.id, decision: 'approve', note, credits: credits.length > 0 ? Number(credits) : null }) }}>
          <BadgeCheck size={12} />
          {t('admin.accountApprove')}
        </Button>
        <Button size="sm" variant="danger" busy={busy} onClick={() => onDecide({ id: row.id, decision: 'reject', note, credits: null })}>
          <X size={12} />
          {t('admin.accountReject')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>
          {t('admin.accountNote')}
        </Button>
      </div>

      {open ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <Field label={t('admin.accountNoteHint')}>
            <input value={note} onChange={(event) => setNote(event.target.value)} className={cnInput()} maxLength={500} />
          </Field>
          <Field label={t('admin.accountCredits')}>
            <input
              type="number"
              min={0}
              max={10}
              value={credits}
              onChange={(event) => setCredits(event.target.value)}
              className={cnInput()}
              placeholder="1"
            />
          </Field>
        </div>
      ) : null}
    </article>
  )
}

function cnInput(): string {
  return `${INPUT_CLASS} w-full`
}

export function VerificationSection(): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [kind, setKind] = useState<string>('')

  const queueQuery = useQuery({
    queryKey: ['admin', 'accounts', status, kind],
    queryFn: () => fetchAccountQueue(kind.length > 0 ? kind : null, status),
    retry: false
  })

  const decide = useMutation({
    mutationFn: (input: { id: string; decision: 'approve' | 'reject'; note: string; credits: number | null }) =>
      reviewAccountRequest({ requestId: input.id, decision: input.decision, note: input.note, credits: input.credits }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    }
  })

  const rows = queueQuery.data ?? []

  return (
    <Card title={t('admin.accounts')} hint={queueQuery.data ? t('admin.rowCount', { count: rows.length }) : undefined}>
      <div className="space-y-3">
        {queueQuery.isPending ? <LoadingBanner /> : null}
        {queueQuery.isError ? <ErrorBanner error={queueQuery.error} /> : null}
        {decide.isError ? (
          <Banner tone="danger" title={t('common.errorTitle')}>{message(decide.error)}</Banner>
        ) : null}

        <Row className="flex-wrap gap-2">
          <Segmented
            value={status}
            onChange={(next) => setStatus(next as 'pending' | 'approved' | 'rejected')}
            options={[
              { value: 'pending', label: t('verified.statusPending') },
              { value: 'approved', label: t('verified.statusApproved') },
              { value: 'rejected', label: t('verified.statusRejected') }
            ]}
          />
          <Segmented
            value={kind}
            onChange={(next) => setKind(next)}
            options={[
              { value: '', label: t('discover.eventAny') },
              { value: 'verified', label: t('verified.title') },
              { value: 'corporate', label: t('admin.accountKind') }
            ]}
          />
        </Row>

        {rows.length === 0 && !queueQuery.isPending ? (
          <Banner tone="info" title={t('admin.accountsEmpty')}>{t('admin.accountsEmptyHint')}</Banner>
        ) : null}

        <div className="space-y-2">
          {rows.map((row) => (
            <QueueItem
              key={row.id}
              row={row}
              busy={decide.isPending && decide.variables?.id === row.id}
              onDecide={(input) => decide.mutate(input)}
            />
          ))}
        </div>
      </div>
    </Card>
  )
}
