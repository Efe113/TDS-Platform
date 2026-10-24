import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { supabase } from '../../lib/supabase'
import { Badge, Banner, Button, Card, EmptyState, KeyValue, Row, cn } from '../../components/ui'
import { fetchVersionSnapshots } from './admin-api'
import { diffIr, inventoryLine, isDiffEmpty, loadIr, stepLine } from './diff-ir'
import { ErrorBanner, LoadingBanner } from './admin-ui'
import { useAdminAccess } from './admin-access'

/** Long diffs are scrolled, not truncated silently: the count badge always shows the real total. */
const MAX_ROWS_PER_SECTION = 25

const KIND_KEYS = {
  added: 'admin.added',
  removed: 'admin.removed',
  changed: 'admin.changed'
} as const satisfies Record<string, MessageKey>

const KIND_TONES = {
  added: 'good',
  removed: 'danger',
  changed: 'warn'
} as const satisfies Record<string, 'good' | 'danger' | 'warn'>

function ChangeRow({ kind, title, detail }: { kind: keyof typeof KIND_KEYS; title: string; detail: string }): ReactNode {
  return (
    <li className="rounded-lg border border-line bg-panel-soft px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={KIND_TONES[kind]}>{title}</Badge>
        <span className="text-sm">{detail}</span>
      </div>
    </li>
  )
}

interface Props {
  strategyId: string
  versionCount: number
}

export function VersionDiffCard({ strategyId, versionCount }: Props): ReactNode {
  const t = useT()
  const access = useAdminAccess()
  const [open, setOpen] = useState(false)

  const versionsQuery = useQuery({
    queryKey: ['admin', 'versions', strategyId],
    queryFn: () => fetchVersionSnapshots(strategyId),
    enabled: open && supabase !== null && access.isModerator,
    retry: false,
    staleTime: 30_000
  })

  const comparison = useMemo(() => {
    const versions = [...(versionsQuery.data ?? [])].sort((a, b) => b.version_no - a.version_no)
    const newest = versions[0]
    const previous = versions[1]
    if (!newest || !previous) return { state: 'single' as const, newest, previous }
    const newIr = loadIr(newest.content)
    const oldIr = loadIr(previous.content)
    if (!newIr || !oldIr) return { state: 'unreadable' as const, newest, previous }
    return { state: 'ready' as const, newest, previous, diff: diffIr(oldIr, newIr) }
  }, [versionsQuery.data])

  if (versionCount < 2) {
    return (
      <Card title={t('admin.versionDiff')}>
        <EmptyState title={t('admin.singleVersion')} />
      </Card>
    )
  }

  return (
    <Card
      title={t('admin.versionDiff')}
      hint={`${t('admin.versions')}: ${String(versionCount)}`}
      className="border-brand/30"
    >
      <div className="space-y-3">
        <Row>
          <Button variant={open ? 'subtle' : 'ghost'} onClick={() => setOpen((current) => !current)}>
            {t(open ? 'common.hide' : 'common.show')}
          </Button>
        </Row>

        {open ? (
          <div className="space-y-3">
            {versionsQuery.isPending ? <LoadingBanner /> : null}
            {versionsQuery.isError ? <ErrorBanner error={versionsQuery.error} /> : null}

            {comparison.state === 'single' ? <EmptyState title={t('admin.singleVersion')} /> : null}
            {comparison.state === 'unreadable' ? <Banner tone="warn">{t('admin.diffFailed')}</Banner> : null}

            {comparison.state === 'ready' && comparison.diff && comparison.newest && comparison.previous ? (
              <div className="space-y-3">
                <KeyValue label={t('admin.versionDiff')}>
                  <Row>
                    <Badge tone="neutral">{t('detail.version', { version: comparison.previous.version_no })}</Badge>
                    <span className="text-mute">→</span>
                    <Badge tone="accent">{t('detail.version', { version: comparison.newest.version_no })}</Badge>
                  </Row>
                </KeyValue>

                {isDiffEmpty(comparison.diff) ? (
                  <Banner tone="info">{t('admin.noDifference')}</Banner>
                ) : (
                  <>
                    {comparison.diff.steps.length > 0 ? (
                      <section className="space-y-2">
                        <Row className="justify-between">
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-mute">{t('detail.steps')}</h3>
                          <Badge tone="neutral">{t('admin.rowCount', { count: comparison.diff.steps.length })}</Badge>
                        </Row>
                        <ul className="space-y-1.5">
                          {comparison.diff.steps.slice(0, MAX_ROWS_PER_SECTION).map((change) => (
                            <ChangeRow
                              key={`step-${String(change.stepNo)}-${change.kind}`}
                              kind={change.kind}
                              title={`${t(KIND_KEYS[change.kind])} · ${String(change.stepNo)}`}
                              detail={
                                change.kind === 'added'
                                  ? stepLine(change.after)
                                  : change.kind === 'removed'
                                    ? stepLine(change.before)
                                    : `${change.fields.join(', ')} — ${stepLine(change.after)}`
                              }
                            />
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    {comparison.diff.inventory.length > 0 ? (
                      <section className="space-y-2">
                        <Row className="justify-between">
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-mute">{t('detail.inventory')}</h3>
                          <Badge tone="neutral">{t('admin.rowCount', { count: comparison.diff.inventory.length })}</Badge>
                        </Row>
                        <ul className="space-y-1.5">
                          {comparison.diff.inventory.slice(0, MAX_ROWS_PER_SECTION).map((change) => (
                            <ChangeRow
                              key={`inv-${change.towerKey}-${change.kind}`}
                              kind={change.kind}
                              title={t(KIND_KEYS[change.kind])}
                              detail={
                                change.kind === 'changed'
                                  ? `${inventoryLine(change.before)} → ${inventoryLine(change.after)}`
                                  : inventoryLine(change.after ?? change.before)
                              }
                            />
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    {comparison.diff.meta.length > 0 ? (
                      <section className="space-y-2">
                        <Row className="justify-between">
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-mute">{t('admin.metaChanges')}</h3>
                          <Badge tone="neutral">{t('admin.rowCount', { count: comparison.diff.meta.length })}</Badge>
                        </Row>
                        <ul className="space-y-1">
                          {comparison.diff.meta.map((change) => (
                            <li
                              key={change.field}
                              className={cn('rounded-lg border border-line bg-panel-soft px-3 py-2 text-xs', 'space-y-1')}
                            >
                              <p className="font-medium text-ink">{change.field}</p>
                              <p>
                                <span className="text-mute">{t('admin.diffBefore')}: </span>
                                {change.before.length > 0 ? change.before : t('common.none')}
                              </p>
                              <p>
                                <span className="text-mute">{t('admin.diffAfter')}: </span>
                                {change.after.length > 0 ? change.after : t('common.none')}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  )
}
