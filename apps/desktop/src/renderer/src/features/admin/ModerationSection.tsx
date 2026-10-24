import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ModerationReport, ReportTarget } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { navigate } from '../../lib/router'
import { deleteComment, fetchModerationQueue, resolveReport } from '../../lib/social-api'
import { Badge, Banner, Button, Card, EmptyState, Field, INPUT_CLASS, Row } from '../../components/ui'
import { ErrorBanner, LoadingBanner, formatDateTime } from './admin-ui'

const TARGET_LABEL: Record<ReportTarget, MessageKey> = {
  strategy: 'admin.modTargetStrategy',
  comment: 'admin.modTargetComment',
  profile: 'admin.modTargetProfile'
}

const TARGET_TONE: Record<ReportTarget, 'neutral' | 'warn' | 'danger'> = {
  strategy: 'warn',
  comment: 'neutral',
  profile: 'danger'
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ModerationSection(): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const queueQuery = useQuery({
    queryKey: ['admin', 'moderation'],
    queryFn: () => fetchModerationQueue(100),
    retry: false
  })

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'moderation'] })
  }

  const resolveMutation = useMutation({
    mutationFn: (input: { reportId: string; status: 'resolved' | 'dismissed' }) =>
      resolveReport(input.reportId, input.status, note.trim().length > 0 ? note.trim() : null),
    onSuccess: () => {
      setNoteFor(null)
      setNote('')
      refresh()
    }
  })

  const removeMutation = useMutation({
    mutationFn: (commentId: string) => deleteComment(commentId),
    onSuccess: refresh
  })

  const reports = queueQuery.data?.reports ?? []
  const takedowns = queueQuery.data?.takedowns ?? []

  // A comment cannot be opened (it lives inside the discussion of its strategy), so only the other
  // two targets get a link.
  const openTarget = (target: ReportTarget, id: string): void => {
    navigate(target === 'profile' ? `/profile/${id}` : `/detail/${id}`)
  }

  return (
    <Card
      title={t('admin.moderation')}
      hint={queueQuery.data ? t('admin.rowCount', { count: reports.length + takedowns.length }) : undefined}
    >
      <div className="space-y-3">
        {queueQuery.isPending ? <LoadingBanner /> : null}
        {queueQuery.isError ? <ErrorBanner error={queueQuery.error} /> : null}
        {resolveMutation.isError ? (
          <Banner tone="danger" title={t('common.errorTitle')}>{message(resolveMutation.error)}</Banner>
        ) : null}
        {removeMutation.isError ? (
          <Banner tone="danger" title={t('common.errorTitle')}>{message(removeMutation.error)}</Banner>
        ) : null}

        {queueQuery.data && reports.length === 0 && takedowns.length === 0 ? (
          <EmptyState title={t('admin.moderationEmpty')} body={t('admin.moderationEmptyHint')} />
        ) : null}

        {reports.map((report: ModerationReport) => (
          <div key={report.id} className="space-y-2 rounded-lg border border-line bg-panel-soft p-3">
            <Row className="flex-wrap justify-between">
              <Row className="gap-1.5">
                <Badge tone={TARGET_TONE[report.targetType]}>{t(TARGET_LABEL[report.targetType])}</Badge>
                <Badge tone="neutral">{report.reason}</Badge>
                <span className="text-[11px] text-mute">{`${t('admin.moderationReporter')}: ${report.reporter ?? t('common.none')}`}</span>
              </Row>
              <span className="text-[11px] text-mute">{formatDateTime(report.createdAt)}</span>
            </Row>

            <p className="text-sm">{report.targetLabel ?? report.targetId}</p>
            {report.detail ? <p className="whitespace-pre-wrap text-xs text-mute">{report.detail}</p> : null}

            <Row className="flex-wrap">
              {report.targetType === 'comment' ? (
                <Button variant="ghost" busy={removeMutation.isPending} onClick={() => removeMutation.mutate(report.targetId)}>
                  {t('admin.moderationRemoveComment')}
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => openTarget(report.targetType, report.targetId)}>
                  {t('admin.moderationOpen')}
                </Button>
              )}
              <Button
                variant="subtle"
                busy={resolveMutation.isPending}
                onClick={() => resolveMutation.mutate({ reportId: report.id, status: 'resolved' })}
              >
                {t('admin.moderationResolve')}
              </Button>
              <Button
                variant="ghost"
                busy={resolveMutation.isPending}
                onClick={() => resolveMutation.mutate({ reportId: report.id, status: 'dismissed' })}
              >
                {t('admin.moderationDismiss')}
              </Button>
              <Button variant="ghost" onClick={() => setNoteFor(noteFor === report.id ? null : report.id)}>
                {t('admin.moderationNote')}
              </Button>
            </Row>

            {noteFor === report.id ? (
              <Field label={t('admin.moderationNoteHint')}>
                <textarea className={INPUT_CLASS} rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
              </Field>
            ) : null}
          </div>
        ))}

        {takedowns.map((request) => (
          <div key={request.id} className="space-y-2 rounded-lg border border-line bg-panel-soft p-3">
            <Row className="flex-wrap justify-between">
              <Badge tone="danger">{t('social.takedown')}</Badge>
              <span className="text-[11px] text-mute">{formatDateTime(request.createdAt)}</span>
            </Row>
            <p className="text-sm">{request.strategyName ?? request.strategyId ?? t('common.none')}</p>
            <p className="select-text text-xs text-mute">{`${request.claimantName} · ${request.claimantEmail}`}</p>
            <p className="whitespace-pre-wrap text-xs">{request.statement}</p>
            {request.strategyId ? (
              <Row className="flex-wrap">
                <Button variant="ghost" onClick={() => navigate(`/detail/${request.strategyId ?? ''}`)}>
                  {t('admin.moderationOpen')}
                </Button>
              </Row>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  )
}
