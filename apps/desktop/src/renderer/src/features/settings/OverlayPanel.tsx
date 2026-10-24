import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { DEFAULT_OVERLAY_GEOMETRY, IPC_CHANNELS, displayInfoSchema, type OverlayGeometry } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { call } from '../../lib/ipc'
import { Badge, Banner, Button, Card, Field, INPUT_CLASS, Row } from '../../components/ui'

const ANCHORS = [
  { value: 'top-left', labelKey: 'settings.overlay.anchor.top-left' },
  { value: 'top-center', labelKey: 'settings.overlay.anchor.top-center' },
  { value: 'top-right', labelKey: 'settings.overlay.anchor.top-right' },
  { value: 'bottom-left', labelKey: 'settings.overlay.anchor.bottom-left' },
  { value: 'bottom-center', labelKey: 'settings.overlay.anchor.bottom-center' },
  { value: 'bottom-right', labelKey: 'settings.overlay.anchor.bottom-right' }
] as const satisfies { value: OverlayGeometry['anchor']; labelKey: MessageKey }[]

const NUMBER_LIMITS = {
  width: { min: 160, max: 1400 },
  height: { min: 80, max: 900 },
  marginX: { min: 0, max: 240 },
  marginY: { min: 0, max: 240 }
} as const

type NumberField = keyof typeof NUMBER_LIMITS

function seed(geometry: OverlayGeometry): Record<NumberField, string> {
  return {
    width: String(geometry.width),
    height: String(geometry.height),
    marginX: String(geometry.marginX),
    marginY: String(geometry.marginY)
  }
}

