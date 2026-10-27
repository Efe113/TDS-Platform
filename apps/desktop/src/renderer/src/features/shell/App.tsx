import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { IPC_CHANNELS, deepLinkSchema, hotKeyEventSchema, pickNotices, settingsSchema, type ActiveAnnouncement, type AppMeta, type Settings } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { navigate, routeSegments, useRoutePath } from '../../lib/router'
import { useIpcEvent } from '../../lib/events'
import { call, IpcError } from '../../lib/ipc'
import { useAppStore } from '../../store/app-store'
import { initAuth, selectRole, selectSignedIn, useAuth } from '../../store/auth-store'
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
import { fetchActiveCampaigns, pickCampaignBanner } from '../../lib/campaign-api'
import { fetchActiveAnnouncements, markAnnouncement } from '../../lib/announcement-api'
import { useDismissal } from '../../lib/dismissals'
import { fetchMaintenance } from '../admin/admin-api'
import { MaintenanceBanner, MaintenanceGate } from './MaintenanceSurface'
import { CampaignBand, CampaignModal } from './CampaignSurface'
import { NoticeBand, NoticeModal } from './NoticeSurface'
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

  // A `tdsapp://…` link opened while the app is running arrives as an already-validated route.
  useIpcEvent(IPC_CHANNELS.appDeepLink, deepLinkSchema, (link) => {
    navigate(link.route)
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
    queryFn: fetchMaintenance,
    refetchInterval: 60_000,
    retry: false
  })
  const maintenance = maintenanceQuery.data ?? null
  // Staff see the band but never the gate: the person who can lift maintenance must not be locked out
  // of the console that lifts it.
  const staffRole = useAuth(selectRole)
  const staff = staffRole === 'admin' || staffRole === 'moderator'

  // Campaigns are read the same way: an operator opens one while the app is running, and the band has
  // to appear without a restart. `active_campaigns()` is a definer function, so what the band says and
  // what award_currency pays come from the same rows.
  const campaignsQuery = useQuery({
    queryKey: ['campaigns'],
    queryFn: fetchActiveCampaigns,
    refetchInterval: 60_000,
    retry: false
  })
  const noticesQuery = useQuery({
    queryKey: ['notices'],
    queryFn: fetchActiveAnnouncements,
    refetchInterval: 60_000,
    retry: false
  })

  // A dismissal answered by the server follows the account; when there is no account to attribute the
  // click to, the same click is kept here so a visitor is not ambushed on every poll.
  const [localDismissals, setLocalDismissals] = useState<Record<string, string>>({})
  const visibleNotices = (noticesQuery.data ?? []).filter((notice) => localDismissals[notice.key] !== notice.updatedAt)
  const notices = pickNotices(visibleNotices, Date.now())

  const dismissNotice = (notice: ActiveAnnouncement): void => {
    void markAnnouncement(notice.key, 'dismissed')
      .then((recorded) => {
        if (recorded) void queryClient.invalidateQueries({ queryKey: ['notices'] })
        else setLocalDismissals((current) => ({ ...current, [notice.key]: notice.updatedAt }))
      })
      .catch(() => setLocalDismissals((current) => ({ ...current, [notice.key]: notice.updatedAt })))
  }

  const acknowledgeNotice = (notice: ActiveAnnouncement): void => {
    void markAnnouncement(notice.key, 'read')
      .then(() => queryClient.invalidateQueries({ queryKey: ['notices'] }))
      .catch(() => undefined)
    setOpenNotice(null)
  }

  const campaign = pickCampaignBanner(campaignsQuery.data ?? [])
  const [campaignDismissed, dismissCampaign] = useDismissal(campaign?.key ?? null, campaign?.endsAt ?? null)
  const [campaignOpen, setCampaignOpen] = useState(false)
  // The notice whose detail is open: either the one the shell opened by itself, or the one the member
  // clicked into from a band. A banner notice with a long text still has a story to tell.
  const [openNotice, setOpenNotice] = useState<ActiveAnnouncement | null>(null)
  // A modal campaign opens by itself exactly once per campaign, not once per poll: the 60 second refetch
  // would otherwise re-arm the interruption while the member is reading something else.
  const autoOpened = useRef<string | null>(null)

  // One interruption at a time, and a notice outranks a campaign: an announcement is about the member's
  // account, a campaign is about the shop.
  const noticeModal = notices.modal !== null && notices.modal.state === 'live' && notices.modal.readAt === null ? notices.modal : null
  const noticeBand = notices.band

  useEffect(() => {
    if (noticeModal !== null) {
      if (autoOpened.current === `notice:${noticeModal.key}`) return
      autoOpened.current = `notice:${noticeModal.key}`
      setOpenNotice(noticeModal)
      return
    }
    if (campaign === null || campaignDismissed) return
    if (campaign.surface !== 'modal' || campaign.state !== 'live') return
    if (autoOpened.current === `campaign:${campaign.key}`) return
    autoOpened.current = `campaign:${campaign.key}`
    setCampaignOpen(true)
  }, [campaign, campaignDismissed, noticeModal])

  const closeCampaign = (): void => {
    setCampaignOpen(false)
    // Closing the interruption means having seen it; the band's own cross does the same.
    if (campaign?.surface === 'modal') dismissCampaign()
  }

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

          {maintenance !== null && (maintenance.on || maintenance.scheduled) ? (
            <MaintenanceBanner state={maintenance} />
          ) : null}

          {/* One band, one voice. Maintenance is the platform's own state and always comes first; after
              it a notice outranks a campaign, because a notice is about the member's account. */}
          {noticeBand !== null ? (
            <NoticeBand
              notice={noticeBand}
              onOpen={() => setOpenNotice(noticeBand)}
              onDismiss={() => dismissNotice(noticeBand)}
            />
          ) : campaign !== null && !campaignDismissed && campaign.surface === 'banner' && noticeModal === null ? (
            <CampaignBand
              campaign={campaign}
              onOpen={() => setCampaignOpen(true)}
              onDismiss={dismissCampaign}
            />
          ) : null}

          <main ref={mainRef} className={cn('min-w-0 flex-1 overflow-y-auto px-6 py-5')}>
            <div className="mx-auto max-w-4xl">
              <ConsentGate>
                <RouteSwitch routeKey={swapKey}>{renderRoute(path)}</RouteSwitch>
              </ConsentGate>
            </div>
          </main>

          {/* Outside the scroll container on purpose: an absolute child of an `overflow-y-auto` box
              positions against it and drifts when the page is scrolled partway down. */}
          {maintenance !== null && maintenance.on && maintenance.mode === 'locked' ? (
            <MaintenanceGate state={maintenance} staff={staff} />
          ) : null}

          {/* A notice owns the interruption while it is unread; a campaign waits for the band. */}
          {openNotice !== null ? <NoticeModal notice={openNotice} onAck={() => acknowledgeNotice(openNotice)} onClose={() => setOpenNotice(null)} /> : null}

          {/* A campaign opened from the band, or by itself when the operator chose the modal surface. */}
          {campaignOpen && campaign !== null && openNotice === null ? (
            <CampaignModal campaign={campaign} onClose={closeCampaign} />
          ) : null}
        </div>

        <RunRail />
      </div>
    </div>
    </MotionProvider>
  )
}
