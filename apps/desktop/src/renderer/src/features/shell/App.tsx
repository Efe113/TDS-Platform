import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { IPC_CHANNELS, hotKeyEventSchema, settingsSchema, type AppMeta, type Settings } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { navigate, routeSegments, useRoutePath } from '../../lib/router'
import { useIpcEvent } from '../../lib/events'
import { call, IpcError } from '../../lib/ipc'
import { useAppStore } from '../../store/app-store'
import { initAuth, selectSignedIn, useAuth } from '../../store/auth-store'
import { cn } from '../../components/ui'
import { SideNav } from './SideNav'
import { TitleBar } from './TitleBar'
import { RunRail } from './RunRail'
import { NotFoundPage } from './NotFoundPage'
import { useSettingsHub } from '../settings/use-settings'
import { HomePage } from '../home/HomePage'
import { ImportPage } from '../import/ImportPage'
import { DiscoverPage } from '../discover/DiscoverPage'
import { LeaderboardPage } from '../leaderboard/LeaderboardPage'
import { WalletPage } from '../wallet/WalletPage'
import { MarketPage } from '../market/MarketPage'
import { ProfilePage } from '../profile/ProfilePage'
import { CorporatePage, VerifiedPage } from '../verified/AccountRequestPage'
import { StrategyDetailPage } from '../detail/StrategyDetailPage'
import { AdminPage } from '../admin/AdminPage'
import { AuthPage } from '../auth/AuthPage'
import { SettingsPage } from '../settings/SettingsPage'
import { LegalPage } from '../legal/LegalPage'
import { AboutPage } from '../about/AboutPage'
import { ConsentGate } from '../legal/ConsentGate'
import { ComingSoonPage } from '../milestone/ComingSoonPage'
import { fetchWallet } from '../../lib/wallet-api'
import { fetchMaintenanceFlag } from '../admin/admin-api'
import { applyTheme } from '../../lib/theme'
import { ThemeBackdrop } from '../../components/brand/theme-backdrop'
import { MotionProvider } from '../../motion/context'
import { RouteSwitch } from '../../motion/primitives/RouteSwitch'

const COMING_SOON: Record<string, { titleKey: 'nav.discover' | 'nav.leaderboard' | 'nav.badges'; bodyKey: 'milestone.discover' | 'milestone.leaderboard' | 'milestone.badges'; milestone: string }> = {
  badges: { titleKey: 'nav.badges', bodyKey: 'milestone.badges', milestone: '7' },
}

function renderRoute(path: string): ReactNode {
  const head = routeSegments(path)[0] ?? ''
  switch (head) {
    case '':
    case 'home':
      return <HomePage />
    case 'import':
      return <ImportPage />
    case 'discover':
      return <DiscoverPage />
    case 'leaderboard':
      return <LeaderboardPage />
    case 'wallet':
      return <WalletPage />
    case 'market':
      return <MarketPage />
    case 'profile':
      return <ProfilePage />
    case 'verified':
      return <VerifiedPage />
    case 'corporate':
      return <CorporatePage />
    case 'strategy':
      return <StrategyDetailPage />
    case 'account':
      return <AuthPage />
    case 'admin':
      return <AdminPage />
    case 'settings':
      return <SettingsPage />
    case 'legal':
      return <LegalPage />
    case 'about':
      return <AboutPage />
    default: {
      const comingSoon = COMING_SOON[head]
      return comingSoon ? <ComingSoonPage {...comingSoon} /> : <NotFoundPage />
    }
  }
}

