import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { cn } from '../../components/ui'
import type { ReadinessCheck, ReadinessId } from './import-draft'

export const CHECK_LABEL: Record<ReadinessId, MessageKey> = {
  name: 'import.v2.check.name',
  creator: 'import.v2.check.creator',
  event: 'import.v2.check.event',
  steps: 'import.v2.check.steps',
  errors: 'import.v2.check.errors',
  inventory: 'import.v2.check.inventory',
  inventoryKeys: 'import.v2.check.inventoryKeys',
  unresolved: 'import.v2.check.unresolved',
  gameMode: 'import.v2.check.gameMode',
  map: 'import.v2.check.map',
  waveRange: 'import.v2.check.waveRange',
  signedIn: 'import.v2.check.signedIn',
  duplicate: 'import.v2.check.duplicate'
}

export function ImportChecklist({
  checks,
  onGo
}: {
  checks: ReadinessCheck[]
  onGo: (id: ReadinessId) => void
}): ReactNode {
  const t = useT()
  return (
    <ul className="space-y-0.5">
      {checks.map((check) => {
        const Icon = check.done ? CheckCircle2 : check.level === 'blocker' ? XCircle : AlertTriangle
        return (
          <li key={check.id}>
            <button
              type="button"
              data-press
              onClick={() => onGo(check.id)}
              className={cn(
                'no-drag flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-panel-soft',
                !check.done && check.level === 'blocker' && 'bg-danger/[0.04]'
              )}
            >
              <Icon
                size={13}
                className={cn(
                  'mt-0.5 shrink-0',
                  check.done ? 'text-good' : check.level === 'blocker' ? 'text-danger' : 'text-warn'
                )}
              />
              <span className="min-w-0 flex-1">
                <span className={cn('block text-[11px]', check.done ? 'text-mute' : 'text-ink')}>{t(CHECK_LABEL[check.id])}</span>
                {check.detail ? <span className="block text-[10px] text-mute/80">{check.detail}</span> : null}
              </span>
              {!check.done ? (
                <span
                  className={cn(
                    'shrink-0 text-[9px] uppercase tracking-wide',
                    check.level === 'blocker' ? 'text-danger' : 'text-warn'
                  )}
                >
                  {check.level === 'blocker' ? t('import.v2.blocker') : t('import.v2.warning')}
                </span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
