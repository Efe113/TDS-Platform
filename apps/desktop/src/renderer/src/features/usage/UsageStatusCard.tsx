import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IPC_CHANNELS, settingsSchema } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { call } from '../../lib/ipc'
import { useUsageFlush, useUsageStatus } from '../../lib/usage'
import { Badge, Banner, Button, Card, Row } from '../../components/ui'

/** Which reason text to show instead of a raw server message. */
function reasonKey(error: string | null): MessageKey | null {
  if (!error) return null
  if (error === 'usage.notPublished' || error.startsWith('NOT_PUBLISHED')) return 'usage.reasonNotPublished'
  if (error === 'usage.notConfigured') return 'usage.reasonNotConfigured'
  if (error.startsWith('ANONYMOUS')) return 'usage.reasonSignedOut'
  return null
}

export function UsageStatusCard(): ReactNode {
  const t = useT()
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: async () => settingsSchema.parse(await call<unknown>(IPC_CHANNELS.settingsGet)),
    retry: false
  })
  const statusQuery = useUsageStatus()
  const flush = useUsageFlush()

  const status = statusQuery.data
  const trackingEnabled = settingsQuery.data?.usageTracking ?? true
  const reason = status && !status.counted ? reasonKey(status.lastError) : null

  return (
    <Card title={t('usage.title')}>
      <div className="space-y-3">
        {!trackingEnabled ? (
          <Banner tone="info">{t('usage.disabled')}</Banner>
        ) : status?.counted ? (
          <Row className="flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <p className="text-sm">{t('usage.counting', { count: String(status.pendingForward) })}</p>
              <p className="text-xs text-mute">
                {status.pending > 0
                  ? t('usage.pending', { count: String(status.pending) })
                  : t('usage.inSync')}
              </p>
              {status.attempts > 0 ? <p className="text-xs text-mute">{t('usage.retrying', { attempts: String(status.attempts) })}</p> : null}
            </div>
            <Row>
              {status.pending > 0 ? <Badge tone="warn">{String(status.pending)}</Badge> : <Badge tone="good">{t('usage.synced')}</Badge>}
              <Button busy={flush.isPending} disabled={status.pending === 0} onClick={() => flush.mutate()}>
                {t('usage.flushNow')}
              </Button>
            </Row>
          </Row>
        ) : (
          <Banner tone="warn">
            {reason ? t(reason) : t('usage.reasonOther')}
            {!reason && status?.lastError ? <p className="mt-1 break-words text-xs text-mute">{status.lastError}</p> : null}
          </Banner>
        )}

        {flush.isSuccess ? (
          <Banner tone={flush.data.accepted ? 'good' : 'info'}>
            {flush.data.messageKey ? t(flush.data.messageKey) : t('usage.inSync')}
            {flush.data.detail ? <p className="mt-1 break-words text-xs text-mute">{flush.data.detail}</p> : null}
          </Banner>
        ) : null}

        {flush.isError ? <Banner tone="danger" title={t('common.errorTitle')}>{flush.error.message}</Banner> : null}

        <p className="text-xs text-mute">{t('usage.policyHint')}</p>
      </div>
    </Card>
  )
}