export function App(): ReactNode {
  const t = useT()
  const path = useRoutePath()
  const mainRef = useRef<HTMLElement>(null)
  const recordKey = useAppStore((state) => state.recordKey)

  const metaQuery = useQuery({
    queryKey: ['app', 'meta'],
    queryFn: () => call<AppMeta>(IPC_CHANNELS.appGetMeta),
    retry: false
  })

  const queryClient = useQueryClient()
  // The hub owns the settings/binding/status cache and keeps them mirrored from main; the title bar
  // shows hook status permanently, so the mirror has to live in the shell rather than the settings page.
  const settingsQuery = useSettingsHub().settings

  // Settings live in main, so the shell mirrors every change into the cache. Without this the motion
  // tier and the language would only update on a restart.
  useIpcEvent(IPC_CHANNELS.settingsChanged, settingsSchema, (next) => {
    queryClient.setQueryData(['settings'], next)
  })

  useEffect(() => {
    const locale = settingsQuery.data?.locale
    if (locale && locale !== i18next.language) void i18next.changeLanguage(locale)
  }, [settingsQuery.data?.locale])

  // Accessibility settings are renderer concerns: rem-based Tailwind sizes follow the root font size,
  // and the contrast attribute switches the high-contrast rules in global.css.
  useEffect(() => {
    const root = document.documentElement
    root.style.fontSize = `${String(Math.round(16 * (settingsQuery.data?.uiScale ?? 1)))}px`
    root.dataset.contrast = settingsQuery.data?.highContrast ? 'high' : 'normal'
  }, [settingsQuery.data?.uiScale, settingsQuery.data?.highContrast])

  // The start page applies once, on the first launch after the preferred route was saved. Deep links
  // must win, so a non-home path is never redirected.
  const startApplied = useRef(false)
  useEffect(() => {
    const settings = settingsQuery.data
    if (!settings || startApplied.current) return
    startApplied.current = true
    const atHome = path === '' || path === '/' || path === '/home'
    if (atHome && settings.startRoute !== 'home') navigate(`/${settings.startRoute}`)
  }, [settingsQuery.data, path])

  useEffect(() => initAuth(), [])

  // The profile theme is a server value, so the skin is applied here rather than in the wallet page:
  // it has to hold on every screen and reset on sign-out. Only the key crosses the wire - the tokens,
  // ambient layer and motion signature come from the local registry.
  const signedIn = useAuth(selectSignedIn)
  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: fetchWallet, enabled: signedIn, retry: 1 })
  const [skin, setSkin] = useState(() => applyTheme(null))

  useEffect(() => {
    const next = applyTheme(signedIn ? walletQuery.data?.theme : null)
    setSkin(next)
    // The overlay window cannot read the profile, so the skin key is mirrored into local settings;
    // the guard prevents a write loop when the settings event comes back.
    if (settingsQuery.data && settingsQuery.data.overlayThemeKey !== next.key) {
      void call<Settings>(IPC_CHANNELS.settingsSet, { overlayThemeKey: next.key }).catch(() => undefined)
    }
  }, [signedIn, walletQuery.data?.theme, settingsQuery.data?.overlayThemeKey, settingsQuery.data])

  useIpcEvent(IPC_CHANNELS.hotkeysEvent, hotKeyEventSchema, recordKey)

  const bridgeMissing = metaQuery.error instanceof IpcError && metaQuery.error.code === 'bridge-missing'

  // Maintenance is a server flag, so the banner is a read, not a switch. It is polled because an
  // operator flips it while the app is open.
  const maintenanceQuery = useQuery({
    queryKey: ['maintenance'],
    queryFn: fetchMaintenanceFlag,
    refetchInterval: 60_000,
    retry: false
  })

  // Two segments deep, so moving between two strategies swaps the screen the same way a new section does.
  const swapKey = routeSegments(path).slice(0, 2).join('/') || 'home'

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
  }, [swapKey])

  return (
    <MotionProvider setting={settingsQuery.data?.motionTier ?? 'auto'}>
    <div className="relative flex h-full flex-col overflow-hidden text-ink">
      <ThemeBackdrop
        skin={skin}
        backgroundPath={signedIn ? (walletQuery.data?.vipBackgroundPath ?? null) : null}
      />

      <TitleBar skin={skin} />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <SideNav />

        <div className="relative flex min-w-0 flex-1 flex-col">
          {bridgeMissing ? (
            <div className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">{t('app.bridgeMissing')}</div>
          ) : null}

          {maintenanceQuery.data ? (
            <div className="flex items-center gap-2 border-b border-warn/40 bg-warn/10 px-4 py-2 text-[12px] text-warn">
              <span className="size-1.5 shrink-0 rounded-full bg-warn" />
              {t('app.maintenanceBanner')}
            </div>
          ) : null}

          <main ref={mainRef} className={cn('min-w-0 flex-1 overflow-y-auto px-6 py-5')}>
            <div className="mx-auto max-w-4xl">
              <ConsentGate>
                <RouteSwitch routeKey={swapKey}>{renderRoute(path)}</RouteSwitch>
              </ConsentGate>
            </div>
          </main>
        </div>

        <RunRail />
      </div>
    </div>
    </MotionProvider>
  )
}
