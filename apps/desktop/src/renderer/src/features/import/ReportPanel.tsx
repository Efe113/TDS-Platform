import type { ReactNode } from 'react'
import type { ReportIssue, ValidationReport } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { formatBytes } from '../../lib/text'
import { Badge, Card, EmptyState, KeyValue } from '../../components/ui'

const LEVELS: { level: ReportIssue['level']; titleKey: MessageKey; tone: 'danger' | 'warn' | 'neutral' }[] = [
  { level: 'error', titleKey: 'import.level.error', tone: 'danger' },
  { level: 'warning', titleKey: 'import.level.warning', tone: 'warn' },
  { level: 'info', titleKey: 'import.level.info', tone: 'neutral' }
]

function IssueRow({ issue }: { issue: ReportIssue }): ReactNode {
  return (
    <li className="rounded-lg border border-line bg-panel-soft px-3 py-2">
      <p className="text-sm">{issue.message}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mute">
        <Badge>{issue.code}</Badge>
        {issue.path ? <span>{issue.path}</span> : null}
        {issue.sample ? <span className="line-clamp-2 max-w-xl break-words">{issue.sample}</span> : null}
      </div>
    </li>
  )
}

export function ReportPanel({ report }: { report: ValidationReport }): ReactNode {
  const t = useT()

  return (
    <div className="space-y-4">
      <Card title={t('import.reportTitle')}>
        {report.issues.length === 0 ? (
          <EmptyState title={t('import.report.clean')} />
        ) : (
          <div className="space-y-4">
            {report.ok ? <p className="text-sm text-good">{t('import.report.clean')}</p> : null}
            {LEVELS.map((entry) => {
              const issues = report.issues.filter((issue) => issue.level === entry.level)
              if (issues.length === 0) return null
              return (
                <div key={entry.level} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={entry.tone}>{t(entry.titleKey)}</Badge>
                    <span className="text-xs text-mute">{String(issues.length)}</span>
                  </div>
                  <ul className="space-y-2">
                    {issues.map((issue, index) => (
                      <IssueRow key={`${issue.code}-${String(index)}`} issue={issue} />
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card title={t('import.statsTitle')}>
        <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-4">
          <KeyValue label={t('import.stat.blocks')}>{String(report.stats.blocks)}</KeyValue>
          <KeyValue label={t('import.stat.sections')}>{String(report.stats.sections)}</KeyValue>
          <KeyValue label={t('import.stat.images')}>{String(report.stats.images)}</KeyValue>
          <KeyValue label={t('import.stat.imageBytes')}>{formatBytes(report.stats.imageBytes)}</KeyValue>
          <KeyValue label={t('import.stat.steps')}>{String(report.stats.steps)}</KeyValue>
          <KeyValue label={t('import.stat.unresolved')}>{String(report.stats.unresolvedClauses)}</KeyValue>
          <KeyValue label={t('import.stat.inventory')}>{String(report.stats.inventory)}</KeyValue>
          <KeyValue label={t('import.stat.media')}>{String(report.stats.mediaSaved)}</KeyValue>
        </div>
      </Card>
    </div>
  )
}
