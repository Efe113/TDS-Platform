import { useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight,
  BadgeCheck,
  Building2,
  Compass,
  Eye,
  EyeOff,
  House,
  Import,
  Info,
  LogOut,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Scale,
  Settings,
  Shield,
  ShieldCheck,
  Trophy,
  Store,
  User,
  UserRound,
  Wallet,
  type LucideIcon
} from 'lucide-react'
import { IPC_CHANNELS, identitySubtitle, isModeratorRole, themeSkin, type AppMeta, type ThemeKey } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { navigate, routeSegments, useRoutePath } from '../../lib/router'
import { SKIN_NAME_KEYS, skinRows } from '../../lib/skins'
import { showcaseQueryKey, useIdentity } from '../../lib/identity'
import { cn } from '../../lib/utils'
import { call } from '../../lib/ipc'
import { selectRole, selectSignedIn, selectUserId, useAuth } from '../../store/auth-store'
import { useAppStore } from '../../store/app-store'
import { fetchWallet, selectTheme } from '../../lib/wallet-api'
import { supabase } from '../../lib/supabase'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { Button } from '../../components/ui/button'
import {
  Menu,
  MenuContent,
  MenuDivider,
  MenuFooter,
  MenuHeader,
  MenuItem,
  MenuRadioList,
  MenuRadioRow,
  MenuSection,
  MenuSubmenu,
  MenuTrigger
} from '../../components/ui/menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip'
import { ThemePreview } from '../../components/brand/theme-preview'
import { Logo } from '../../components/brand/logo'
import { CoinAmount } from '../../components/brand/coin'
import { Chip } from '../../components/ui/system'
import { useOverlayControls } from './use-overlay'

interface NavItem {
  path: string
  labelKey: MessageKey
  icon: LucideIcon
  moderatorOnly?: boolean
}

interface NavGroup {
  titleKey: MessageKey
  items: NavItem[]
}

/**
 * Grouped by what the user is doing. Profile and account are not destinations here - they live in the
 * account menu at the bottom, which is also where the skin is switched.
 */
const GROUPS: NavGroup[] = [
  {
    titleKey: 'nav.groupStrategy',
    items: [
      { path: '/', labelKey: 'nav.home', icon: House },
      { path: '/discover', labelKey: 'nav.discover', icon: Compass },
      { path: '/import', labelKey: 'nav.import', icon: Import }
    ]
  },
  {
    titleKey: 'nav.groupCommunity',
    items: [
      { path: '/leaderboard', labelKey: 'nav.leaderboard', icon: Trophy },
      { path: '/market', labelKey: 'market.title', icon: Store },
      { path: '/verified', labelKey: 'verified.nav', icon: BadgeCheck },
      { path: '/corporate', labelKey: 'corporate.nav', icon: Building2 }
    ]
  },
  {
    titleKey: 'nav.groupSystem',
    items: [
      { path: '/about', labelKey: 'nav.about', icon: Info },
      { path: '/legal', labelKey: 'nav.legal', icon: Scale },
      { path: '/admin', labelKey: 'nav.admin', icon: ShieldCheck, moderatorOnly: true }
    ]
  }
]

const COLLAPSE_KEY = 'tds.si…psed'
const EXPANDED_WIDTH = 264
const RAIL_WIDTH = 76

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

function isActive(itemPath: string, current: string): boolean {
  if (itemPath === '/') return current === '/' || current === '/home'
  return routeSegments(itemPath)[0] === routeSegments(current)[0]
}


