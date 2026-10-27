import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Clock, Hammer, RefreshCw, Wrench } from 'lucide-react'
import { formatRemaining, type MaintenanceState } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { useCatalogLanguage } from '../../lib/catalog-labels'
import { Button, cn } from '../../components/ui'
import { Chip } from '../../components/ui/system'

/**
 * The two faces of maintenance (0046).
 *
 * `read_only` keeps the app usable and says so in a band: the member can still read strategies and
 * play with the overlay, they just cannot buy or post. `locked` adds a gate over the content, because
 * a band is easy to miss when the action you reach for is refused.
 *
 * Both read the same evaluated flag row the server's trigger uses, so the message and the refusal
 * cannot disagree — and both carry the operator's own title and note, plus the time left, which is the
 * difference between "come back later" and "come back at 15:40".
 */

const FROZEN_KEYS = [
  'maintenance.frozenPurchases',
  'maintenance.frozenPosts',
  'maintenance.frozenVotes',
  'maintenance.frozenFavorites',
  'maintenance.frozenApplications'
] as const

function localTime(iso: string | null): string | null {
  if (iso === null) return null
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function Remaining({ state }: { state: MaintenanceState }): ReactNode {
  const t = useT()
  const language = useCatalogLanguage()
  const locale = language === 'en' ? 'en' : 'tr'

  if (state.scheduled && state.startsInMs !== null) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-mute">
        <Clock size={12} />
        {t('maintenance.startsIn', { time: formatRemaining(state.startsInMs, locale) })}
      </span>
    )
  }
  if (state.endsInMs !== null) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-warn">
        <Clock size={12} />
        {t('maintenance.endsIn', { time: formatRemaining(state.endsInMs, locale) })}
        {localTime(state.endsAt) !== null ? (
          <span className="text-mute">· {t('maintenance.until', { time: localTime(state.endsAt) ?? '' })}</span>
        ) : null}
      </span>
    )
  }
  return <span className="text-[11px] text-mute">{t('maintenance.openEnded')}</span>
}

export function MaintenanceBanner({ state }: { state: MaintenanceState }): ReactNode {
  const t = useT()

  return (
    <div className="maintenance-banner flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warn/40 bg-warn/10 px-4 py-2">
      <span className="flex items-center gap-2">
        <span className="maintenance-pulse size-1.5 shrink-0 rounded-full bg-warn" />
        <span className="text-[12px] font-semibold text-warn">{state.title ?? t('maintenance.defaultTitle')}</span>
        <Chip tone={state.mode === 'locked' ? 'danger' : 'warn'} icon={state.mode === 'locked' ? Hammer : Wrench}>
          {t(state.mode === 'locked' ? 'maintenance.modeLocked' : 'maintenance.modeReadOnly')}
        </Chip>
      </span>
      {state.note ? <span className="min-w-0 flex-1 truncate text-[11px] text-mute">{state.note}</span> : null}
      <Remaining state={state} />
    </div>
  )
}

/**
 * The locked gate. Reads stay available below it, so retrying is a real option and not a reload; staff
 * are exempt because a gate that blocks the person who can lift it is a outage that fixes itself never.
 */
export function MaintenanceGate({ state, staff }: { state: MaintenanceState; staff: boolean }): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()

  if (staff) return null

  return (
    <div className="maintenance-gate absolute inset-0 z-40 grid place-items-center bg-base/96 px-6">
      <div className="hud-panel w-full max-w-md p-5">
        <span className="hud-label flex items-center gap-1.5">
          <AlertTriangle size={12} className="text-warn" />
          {t('maintenance.defaultTitle')}
        </span>
        <p className="mt-2 text-[15px] font-semibold leading-snug text-ink">{state.title ?? t('maintenance.gateTitle')}</p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-mute">{state.note ?? t('maintenance.gateBody')}</p>

        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line/60 bg-base/50 px-2.5 py-2">
          <Chip tone="danger" icon={Hammer}>{t('maintenance.modeLocked')}</Chip>
          <Remaining state={state} />
        </div>

        <ul className="mt-3 space-y-1">
          {FROZEN_KEYS.map((key) => (
            <li key={key} className="flex items-center gap-2 text-[11px] text-mute">
              <span className={cn('size-1 shrink-0 rounded-full bg-warn')} />
              {t(key)}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={() => void queryClient.invalidateQueries({ queryKey: ['maintenance'] })}>
            <RefreshCw size={12} />
            {t('maintenance.retry')}
          </Button>
          <span className="text-[10px] leading-snug text-mute/80">{t('maintenance.stillWorks')}</span>
        </div>
      </div>
    </div>
  )
}