export function OverlayPanel({
  geometry,
  onSaved
}: {
  geometry: OverlayGeometry | undefined
  onSaved: (next: OverlayGeometry) => void
}): ReactNode {
  const t = useT()
  const [numbers, setNumbers] = useState<Record<NumberField, string> | null>(geometry ? seed(geometry) : null)

  const numberSignature = geometry ? `${String(geometry.width)}|${String(geometry.height)}|${String(geometry.marginX)}|${String(geometry.marginY)}` : ''

  // Re-seed only when the committed numbers change, so an unrelated opacity slider push cannot wipe in-progress typing.
  useEffect(() => {
    if (geometry) setNumbers(seed(geometry))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numberSignature])

  const push = useMutation({
    mutationFn: async (patch: Partial<OverlayGeometry>) => call<OverlayGeometry>(IPC_CHANNELS.overlaySetGeometry, patch),
    onSuccess: onSaved
  })

  const displays = useQuery({
    queryKey: ['displays'],
    queryFn: async () => displayInfoSchema.array().parse(await call<unknown>(IPC_CHANNELS.displayList)),
    staleTime: 30_000,
    retry: 1
  })

  if (!geometry || !numbers) {
    return (
      <Card title={t('settings.overlay')}>
        <p className="text-sm text-mute">{t('common.loading')}</p>
      </Card>
    )
  }

  const commitNumber = (field: NumberField): void => {
    const raw = numbers[field]
    const limits = NUMBER_LIMITS[field]
    const parsed = Number.parseInt(raw, 10)
    if (Number.isNaN(parsed)) {
      setNumbers({ ...numbers, [field]: String(geometry[field]) })
      return
    }
    const bounded = Math.min(limits.max, Math.max(limits.min, parsed))
    setNumbers({ ...numbers, [field]: String(bounded) })
    if (bounded !== geometry[field]) push.mutate({ [field]: bounded })
  }

  return (
    <Card title={t('settings.overlay')} hint={t('settings.overlay.hint')}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('settings.overlay.anchor')}>
            <select
              className={INPUT_CLASS}
              value={geometry.anchor}
              onChange={(event) => push.mutate({ anchor: event.target.value as OverlayGeometry['anchor'] })}
            >
              {ANCHORS.map((anchor) => (
                <option key={anchor.value} value={anchor.value}>
                  {t(anchor.labelKey)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('settings.overlay.monitor')} hint={t('settings.overlay.monitorHint')}>
            <select
              className={INPUT_CLASS}
              value={geometry.displayId === undefined ? 'auto' : String(geometry.displayId)}
              onChange={(event) => {
                if (event.target.value !== 'auto') {
                  push.mutate({ displayId: Number(event.target.value) })
                  return
                }
                // An explicit primary id survives the no-defaults patch schema; undefined would be
                // stripped and leave the previous monitor selected.
                const primary = displays.data?.find((display) => display.primary)
                if (primary) push.mutate({ displayId: primary.id })
              }}
            >
              <option value="auto">{t('settings.overlay.monitorAuto')}</option>
              {(displays.data ?? []).map((display) => (
                <option key={display.id} value={display.id}>
                  {`${display.label} · ${String(display.width)}×${String(display.height)}${display.primary ? ' ★' : ''}`}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(NUMBER_LIMITS) as NumberField[]).map((field) => (
            <Field key={field} label={t(LABEL_KEYS[field])}>
              <input
                className={INPUT_CLASS}
                inputMode="numeric"
                value={numbers[field]}
                onChange={(event) => setNumbers({ ...numbers, [field]: event.target.value.replace(/[^0-9]/g, '') })}
                onBlur={() => commitNumber(field)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitNumber(field)
                }}
              />
            </Field>
          ))}
        </div>

        <Field label={`${t('settings.overlay.opacity')} · ${Math.round(geometry.opacity * 100)}%`}>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.02}
            className="w-full accent-[var(--color-brand)]"
            value={geometry.opacity}
            onChange={(event) => push.mutate({ opacity: Number.parseFloat(event.target.value) })}
          />
        </Field>

        <Field label={`${t('settings.overlay.zoom')} · ${geometry.zoomFactor.toFixed(2)}`}>
          <input
            type="range"
            min={0.6}
            max={2}
            step={0.05}
            className="w-full accent-[var(--color-brand)]"
            value={geometry.zoomFactor}
            onChange={(event) => push.mutate({ zoomFactor: Number.parseFloat(event.target.value) })}
          />
        </Field>

        <Row>
          <Badge tone="neutral">{`x ${String(geometry.width)} · y ${String(geometry.height)}`}</Badge>
          <Button busy={push.isPending} onClick={() => void call(IPC_CHANNELS.overlayShow).catch(() => undefined)}>
            {t('common.show')}
          </Button>
          <Button onClick={() => void call(IPC_CHANNELS.overlayHide).catch(() => undefined)}>{t('common.hide')}</Button>
          <Button
            variant="subtle"
            busy={push.isPending}
            onClick={() =>
              push.mutate({
                anchor: DEFAULT_OVERLAY_GEOMETRY.anchor,
                width: DEFAULT_OVERLAY_GEOMETRY.width,
                height: DEFAULT_OVERLAY_GEOMETRY.height,
                marginX: DEFAULT_OVERLAY_GEOMETRY.marginX,
                marginY: DEFAULT_OVERLAY_GEOMETRY.marginY,
                zoomFactor: DEFAULT_OVERLAY_GEOMETRY.zoomFactor,
                opacity: DEFAULT_OVERLAY_GEOMETRY.opacity,
                fontScale: DEFAULT_OVERLAY_GEOMETRY.fontScale,
                upcomingCount: DEFAULT_OVERLAY_GEOMETRY.upcomingCount
              })
            }
          >
            <RotateCcw size={13} />
            {t('settings.overlay.reset')}
          </Button>
        </Row>

        {displays.isError ? (
          <p className="text-[10px] text-mute">{t('settings.overlay.monitorError')}</p>
        ) : null}

        {push.error ? <Banner tone="danger" title={t('common.errorTitle')}>{push.error.message}</Banner> : null}
      </div>
    </Card>
  )
}

const LABEL_KEYS: Record<NumberField, MessageKey> = {
  width: 'settings.overlay.width',
  height: 'settings.overlay.height',
  marginX: 'settings.overlay.marginX',
  marginY: 'settings.overlay.marginY'
}
