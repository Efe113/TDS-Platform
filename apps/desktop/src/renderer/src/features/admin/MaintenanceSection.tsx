import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Hammer, Power, Wrench } from 'lucide-react'
import {
  MAINTENANCE_QUICK_HOURS,
  formatRemaining,
  maintenanceWindow,
  type MaintenanceMode,
  type MaintenanceState
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { useCatalogLanguage } from '../../lib/catalog-labels'
import { fetchMaintenance, setMaintenance } from './admin-api'
import { Banner, Button, INPUT_CLASS, cn } from '../../components/ui'
import { Chip, Section, Segmented } from '../../components/ui/system'
import { StateLoading } from '../../components/ui/states'
import { fromLocalInput, toLocalInput } from './admin-ui'
import { MaintenanceBanner } from '../shell/MaintenanceSurface'

/**
 * The maintenance console (0046).
 *
 * The switch in the health panel could only say "on", which meant every real maintenance — announce it,
 * run it, and let it end by itself — was a manual two-step at midnight. This section owns the whole
 * window: mode, the member-facing title and note, a start that can be in the future, and an end that
 * turns the flag off by itself because the server evaluates the window on every write.
 *
 * The preview is the actual banner component, not a drawing of it, so what the operator sees is what a
 * member gets.
 */

/** What the server's triggers freeze, straight from the list 0046 attaches them to. */
const FROZEN_TABLES = [
  'spend_orders',
  'user_themes',
  'strategy_boosts',
  'comments',
  'ratings',
  'favorites',
  'account_requests',
  'reports'
] as const

function StatusChip({ state }: { state: MaintenanceState }): ReactNode {
  const t = useT()
  if (state.on && state.mode === 'locked') return <Chip tone="danger" icon={Hammer}>{t('admin.maintLocked')}</Chip>
  if (state.on) return <Chip tone="warn" icon={Wrench}>{t('admin.maintenanceOn')}</Chip>
  if (state.scheduled) return <Chip tone="brand">{t('admin.maintScheduled')}</Chip>
  if (state.expired) return <Chip tone="neutral">{t('admin.maintExpired')}</Chip>
  return <Chip tone="good">{t('admin.maintenanceOff')}</Chip>
}

export function MaintenanceSection(): ReactNode {
  const t = useT()
  const language = useCatalogLanguage()
  const queryClient = useQueryClient()
  const stateQuery = useQuery({ queryKey: ['admin', 'maintenance'], queryFn: fetchMaintenance, retry: 1 })

  const state = stateQuery.data ?? null
  const [mode, setMode] = useState<MaintenanceMode>('read_only')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [startsAt, setStartsAt] = useState<string | null>(null)
  const [endsAt, setEndsAt] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const window = useMemo(() => maintenanceWindow(startsAt, endsAt), [startsAt, endsAt])

  const save = useMutation({
    mutationFn: (on: boolean) =>
      setMaintenance({
        on,
        mode,
        title: title.trim().length > 0 ? title.trim() : null,
        note: note.trim().length > 0 ? note.trim() : null,
        startsAt: on ? startsAt : null,
        endsAt: on ? endsAt : null
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'maintenance'] })
      void queryClient.invalidateQueries({ queryKey: ['maintenance'] })
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'health'] })
    }
  })

  if (stateQuery.isPending) return <StateLoading variant="cards" count={2} />
  if (state === null) return <Banner tone="danger">{t('common.errorTitle')}</Banner>

  const draft: MaintenanceState = {
    ...state,
    ...(editing
      ? { on: true, mode, title: title.trim().length > 0 ? title.trim() : null, note: note.trim().length > 0 ? note.trim() : null, startsAt, endsAt }
      : {})
  }

  return (
    <div className="space-y-4">
      <Section title={t('admin.maintenanceTitle')} hint={t('admin.maintenanceHint')} aside={<StatusChip state={state} />}>
        <div className="space-y-2 text-[12px] text-mute">
          <p>{t('admin.maintenanceBody')}</p>
          {state.on && state.endsInMs !== null ? (
            <p className="text-warn">{t('maintenance.endsIn', { time: formatRemaining(state.endsInMs, language === 'en' ? 'en' : 'tr') })}</p>
          ) : null}
          {state.scheduled && state.startsInMs !== null ? (
            <p>{t('maintenance.startsIn', { time: formatRemaining(state.startsInMs, language === 'en' ? 'en' : 'tr') })}</p>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={editing || !state.on ? 'primary' : 'subtle'}
            onClick={() => {
              if (!editing) {
                setMode(state.mode)
                setTitle(state.title ?? '')
                setNote(state.note ?? '')
                setStartsAt(state.startsAt)
                setEndsAt(state.endsAt)
              }
              setEditing(!editing)
            }}
          >
            {t(editing ? 'admin.maintCancel' : 'admin.maintEdit')}
          </Button>
          {state.on ? (
            <Button size="sm" variant="danger" busy={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>
              <Power size={12} />
              {t('admin.maintStop')}
            </Button>
          ) : null}
        </div>

        {save.isError ? (
          <p className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">
            {save.error instanceof Error ? save.error.message : String(save.error)}
          </p>
        ) : null}
      </Section>

      {editing ? (
        <Section title={t('admin.maintPlanTitle')} hint={t('admin.maintPlanHint')}>
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="hud-label block">{t('admin.maintMode')}</span>
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'read_only', label: t('maintenance.modeReadOnly') },
                  { value: 'locked', label: t('maintenance.modeLocked') }
                ]}
              />
            </label>

            <label className="block space-y-1.5">
              <span className="hud-label block">{t('admin.maintTitleLabel')}</span>
              <input
                className={cn(INPUT_CLASS, 'w-full')}
                value={title}
                maxLength={80}
                placeholder={t('admin.maintTitlePlaceholder')}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <label className="block space-y-1.5">
              <span className="hud-label block">{t('admin.maintNoteLabel')}</span>
              <textarea
                className={cn(INPUT_CLASS, 'min-h-20 w-full resize-y')}
                value={note}
                maxLength={400}
                placeholder={t('admin.maintNotePlaceholder')}
                onChange={(event) => setNote(event.target.value)}
              />
              <span className="block text-right text-[10px] text-mute/70">{`${String(note.length)}/400`}</span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="hud-label block">{t('admin.maintStarts')}</span>
                <input
                  type="datetime-local"
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={toLocalInput(startsAt)}
                  onChange={(event) => setStartsAt(fromLocalInput(event.target.value))}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="hud-label block">{t('admin.maintEnds')}</span>
                <input
                  type="datetime-local"
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={toLocalInput(endsAt)}
                  onChange={(event) => setEndsAt(fromLocalInput(event.target.value))}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="hud-label">{t('admin.maintQuick')}</span>
              {MAINTENANCE_QUICK_HOURS.map((hours) => (
                <Button
                  key={hours}
                  size="sm"
                  variant="ghost"
                  onClick={() => setEndsAt(new Date(Date.now() + hours * 3_600_000).toISOString())}
                >
                  {hours < 1 ? `${String(Math.round(hours * 60))}dk` : `${String(hours)}s`}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setEndsAt(null)}>
                {t('admin.maintNoEnd')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setStartsAt(null)}>
                {t('admin.maintStartNow')}
              </Button>
            </div>

            {!window.valid ? <Banner tone="danger">{t('admin.maintWindowInvalid')}</Banner> : null}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                busy={save.isPending && save.variables === true}
                disabled={!window.valid}
                onClick={() => save.mutate(true)}
              >
                {t('admin.maintSave')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t('admin.maintCancel')}
              </Button>
            </div>
          </div>
        </Section>
      ) : null}

      <Section title={t('admin.maintPreview')} hint={t('admin.maintPreviewHint')}>
        <div className={cn('overflow-hidden rounded-xl border border-line/60 bg-base/40', !draft.on && 'opacity-60')}>
          {draft.on ? (
            <MaintenanceBanner state={draft} />
          ) : (
            <p className="px-4 py-3 text-[11px] text-mute">{t('admin.maintPreviewIdle')}</p>
          )}
        </div>
      </Section>

      <Section title={t('admin.maintFrozen')} hint={t('admin.maintFrozenHint')}>
        <div className="flex flex-wrap gap-1.5">
          {FROZEN_TABLES.map((table) => (
            <Chip key={table} tone={state.on ? 'warn' : 'neutral'}>
              {table}
            </Chip>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-mute">{t('admin.maintFrozenNote')}</p>
      </Section>
    </div>
  )
}
