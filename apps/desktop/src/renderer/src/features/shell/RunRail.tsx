import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Compass, Eye, EyeOff, RadioTower, RotateCcw } from 'lucide-react'
import { motion } from 'framer-motion'
import { formatDuration, storageUrl } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { navigate } from '../../lib/router'
import { SUPABASE_BASE_URL } from '../../lib/storage-base'
import { useTick } from '../../lib/use-tick'
import { useAppStore } from '../../store/app-store'
import { useOverlayControls } from './use-overlay'
import { CachedBadge } from './OfflineShelf'
import { Button, cn } from '../../components/ui'
import { Chip } from '../../components/ui/system'

/**
 * The run rail is the app's signature: the active run lives at the right edge as a timeline, not as a
 * card buried in navigation. It is deliberately always in the same place, because the whole point of a
 * companion is that you can glance at it between waves.
 */
export function RunRail(): ReactNode {
  const t = useT()
  const overlay = useOverlayControls()
  const run = useAppStore((state) => state.overlayState)
  const active = useAppStore((state) => state.activeStrategy)
  const recentKeys = useAppStore((state) => state.recentKeys)

  const total = active?.totalSteps ?? 0
  const percent = active && total > 0 ? Math.round(((active.stepIndex + 1) / total) * 100) : 0
  // The session clock is coarse on purpose: a minute-scale number does not need a second-scale render.
  const now = useTick(30_000)

  return (
    <aside className="hud-rail relative hidden w-[268px] shrink-0 flex-col lg:flex">
      <div className="relative flex items-center justify-between gap-2 px-4 pb-2 pt-4">
        <span className="hud-label flex items-center gap-1.5">
          <RadioTower size={12} className={run ? 'text-brand' : 'text-mute'} />
          {t('nav.runTitle')}
        </span>
        <div className="flex items-center gap-1">
          <span className={cn('size-1.5 rounded-full', overlay.visible ? 'bg-good shadow-[0_0_8px_1px] shadow-good/50' : 'bg-mute/40')} />
          <span className="hud-label">{overlay.visible ? t('home.overlayVisible') : t('home.overlayHidden')}</span>
        </div>
      </div>

      <div className="hud-divider mx-4" />

      {run && active ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          <div>
            <button
              type="button"
              onClick={() => navigate(`/strategy/${active.strategyId}`)}
              className="no-drag block w-full truncate text-left text-[13px] font-semibold text-ink hover:text-brand"
            >
              {active.name}
            </button>
            {run.source === 'cache' && run.savedAt !== null ? (
              <p className="mt-1">
                <CachedBadge savedAt={run.savedAt} />
              </p>
            ) : null}
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="hud-num text-[11px] text-mute">{`${String(active.stepIndex + 1)} / ${String(total)}`}</span>
              <span className="hud-num text-[11px] text-brand">{`${String(percent)}%`}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel-soft">
              <motion.div
                data-skin-part="progress"
                animate={{ width: `${percent}%` }}
                transition={{ type: 'spring', stiffness: 220, damping: 28 }}
                className="h-full rounded-full bg-gradient-to-r from-brand to-brand/50"
              />
            </div>
          </div>

          {run.current ? (
            <div className="hud-panel p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="hud-label">{t('run.currentStep')}</span>
                {run.current.waveFrom !== undefined ? (
                  <Chip tone="brand" className="hud-num">{`W${String(run.current.waveFrom)}`}</Chip>
                ) : null}
              </div>
              <p className="mt-1.5 text-[13px] font-semibold leading-snug text-ink">{run.current.action}</p>
              {/* The catalogue's own Turkish name when the tracker had one; the prettified key otherwise. */}
              {run.current.towerLabelTr ?? run.current.towerLabel ? (
                <p className="mt-0.5 text-[11px] text-brand">{run.current.towerLabelTr ?? run.current.towerLabel}</p>
              ) : null}
              {run.current.spec ? <p className="mt-0.5 text-[11px] text-mute">{run.current.spec}</p> : null}
              <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-mute/80">{run.current.raw}</p>
            </div>
          ) : null}

          {/*
            The session, on the rail rather than buried in the publish screen. These are the same
            numbers the ledger is written from, and until now the person generating them could not see
            them: `sessionSummary()` had no caller at all.
          */}
          {run.sessionId !== null && run.sessionId !== undefined ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line/70 bg-panel/50 px-2.5 py-1.5 text-[10px] text-mute">
              <span className="hud-label">{t('run.sessionTitle')}</span>
              <span className="hud-num">{formatDuration(Math.max(0, Math.round((now - (run.sessionStartedAt ?? now)) / 1000)))}</span>
              <span className="opacity-50">·</span>
              <span className="hud-num">{t('run.sessionSteps', { count: run.stepsAdvanced })}</span>
              <span className="opacity-50">·</span>
              <span className="hud-num">{t('run.sessionMaxStep', { step: run.maxStep })}</span>
            </div>
          ) : null}

          {/* The placement image was carried through the whole IPC chain and drawn by nobody. The rail
              is where a map belongs: bigger than the overlay card, and out of the fight. */}
          {run.placementImageRef ? (
            <button
              type="button"
              onClick={() => navigate(`/strategy/${active?.strategyId}`)}
              className="group overflow-hidden rounded-lg border border-line/70 bg-base/40"
            >
              <img
                src={storageUrl(SUPABASE_BASE_URL, run.placementImageRef) ?? run.placementImageRef}
                alt={t('run.placement')}
                loading="lazy"
                className="max-h-40 w-full object-cover transition-transform group-hover:scale-[1.02]"
              />
              <span className="hud-label block border-t border-line/60 px-2 py-1 text-left text-mute group-hover:text-ink">
                {t('run.placement')}
              </span>
            </button>
          ) : null}

          {run.upcoming.length > 0 ? (
            <div className="space-y-1.5">
              <span className="hud-label">{t('run.upcoming')}</span>
              {run.upcoming.map((step) => (
                <div key={`${String(step.stepNo)}-${step.raw}`} className="flex items-start gap-2 rounded-lg border border-line/70 bg-panel/50 px-2.5 py-1.5">
                  <span className="hud-num mt-0.5 text-[10px] text-mute">{String(step.stepNo).padStart(2, '0')}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] text-ink">{step.action}</span>
                    {step.towerLabel ? <span className="block truncate text-[10px] text-mute">{step.towerLabel}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-auto space-y-2">
            <div className="grid grid-cols-4 gap-1.5">
              <Button variant="ghost" className="px-0" title={t('common.prev')} disabled={overlay.step.isPending} onClick={() => overlay.step.mutate('prev')}>
                <ChevronLeft size={15} />
              </Button>
              <Button variant="primary" className="px-0" title={t('common.next')} disabled={overlay.step.isPending} onClick={() => overlay.step.mutate('next')}>
                <ChevronRight size={15} />
              </Button>
              <Button variant="ghost" className="px-0" title={t('common.reset')} disabled={overlay.step.isPending} onClick={() => overlay.step.mutate('reset')}>
                <RotateCcw size={14} />
              </Button>
              <Button
                variant="ghost"
                className="px-0"
                title={overlay.visible ? t('common.hide') : t('common.show')}
                disabled={overlay.show.isPending || overlay.hide.isPending}
                onClick={() => void (overlay.visible ? overlay.hide.mutate() : overlay.show.mutate())}
              >
                {overlay.visible ? <EyeOff size={14} /> : <Eye size={14} />}
              </Button>
            </div>
            {recentKeys.length > 0 ? (
              <div className="space-y-1 border-t border-line/60 pt-2">
                <span className="hud-label">{t('home.feedTitle')}</span>
                <ul className="space-y-0.5">
                  {recentKeys.slice(0, 3).map((event) => (
                    <li key={`${String(event.at)}-${event.action}`} className="flex items-center justify-between gap-2 text-[10px] text-mute">
                      <span className="truncate">{event.code}</span>
                      <span className="hud-num shrink-0">{new Date(event.at).toLocaleTimeString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="grid size-10 place-items-center rounded-xl border border-line bg-panel-soft/60 text-mute">
            <RadioTower size={16} />
          </span>
          <p className="text-[11px] leading-relaxed text-mute">{t('nav.runEmpty')}</p>
          <Button size="sm" variant="ghost" onClick={() => navigate('/discover')}>
            <Compass size={13} />
            {t('nav.discover')}
          </Button>
        </div>
      )}
    </aside>
  )
}
