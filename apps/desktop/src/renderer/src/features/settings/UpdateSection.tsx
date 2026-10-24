import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IPC_CHANNELS, updateStatusSchema, type UpdateStatus } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { call } from '../../lib/ipc'
import { useIpcEvent } from '../../lib/events'
import { Badge, Banner, Button, Card, Row } from '../../components/ui'

const STATE_LABEL: Record<UpdateStatus['state'], MessageKey> = {
  idle: 'update.idle',
  checking: 'update.checking',
  available: 'update.available',
  downloading: 'update.downloading',
  downloaded: 'update.downloaded',
  error: 'update.error',
  unsupported: 'update.unsupported'
}

/**
 * The status lives in main (that is where electron-updater runs), so this card only mirrors it: a
 * probe on mount for whatever already happened, plus the broadcast for anything that happens next.
 */
export function UpdateSection(): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()
  const [streamed, setStreamed] = useState<UpdateStatus | null>(null)

  const probe = useQuery({
    queryKey: ['update', 'status'],
    queryFn: () => call<UpdateStatus>(IPC_CHANNELS.updateCheck, { probe: true }),
    staleTime: 300_000,
    retry: false
  })

  useIpcEvent(IPC_CHANNELS.updateStatus, updateStatusSchema, setStreamed)

  const check = useMutation({
    mutationFn: () => call<UpdateStatus>(IPC_CHANNELS.updateCheck, { probe: false }),
    onSuccess: (next) => {
      setStreamed(next)
      void queryClient.invalidateQueries({ queryKey: ['update', 'status'] })
    }
  })

  const install = useMutation({
    mutationFn: () => call<{ started: boolean; status: UpdateStatus }>(IPC_CHANNELS.updateApply),
    onSuccess: (result) => {
      setStreamed(result.status)
      void queryClient.invalidateQueries({ queryKey: ['update', 'status'] })
    }
  })

  const status = streamed ?? probe.data ?? null
  const ready = status?.state === 'downloaded'

  return (
    <Card title={t('update.title')} hint={status ? `v${status.currentVersion}` : undefined}>
      <div className="space-y-3">
        <Row className="flex-wrap">
          <Badge tone={status?.state === 'error' ? 'danger' : ready ? 'good' : 'neutral'}>
            {status ? t(STATE_LABEL[status.state]) : t('common.loading')}
          </Badge>
          {status?.state === 'downloading' && status.progressPercent !== null ? (
            <span className="text-xs text-mute">{`${String(status.progressPercent)}%`}</span>
          ) : null}
          {status?.availableVersion ? <span className="text-xs text-mute">{`→ v${status.availableVersion}`}</span> : null}
        </Row>

        <Row className="flex-wrap">
          <Button variant="subtle" busy={check.isPending || status?.state === 'checking'} onClick={() => check.mutate()}>
            {t('update.check')}
          </Button>
          <Button variant={ready ? 'primary' : 'ghost'} busy={install.isPending} disabled={!ready} onClick={() => install.mutate()}>
            {t('update.restart')}
          </Button>
        </Row>

        {status?.state === 'error' && status.detail ? (
          <Banner tone="danger" title={t('common.errorTitle')}>
            <span title={status.detail}>{t('update.errorHint')}</span>
          </Banner>
        ) : null}

        {status?.state === 'unsupported' ? <Banner tone="info">{t('update.unsupportedHint')}</Banner> : null}

        {check.isError ? (
          <Banner tone="danger" title={t('common.errorTitle')}>
            {check.error.message}
          </Banner>
        ) : null}

        <p className="text-xs text-mute">{t('update.hint')}</p>
      </div>
    </Card>
  )
}
