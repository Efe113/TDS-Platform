import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Lock, MonitorPlay, Palette, ScanLine, Sparkles, Unlock } from 'lucide-react'
import { OVERLAY_CARD_STYLES, type OverlayCardStyle, type OverlayGeometry } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { supabase } from '../../lib/supabase'
import { fetchWallet } from '../../lib/wallet-api'
import { selectSignedIn, useAuth } from '../../store/auth-store'
import { navigate } from '../../lib/router'
import { Button, Toggle, cn } from '../../components/ui'
import { Chip, Segmented, Section } from '../../components/ui/system'
import { CoinAmount } from '../../components/brand/coin'

/**
 * The overlay editor: free geometry lives in the panel above, this one owns the presentation.
 *
 * Three of the six controls are cosmetics. They are not hidden when unowned - the preview still shows
 * what the card would look like, and the button opens the market. Hiding a paid feature entirely is
 * how a shop ends up with items nobody knows exist.
 */

const ENTITLEMENT_RPCS = { entitlements: 'overlay_entitlements' } as const

const ANCHOR_GRID: Array<{ value: OverlayGeometry['anchor']; col: number; row: number; label: string }> = [
  { value: 'top-left', col: 1, row: 1, label: '↖' },
  { value: 'top-center', col: 2, row: 1, label: '↑' },
  { value: 'top-right', col: 3, row: 1, label: '↗' },
  { value: 'bottom-left', col: 1, row: 2, label: '↙' },
  { value: 'bottom-center', col: 2, row: 2, label: '↓' },
  { value: 'bottom-right', col: 3, row: 2, label: '↘' }
]

function PreviewCard({ geometry, themeName }: { geometry: OverlayGeometry; themeName: string | null }): ReactNode {
  const t = useT()
  const anchor = geometry.anchor
  const styleClass =
    geometry.cardStyle === 'glow'
      ? 'border-brand/70 shadow-[0_0_28px_-6px] shadow-brand/70'
      : geometry.cardStyle === 'scan'
        ? 'border-brand/40'
        : 'border-brand/30'

  return (
    <div
      className="relative h-40 overflow-hidden rounded-lg border border-line bg-base/70"
      style={{
        backgroundImage:
          'linear-gradient(to right, color-mix(in oklab, var(--color-line) 60%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--color-line) 60%, transparent) 1px, transparent 1px)',
        backgroundSize: '20px 20px'
      }}
    >
      <span className="absolute left-2 top-1.5 hud-label">{t('settings.overlayPreview')}</span>
      <div
        className={cn(
          'absolute w-40 rounded-lg border bg-panel/90 p-2 shadow-xl',
          styleClass,
          anchor.endsWith('left') ? 'left-2' : anchor.endsWith('right') ? 'right-2' : 'left-1/2 -translate-x-1/2',
          anchor.startsWith('bottom') ? 'bottom-2' : 'top-6'
        )}
        style={{ fontSize: `calc(11px * ${String(geometry.fontScale)})` }}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-brand">{t('overlay.step', { current: 19, total: 32 })}</span>
          {geometry.showCounter ? (
            <span className="rounded border border-brand/40 bg-brand/15 px-1 font-mono text-[9px] text-brand">19/32</span>
          ) : null}
        </div>
        <p className="mt-1 truncate font-semibold text-ink">{t('settings.overlayPreviewAction')}</p>
        <p className="truncate text-mute">{geometry.themeBound ? (themeName ?? t('profile.themeDefault')) : t('settings.overlayThemeOff')}</p>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
          <div className="h-full w-3/5 rounded-full bg-brand" />
        </div>
        {geometry.upcomingCount > 0 ? (
          <p className="mt-1 truncate text-[9px] text-mute">{t('settings.overlayPreviewNext', { count: geometry.upcomingCount })}</p>
        ) : null}
        {geometry.cardStyle === 'scan' ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-lg"
            style={{ background: 'repeating-linear-gradient(0deg, color-mix(in oklab, var(--color-brand) 10%, transparent) 0 1px, transparent 1px 3px)' }}
          />
        ) : null}
      </div>
    </div>
  )
}

