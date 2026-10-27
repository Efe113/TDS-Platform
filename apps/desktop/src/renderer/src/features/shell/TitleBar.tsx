import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Coins,
  Eye,
  EyeOff,
  FolderOpen,
  Info,
  Maximize2,
  Minimize,
  Minimize2,
  Monitor,
  PanelsTopLeft,
  Power,
  RefreshCw,
  RotateCw,
  Scale,
  Settings,
  Sparkles,
  X
} from 'lucide-react'
import {
  IPC_CHANNELS,
  formatCoin,
  windowMaximizedSchema,
  type AppMeta,
  type HotkeyStatus,
  type ThemeSkin
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { navigate, routeSegments, useRoutePath } from '../../lib/router'
import { useIpcEvent } from '../../lib/events'
import { call } from '../../lib/ipc'
import { useIdentity } from '../../lib/identity'
import { useUsageStatus } from '../../lib/usage'
import { fetchWallet } from '../../lib/wallet-api'
import { supabase } from '../../lib/supabase'
import { selectSignedIn, useAuth } from '../../store/auth-store'
import { STATUS_KEY } from '../settings/use-settings'
import { useMotion } from '../../motion/context'
import { CountUp } from '../../motion/primitives/CountUp'
import { Logo } from '../../components/brand/logo'
import { CoinAmount, CoinIcon } from '../../components/brand/coin'
import { Badge } from '../../components/ui/badge'
import { cn } from '../../components/ui'
import {
  Menu,
  MenuContent,
  MenuDivider,
  MenuFooter,
  MenuHeader,
  MenuItem,
  MenuSection,
  MenuStat,
  MenuTrigger
} from '../../components/ui/menu'
import { useOverlayControls } from './use-overlay'
import { WatchBell } from './WatchBell'

const CRUMB_KEYS: Record<string, MessageKey> = {
  home: 'nav.home',
  discover: 'nav.discover',
  import: 'nav.import',
  leaderboard: 'nav.leaderboard',
  wallet: 'nav.wallet',
  profile: 'nav.profile',
  account: 'nav.groupAccount',
  strategy: 'title.strategy',
  badges: 'nav.badges',
  settings: 'nav.settings',
  about: 'nav.about',
  legal: 'nav.legal',
  admin: 'nav.admin'
}

type Tone = 'good' | 'warn' | 'danger' | 'idle'

const DOT_CLASS: Record<Tone, string> = {
  good: 'bg-good',
  warn: 'bg-warn',
  danger: 'bg-danger',
  idle: 'bg-mute/45'
}

function Dot({ tone, breathe }: { tone: Tone; breathe: boolean }): ReactNode {
  const dot = <span className={cn('size-1.5 rounded-full', DOT_CLASS[tone])} />
  if (!breathe) return dot
  return (
    <motion.span
      className="flex"
      initial={false}
      animate={{ opacity: [1, 0.35, 1] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
    >
      {dot}
    </motion.span>
  )
}

function CaptionButton({
  label,
  hint,
  danger,
  onClick,
  children
}: {
  label: string
  hint?: string
  danger?: boolean
  onClick: () => void
  children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={hint ?? label}
      onClick={onClick}
      className={cn(
        'no-drag group/caption relative flex w-11 shrink-0 items-center justify-center text-mute transition-colors',
        'hover:bg-panel-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50',
        danger && 'hover:bg-danger/15 hover:text-danger'
      )}
    >
      {children}
      <span
        className={cn(
          'pointer-events-none absolute inset-x-1.5 bottom-1 h-px origin-center scale-x-0 bg-brand/70 transition-transform duration-200',
          'group-hover/caption:scale-x-100',
          danger && 'group-hover/caption:bg-danger'
        )}
      />
    </button>
  )
}

function hookState(status: HotkeyStatus | undefined): { tone: Tone; labelKey: MessageKey } {
  if (!status) return { tone: 'idle', labelKey: 'common.loading' }
  if (status.disabledByRemoteFlag) return { tone: 'danger', labelKey: 'title.hookRemoteOff' }
  if (status.degraded) return { tone: 'danger', labelKey: 'settings.degraded.title' }
  if (status.paused) return { tone: 'warn', labelKey: 'settings.paused' }
  if (status.running) return { tone: 'good', labelKey: 'settings.running' }
  return { tone: 'idle', labelKey: 'settings.stopped' }
}

export function TitleBar({ skin }: { skin: ThemeSkin }): ReactNode {
  const t = useT()
  const path = useRoutePath()
  const identity = useIdentity()
  const signedIn = useAuth(selectSignedIn)
  const overlay = useOverlayControls()
  const { tier, budget, reduced, averageFps } = useMotion()
  const [maximized, setMaximized] = useState(false)

  const metaQuery = useQuery({
    queryKey: ['app', 'meta'],
    queryFn: () => call<AppMeta>(IPC_CHANNELS.appGetMeta),
    retry: false
  })

  const hookQuery = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => call<HotkeyStatus>(IPC_CHANNELS.hotkeysGetStatus),
    retry: false
  })

  const walletQuery = useQuery({
    queryKey: ['wallet'],
    queryFn: fetchWallet,
    enabled: signedIn && supabase !== null,
    retry: 1
  })

  const usage = useUsageStatus()

  // Main owns the window state, and snapping or Win+Up changes it without us, so the button mirrors
  // the event instead of guessing from its own clicks.
  useIpcEvent(IPC_CHANNELS.windowMaximizedChanged, windowMaximizedSchema, (payload) => setMaximized(payload.maximized))

  useEffect(() => {
    void call<{ maximized: boolean }>(IPC_CHANNELS.windowGetMaximized)
      .then((state) => setMaximized(state.maximized))
      .catch(() => undefined)
  }, [])

  const run = useCallback((channel: string): void => {
    void call(channel).catch(() => undefined)
  }, [])

  const segments = routeSegments(path)
  const head = segments[0] ?? 'home'
  // A detail route carries an id, and an id in the breadcrumb is noise. `/legal/terms` is the one
  // second segment that means something to the user.
  const crumbs = segments[1] && head === 'legal' ? [t(CRUMB_KEYS[head] ?? 'nav.home'), segments[1]] : [t(CRUMB_KEYS[head] ?? 'nav.home')]

  const hook = hookState(hookQuery.data)
  const pending = usage.data?.pending ?? 0
  const syncTone: Tone = usage.data?.lastError ? 'danger' : pending > 0 ? 'warn' : 'good'
  const canBreathe = !reduced && budget.enterMs > 150

  return (
    <header
      data-skin-part="header"
      className="drag-region relative z-30 flex h-11 shrink-0 items-stretch gap-1 border-b border-line/70 bg-panel/94 pl-1.5"
    >
      <span aria-hidden className="hud-scan" />
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={t('title.appMenuLabel')}
            className="no-drag flex items-center gap-2 rounded-lg px-1.5 text-left transition-colors hover:bg-panel-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <Logo size={20} className="text-ink" />
            <span className="hidden text-[13px] font-semibold tracking-tight text-ink sm:block">{t('app.name')}</span>
            <Badge variant="outline" className="shrink-0 border-brand/50 px-1 py-0 text-[9px] font-bold leading-none tracking-widest text-brand">
              {t('app.alpha')}
            </Badge>
          </button>
        </MenuTrigger>

        <MenuContent align="start" side="bottom" className="w-72">
          <MenuHeader>
            <span className="block text-sm font-semibold text-ink">{t('app.name')}</span>
            <span className="block text-[11px] text-mute">{t('nav.tagline')}</span>
          </MenuHeader>

          <MenuDivider />
          <MenuSection label={t('title.sectionInfo')} />
          <MenuStat index={0} label={t('legal.versionShort')} value={metaQuery.data?.version ?? '—'} />
          <MenuStat index={1} icon={Monitor} label={t('title.platform')} value={metaQuery.data?.platform ?? '—'} />
          <MenuStat index={2} icon={PanelsTopLeft} label="Electron" value={metaQuery.data?.electron ?? '—'} />
          <MenuStat index={3} icon={Scale} label={t('title.policy')} value={metaQuery.data?.policyVersion ?? '—'} />

          <MenuDivider />
          <MenuItem icon={Sparkles} index={0} aside={t(skin.moodKey)} onSelect={() => navigate('/wallet')}>
            {t('nav.themeSub')}
          </MenuItem>
          <MenuItem icon={Settings} index={1} onSelect={() => navigate('/settings')}>
            {t('nav.settings')}
          </MenuItem>
          <MenuItem icon={Info} index={2} onSelect={() => navigate('/about')}>
            {t('nav.about')}
          </MenuItem>
          <MenuItem icon={Scale} index={3} onSelect={() => navigate('/legal')}>
            {t('nav.legal')}
          </MenuItem>
          <MenuItem icon={FolderOpen} index={4} onSelect={() => run(IPC_CHANNELS.logOpenFolder)}>
            {t('title.openLogs')}
          </MenuItem>
          <MenuItem icon={RotateCw} index={5} onSelect={() => window.location.reload()}>
            {t('title.reload')}
          </MenuItem>

          <MenuDivider />
          <MenuItem icon={Power} index={6} tone="destructive" onSelect={() => run(IPC_CHANNELS.appQuit)}>
            {t('title.quit')}
          </MenuItem>

          <MenuFooter className="truncate">{metaQuery.data?.userDataPath ?? t('common.loading')}</MenuFooter>
        </MenuContent>
      </Menu>

      <nav aria-label={t('title.sectionGo')} className="hud-label flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden px-2">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <span key={`${crumb}-${String(index)}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <span className="shrink-0 text-mute/50">/</span> : null}
              {last ? (
                <motion.span
                  layoutId="titlebar-crumb"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  className="hud-label relative min-w-0 truncate border-b border-brand/70 px-1 pb-0.5 text-ink"
                >
                  {crumb}
                </motion.span>
              ) : (
                <span className="min-w-0 truncate px-1.5 py-0.5 text-mute">{crumb}</span>
              )}
            </span>
          )
        })}
      </nav>

      <WatchBell />

      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            title={t('title.status')}
            className="no-drag hud-label flex items-center gap-3 rounded-none px-2.5 text-mute transition-colors hover:bg-panel-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <span className="flex items-center gap-1.5">
              <Dot tone={overlay.visible ? 'good' : 'idle'} breathe={canBreathe && overlay.visible} />
              {overlay.visible ? <Eye size={13} /> : <EyeOff size={13} className="opacity-60" />}
            </span>
            <span className="flex items-center gap-1.5">
              <Dot tone={hook.tone} breathe={canBreathe && hook.tone === 'good'} />
              <Activity size={13} />
            </span>
            <span className="flex items-center gap-1.5">
              <Dot tone={syncTone} breathe={false} />
              <RefreshCw size={13} className={usage.isFetching ? 'animate-spin' : undefined} />
              {pending > 0 ? <span className="tabular-nums text-warn">{pending}</span> : null}
            </span>
            {identity.signedIn ? (
              <span className="flex items-center gap-1 text-ink">
                <CoinIcon size={13} className="text-brand" />
                <span className="hud-num">
                  <CountUp value={walletQuery.data?.balance ?? 0} format={formatCoin} />
                </span>
              </span>
            ) : null}
            <span className="hidden max-w-28 items-center gap-1 text-ink xl:flex">
              <Sparkles size={13} className="text-brand" />
              <span className="truncate">{t(skin.moodKey)}</span>
            </span>
          </button>
        </MenuTrigger>

        <MenuContent align="end" side="bottom" className="w-80">
          <MenuHeader>
            <span className="block text-sm font-semibold text-ink">{t('title.status')}</span>
            <span className="block text-[11px] text-mute">{t('title.statusHint')}</span>
          </MenuHeader>

          <MenuDivider />
          <MenuStat
            index={0}
            icon={overlay.visible ? Eye : EyeOff}
            label={t('title.overlay')}
            value={overlay.visible ? t('title.overlayVisible') : t('title.overlayHidden')}
            tone={overlay.visible ? 'good' : 'idle'}
          />
          <MenuStat index={1} icon={Activity} label={t('title.hook')} value={t(hook.labelKey)} tone={hook.tone} />
          <MenuStat
            index={2}
            icon={RefreshCw}
            label={t('title.sync')}
            value={pending > 0 ? t('title.syncPending', { count: pending }) : t('title.syncClean')}
            tone={syncTone}
          />
          <MenuStat index={3} icon={Sparkles} label={t('title.skin')} value={t(skin.moodKey)} />
          <MenuStat
            index={4}
            icon={Monitor}
            label={t('title.motion')}
            value={averageFps === null ? tier : `${tier} · ${t('title.fps', { fps: Math.round(averageFps) })}`}
          />

          <MenuDivider />
          <MenuItem
            icon={overlay.visible ? EyeOff : Eye}
            index={0}
            disabled={overlay.show.isPending || overlay.hide.isPending}
            onSelect={() => void (overlay.visible ? overlay.hide.mutate() : overlay.show.mutate())}
          >
            {t('title.toggleOverlay')}
          </MenuItem>
          <MenuItem
            icon={Coins}
            index={1}
            onSelect={() => navigate('/wallet')}
            aside={walletQuery.data ? <CoinAmount value={walletQuery.data.balance} size="sm" /> : undefined}
          >
            {t('title.wallet')}
          </MenuItem>
          <MenuItem icon={Settings} index={2} onSelect={() => navigate('/settings')}>
            {t('title.motion')}
          </MenuItem>

          <MenuFooter>{identity.signedIn ? identity.display : t('auth.signedOutShort')}</MenuFooter>
        </MenuContent>
      </Menu>

      <div className="flex items-stretch">
        <CaptionButton label={t('title.minimize')} onClick={() => run(IPC_CHANNELS.windowMinimize)}>
          <Minimize size={15} />
        </CaptionButton>
        <CaptionButton label={maximized ? t('title.restore') : t('title.maximize')} onClick={() => run(IPC_CHANNELS.windowToggleMaximize)}>
          {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </CaptionButton>
        <CaptionButton
          label={t('title.closeWindow')}
          hint={`${t('title.closeWindow')}: ${t('title.closeWindowHint')}`}
          danger
          onClick={() => run(IPC_CHANNELS.windowClose)}
        >
          <X size={15} />
        </CaptionButton>
      </div>
    </header>
  )
}