export function SideNav(): ReactNode {
  const t = useT()
  const path = useRoutePath()
  const identity = useIdentity()
  const role = useAuth(selectRole)
  const signedIn = useAuth(selectSignedIn)
  const userId = useAuth(selectUserId)
  const signOut = useAuth((state) => state.signOut)
  const authBusy = useAuth((state) => state.busy)
  const activeStrategy = useAppStore((state) => state.activeStrategy)
  const overlay = useOverlayControls()
  const queryClient = useQueryClient()
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const walletQuery = useQuery({
    queryKey: ['wallet'],
    queryFn: fetchWallet,
    enabled: signedIn && supabase !== null,
    retry: 1
  })

  const metaQuery = useQuery({
    queryKey: ['app', 'meta'],
    queryFn: () => call<AppMeta>(IPC_CHANNELS.appGetMeta),
    retry: false
  })

  const themeChoice = useMutation({
    mutationFn: (key: ThemeKey) => selectTheme(key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
      void queryClient.invalidateQueries({ queryKey: showcaseQueryKey(userId) })
    }
  })

  const skin = themeSkin(walletQuery.data?.theme ?? null)
  const themeRows = skinRows(walletQuery.data?.catalog ?? [])

  const toggle = (): void => {
    const next = !collapsed
    setCollapsed(next)
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
    } catch {
      // Storage can be unavailable; the preference then simply does not persist.
    }
  }

  const navItem = (entry: NavItem, active: boolean): ReactNode => {
    const Icon = entry.icon
    const button = (
      <button
        type="button"
        onClick={() => navigate(entry.path)}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? t(entry.labelKey) : undefined}
        className={cn(
          'no-drag group/item relative flex w-full items-center gap-2.5 rounded-xl py-1.5 text-[13px] transition-all duration-200',
          collapsed ? 'justify-center px-0' : 'px-2',
          active ? 'text-ink' : 'text-mute hover:translate-x-0.5 hover:text-ink'
        )}
      >
        {active ? (
          <motion.span
            layoutId="nav-active-pill"
            data-skin-part="active-pill"
            transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            className="absolute inset-0 rounded-xl border border-brand/30 bg-gradient-to-r from-brand/25 via-brand/10 to-transparent"
          />
        ) : null}
        {active ? (
          <motion.span
            layoutId="nav-active-bar"
            transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            className="absolute -left-1 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-brand shadow-[0_0_12px_2px] shadow-brand/50"
          />
        ) : null}

        <span
          className={cn(
            'relative flex size-7 shrink-0 items-center justify-center rounded-lg border transition-colors',
            active
              ? 'border-brand/40 bg-brand/20 text-brand'
              : 'border-transparent bg-panel-soft/70 text-mute group-hover/item:border-line group-hover/item:text-ink'
          )}
        >
          <Icon size={15} strokeWidth={active ? 2.2 : 1.8} />
        </span>
        {!collapsed ? <span className="relative truncate font-medium">{t(entry.labelKey)}</span> : null}
      </button>
    )

    if (!collapsed) return <div key={entry.path}>{button}</div>

    return (
      <Tooltip key={entry.path} delayDuration={150}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">{t(entry.labelKey)}</TooltipContent>
      </Tooltip>
    )
  }

  const total = activeStrategy?.totalSteps ?? 0
  const progress = activeStrategy && total > 0 ? Math.round(((activeStrategy.stepIndex + 1) / total) * 100) : 0

  const runCard = (
    <div className={cn('rounded-2xl border border-line bg-base/55 p-3', collapsed && 'px-1.5')}>
      {collapsed ? (
        <div className="flex flex-col items-center gap-2">
          <span className={cn('size-2 rounded-full', overlay.visible ? 'bg-good shadow-[0_0_10px_2px] shadow-good/40' : 'bg-mute/40')} />
          <span className="text-[10px] font-semibold tabular-nums text-mute">{activeStrategy ? `${String(progress)}%` : '—'}</span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-mute/70">{t('nav.runTitle')}</span>
            <Chip tone={overlay.visible ? 'good' : 'neutral'} className="gap-1.5">
              <span className={cn('size-1.5 rounded-full', overlay.visible ? 'bg-good' : 'bg-mute/60')} />
              {overlay.visible ? t('home.overlayVisible') : t('home.overlayHidden')}
            </Chip>
          </div>

          {activeStrategy ? (
            <>
              <p className="truncate text-[13px] font-semibold text-ink">{activeStrategy.name}</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-panel-soft">
                <motion.div
                  data-skin-part="progress"
                  animate={{ width: `${progress}%` }}
                  transition={{ type: 'spring', stiffness: 220, damping: 28 }}
                  className="h-full rounded-full bg-gradient-to-r from-brand to-brand/60"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] tabular-nums text-mute">{t('overlay.step', { current: activeStrategy.stepIndex + 1, total })}</span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-7 p-0"
                    title={t('common.prev')}
                    disabled={overlay.step.isPending}
                    onClick={() => void overlay.step.mutate('prev')}
                  >
                    <ChevronRight size={13} className="rotate-180" />
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="size-7 p-0"
                    title={t('common.next')}
                    disabled={overlay.step.isPending}
                    onClick={() => void overlay.step.mutate('next')}
                  >
                    <ChevronRight size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn('size-7 p-0', overlay.visible && 'text-ink')}
                    title={overlay.visible ? t('common.hide') : t('common.show')}
                    disabled={overlay.show.isPending || overlay.hide.isPending}
                    onClick={() => void (overlay.visible ? overlay.hide.mutate() : overlay.show.mutate())}
                  >
                    {overlay.visible ? <EyeOff size={13} /> : <Eye size={13} />}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <p className="text-[11px] leading-snug text-mute">{t('nav.runEmpty')}</p>
          )}
        </div>
      )}
    </div>
  )

  const accountMenu = (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          title={identity.signedIn ? identity.display : t('auth.signedOutShort')}
          className={cn(
            'no-drag group/account relative flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left transition-colors hover:bg-panel-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
            collapsed && 'justify-center px-0'
          )}
        >
          <span className="relative shrink-0">
            <Avatar size="sm">
              {identity.avatarUrl ? <AvatarImage src={identity.avatarUrl} alt="" /> : null}
              <AvatarFallback className="bg-brand/15 text-[11px] font-semibold text-brand">{identity.initials}</AvatarFallback>
            </Avatar>
            {identity.signedIn ? (
              <motion.span
                layoutId="account-status"
                className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-panel bg-good shadow-[0_0_8px_1px] shadow-good/50"
              />
            ) : null}
          </span>
          {!collapsed ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-ink">
                {identity.signedIn ? identity.display : t('auth.signedOutShort')}
              </span>
              <span className="block truncate text-[10px] text-mute">
                {identity.signedIn ? identitySubtitle(identity) : t('auth.signInCta')}
              </span>
            </span>
          ) : null}
          {!collapsed ? (
            <ChevronRight size={14} className="shrink-0 text-mute transition-transform duration-200 group-hover/account:translate-x-0.5" />
          ) : null}
        </button>
      </MenuTrigger>

      <MenuContent align="start" side="top">
        <MenuHeader>
          <div className="flex items-center gap-2.5">
            <Avatar size="default">
              {identity.avatarUrl ? <AvatarImage src={identity.avatarUrl} alt="" /> : null}
              <AvatarFallback className="bg-brand/15 text-[11px] font-semibold text-brand">{identity.initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink">
                {identity.signedIn ? identity.display : t('auth.signedOutShort')}
              </span>
              <span className="block truncate text-[10px] text-mute">
                {identity.signedIn ? (identity.email ?? identity.provider ?? 'email') : t('auth.signedOutHint')}
              </span>
            </div>
            {identity.signedIn ? <Chip tone="brand">{identity.provider ?? 'email'}</Chip> : null}
          </div>
        </MenuHeader>

        <MenuDivider />

        {signedIn ? (
          <>
            <MenuItem icon={User} index={0} onSelect={() => navigate('/profile')}>
              {t('nav.profile')}
            </MenuItem>
            <MenuItem
              icon={Wallet}
              index={1}
              onSelect={() => navigate('/wallet')}
              aside={walletQuery.data ? <CoinAmount value={walletQuery.data.balance} size="sm" /> : undefined}
            >
              {t('nav.wallet')}
            </MenuItem>
            {isModeratorRole(role) ? (
              <MenuItem icon={Shield} index={2} onSelect={() => navigate('/admin')}>
                {t('nav.admin')}
              </MenuItem>
            ) : null}

            <MenuSubmenu icon={Palette} index={3} trigger={t('nav.themeSub')}>
              <MenuSection label={t('nav.themeHint')} />
              <MenuRadioList value={skin.key} onValueChange={(value) => themeChoice.mutate(value as ThemeKey)}>
                {themeRows.map((row, index) => (
                  <MenuRadioRow
                    key={row.key}
                    value={row.key}
                    index={index}
                    disabled={!row.owned || themeChoice.isPending}
                    aside={row.owned ? undefined : row.price === null ? t('theme.notForSale') : <CoinAmount value={row.price} size="sm" />}
                    leading={<ThemePreview value={row.key} className="h-7 w-10 shrink-0" detailed={false} />}
                  >
                    {t(SKIN_NAME_KEYS[row.key])}
                  </MenuRadioRow>
                ))}
              </MenuRadioList>
            </MenuSubmenu>

            <MenuItem icon={Settings} index={4} onSelect={() => navigate('/settings')}>
              {t('nav.settings')}
            </MenuItem>

            <MenuDivider />

            <MenuItem icon={LogOut} index={5} tone="destructive" disabled={authBusy} onSelect={() => void signOut()}>
              {t('auth.signOut')}
            </MenuItem>
          </>
        ) : (
          <>
            <MenuItem icon={User} index={0} onSelect={() => navigate('/account')}>
              {t('auth.signIn')}
            </MenuItem>
            <MenuItem icon={UserRound} index={1} onSelect={() => navigate('/account')}>
              {t('auth.signUp')}
            </MenuItem>
            <MenuDivider />
            <MenuItem icon={Compass} index={2} onSelect={() => navigate('/discover')}>
              {t('nav.discover')}
            </MenuItem>
          </>
        )}

        <MenuFooter>{`${t('nav.themeSub')}: ${t(skin.moodKey)}`}</MenuFooter>
      </MenuContent>
    </Menu>
  )


  return (
    <TooltipProvider>
      <motion.nav
        data-skin-part="nav"
        animate={{ width: collapsed ? RAIL_WIDTH : EXPANDED_WIDTH }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        className="relative z-10 flex h-full shrink-0 flex-col overflow-hidden border-r border-line bg-panel/70 py-3 backdrop-blur-2xl"
      >
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-brand/10 blur-3xl" />

        <div className={cn('relative flex items-center gap-2 px-3 pb-2', collapsed && 'justify-center px-0')}>
          <button
            type="button"
            onClick={() => navigate('/')}
            title={t('nav.home')}
            className="no-drag grid size-8 place-items-center rounded-lg border border-brand/35 bg-base/70 text-brand transition-colors hover:border-brand/60"
          >
            <Logo size={18} />
          </button>
          {!collapsed ? <span className="hud-label truncate">TDS</span> : null}
        </div>


        <div className="relative flex-1 space-y-3.5 overflow-y-auto px-3 pb-2 pt-1">
          {GROUPS.map((group) => {
            const items = group.items.filter((entry) => !entry.moderatorOnly || isModeratorRole(role))
            if (items.length === 0) return null
            return (
              <div key={group.titleKey} className="space-y-1">
                {collapsed ? (
                  <div className="mx-auto mb-1.5 h-px w-6 bg-line" />
                ) : (
                  <div className="flex items-center gap-2 px-2 pb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-mute/70">{t(group.titleKey)}</span>
                    <span className="h-px flex-1 bg-line/70" />
                  </div>
                )}
                {items.map((entry) => navItem(entry, isActive(entry.path, path)))}
              </div>
            )
          })}
        </div>

        <div className="relative space-y-2 px-3 pt-1">
          {runCard}
          {accountMenu}
        </div>

        <div className="relative mx-3 mt-2 flex items-center gap-2 border-t border-line/70 pt-2">
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? t('nav.expand') : t('nav.collapse')}
            aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
            className={cn(
              'no-drag flex size-7 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:bg-panel-soft hover:text-ink',
              !collapsed && 'order-last'
            )}
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
          {!collapsed ? (
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-mute/70">
              {metaQuery.data ? `v${metaQuery.data.version} · ${metaQuery.data.policyVersion}` : 'TDS Companion'}
            </span>
          ) : null}
        </div>
      </motion.nav>
    </TooltipProvider>
  )
}