export function OverlayEditor({
  geometry,
  onSaved,
  themeName
}: {
  geometry: OverlayGeometry
  onSaved: (next: OverlayGeometry) => void
  themeName: string | null
}): ReactNode {
  const t = useT()
  const signedIn = useAuth(selectSignedIn)

  const entitlements = useQuery({
    queryKey: ['overlay', 'entitlements'],
    queryFn: async () => {
      if (!supabase) return []
      const { data, error } = await supabase.rpc(ENTITLEMENT_RPCS.entitlements)
      if (error) throw new Error(error.message)
      return Array.isArray(data) ? (data as string[]) : []
    },
    enabled: signedIn && supabase !== null,
    staleTime: 60_000,
    retry: 1
  })
  const owned = useMemo(() => new Set(entitlements.data ?? []), [entitlements.data])

  const wallet = useQuery({ queryKey: ['wallet'], queryFn: fetchWallet, enabled: signedIn, retry: 1 })
  const priceOf = (ref: string): number | null => {
    const item = (wallet.data?.catalog ?? []).find((entry) => entry.refCode === ref && entry.kind === 'cosmetic')
    return item?.finalPrice ?? item?.price ?? null
  }

  const patch = (next: Partial<OverlayGeometry>): void => onSaved({ ...geometry, ...next })

  const paid = (ref: string, active: boolean, onToggle: (next: boolean) => void, label: string, icon: typeof Lock, hint: string): ReactNode => {
    const isOwned = owned.has(ref)
    const price = priceOf(ref)
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border border-line/70 bg-base/40 px-3 py-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
            {label}
            {isOwned ? <Unlock size={11} className="text-good" /> : <Lock size={11} className="text-warn" />}
          </p>
          <p className="text-[10px] leading-relaxed text-mute">{hint}</p>
        </div>
        {isOwned ? (
          <Toggle checked={active} onChange={onToggle} label={active ? t('admin.enable') : t('admin.disable')} />
        ) : (
          <Button size="sm" variant="primary" onClick={() => navigate('/market')} disabled={price === null}>
            <Lock size={12} />
            {price !== null ? <CoinAmount value={price} size="sm" /> : t('market.comingSoon')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <Section title={t('settings.overlayEditorTitle')} hint={t('settings.overlayEditorHint')}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-3">
          <div>
            <p className="hud-label mb-1.5">{t('settings.overlayAnchor')}</p>
            <div className="inline-grid grid-cols-3 gap-1">
              {ANCHOR_GRID.map((cell) => {
                const active = geometry.anchor === cell.value
                return (
                  <button
                    key={cell.value}
                    type="button"
                    data-press
                    onClick={() => patch({ anchor: cell.value })}
                    className={cn(
                      'no-drag grid size-9 place-items-center rounded-md border text-[13px] transition-colors',
                      active ? 'border-brand bg-brand/15 text-ink' : 'border-line bg-panel-soft text-mute hover:border-brand/50 hover:text-ink'
                    )}
                  >
                    {cell.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="hud-label">{t('settings.overlayFont')}</span>
              <input
                type="range"
                min={0.85}
                max={1.35}
                step={0.05}
                value={geometry.fontScale}
                onChange={(event) => patch({ fontScale: Number(event.target.value) })}
                className="w-full accent-[var(--color-brand)]"
              />
              <span className="hud-num text-[10px] text-mute">{`×${geometry.fontScale.toFixed(2)}`}</span>
            </label>
            <div className="space-y-1">
              <span className="hud-label">{t('settings.overlayUpcoming')}</span>
              <Segmented
                size="sm"
                value={String(geometry.upcomingCount)}
                onChange={(value) => patch({ upcomingCount: Number(value) })}
                options={[
                  { value: '0', label: '0' },
                  { value: '1', label: '1' },
                  { value: '2', label: '2' }
                ]}
              />
              <span className="text-[10px] text-mute">{t('settings.overlayUpcomingHint')}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="hud-label">{t('settings.overlayCardStyle')}</span>
            <div className="flex flex-wrap gap-1.5">
              {OVERLAY_CARD_STYLES.map((style) => {
                const ref = style === 'glow' ? 'overlay_glow' : style === 'scan' ? 'overlay_scan' : null
                const isOwned = ref === null || owned.has(ref)
                const active = geometry.cardStyle === style
                const Icon = style === 'scan' ? ScanLine : style === 'glow' ? Sparkles : MonitorPlay
                return (
                  <button
                    key={style}
                    type="button"
                    data-press
                    disabled={!isOwned}
                    onClick={() => patch({ cardStyle: style as OverlayCardStyle })}
                    className={cn(
                      'no-drag flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors',
                      active ? 'border-brand bg-brand/15 text-ink' : 'border-line bg-base/40 text-mute hover:text-ink',
                      !isOwned && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    <Icon size={12} />
                    {t(`settings.overlayStyle${style.charAt(0).toUpperCase()}${style.slice(1)}` as 'settings.overlayStyleClassic')}
                    {!isOwned ? <Lock size={10} className="text-warn" /> : null}
                    {!isOwned && priceOf(ref) !== null ? <span className="hud-num text-[10px] text-warn">{priceOf(ref)}</span> : null}
                  </button>
                )
              })}
            </div>
            <p className="text-[10px] text-mute">{t('settings.overlayStyleHint')}</p>
          </div>

          <div className="space-y-1.5">
            {paid(
              'overlay_counter',
              geometry.showCounter,
              (next) => patch({ showCounter: next }),
              t('settings.overlayCounter'),
              Sparkles,
              t('settings.overlayCounterHint')
            )}
            {paid(
              'overlay_theme_bind',
              geometry.themeBound,
              (next) => patch({ themeBound: next }),
              t('settings.overlayThemeBind'),
              Palette,
              t('settings.overlayThemeBindHint')
            )}
          </div>

          {!signedIn ? <p className="text-[10px] text-mute">{t('settings.overlaySignedOut')}</p> : null}
        </div>

        <div className="space-y-2">
          <PreviewCard geometry={geometry} themeName={themeName} />
          <div className="flex flex-wrap gap-1.5">
            <Chip tone="brand">{geometry.anchor}</Chip>
            <Chip tone="neutral">{`${String(geometry.width)}px`}</Chip>
            <Chip tone="neutral">{`op ${geometry.opacity.toFixed(2)}`}</Chip>
            <Chip tone={geometry.themeBound ? 'good' : 'neutral'}>{geometry.themeBound ? t('settings.overlayThemeOn') : t('settings.overlayThemeOff')}</Chip>
          </div>
        </div>
      </div>
    </Section>
  )
}
