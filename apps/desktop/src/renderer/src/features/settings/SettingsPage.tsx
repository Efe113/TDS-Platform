import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import type { LucideIcon } from 'lucide-react'
import {
  Check,
  ChevronRight,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  HardDrive,
  Info,
  Keyboard,
  Languages,
  LogOut,
  MonitorPlay,
  Palette,
  Pause,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  UserRound,
  Wallet
} from 'lucide-react'
import {
  DEFAULT_HOTKEY_BINDINGS,
  IPC_CHANNELS,
  MOTION_SETTINGS,
  START_ROUTES,
  UI_SCALES,
  settingsSchema,
  themeSkin,
  type AppMeta,
  type HotkeyStatus,
  type MotionSetting,
  type Settings,
  type StartRoute,
  type ThemeKey,
  type UiScale
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { call } from '../../lib/ipc'
import { navigate } from '../../lib/router'
import { fetchWallet, selectTheme } from '../../lib/wallet-api'
import { skinRows, SKIN_NAME_KEYS } from '../../lib/skins'
import { useIdentity } from '../../lib/identity'
import { selectSignedIn, useAuth } from '../../store/auth-store'
import { useAppStore } from '../../store/app-store'
import { useMotion } from '../../motion/context'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { Banner, Button, Field, INPUT_CLASS, Toggle, cn } from '../../components/ui'
import { Chip, PageHeader, Segmented } from '../../components/ui/system'
import { StateError, StateLoading } from '../../components/ui/states'
import { CoinAmount } from '../../components/brand/coin'
import { ThemePreview } from '../../components/brand/theme-preview'
import { useSettingsHub } from './use-settings'
import { HotkeysPanel } from './HotkeysPanel'
import { OverlayPanel } from './OverlayPanel'
import { OverlayEditor } from './OverlayEditor'
import { UpdateSection } from './UpdateSection'

/**
 * Settings is a console, not a long scroll of switches: the rail tells you which system you are
 * touching, the search finds a control by its label, and every write reports back through the same
 * main-owned settings store. Desktop-only toggles say so instead of silently doing nothing in dev.
 */

type SettingsTab = 'general' | 'appearance' | 'overlay' | 'hotkeys' | 'privacy' | 'about'

const TABS: Array<{ id: SettingsTab; labelKey: MessageKey; icon: LucideIcon }> = [
  { id: 'general', labelKey: 'settings.general', icon: Power },
  { id: 'appearance', labelKey: 'settings.appearance', icon: Palette },
  { id: 'overlay', labelKey: 'settings.overlay', icon: MonitorPlay },
  { id: 'hotkeys', labelKey: 'settings.hotkeys', icon: Keyboard },
  { id: 'privacy', labelKey: 'settings.tabPrivacy', icon: ShieldCheck },
  { id: 'about', labelKey: 'settings.tabAbout', icon: Info }
]

const MOTION_TIER_LABEL: Record<MotionSetting, MessageKey> = {
  auto: 'settings.motionAuto',
  low: 'settings.motionLow',
  medium: 'settings.motionMedium',
  high: 'settings.motionHigh'
}

const SCALE_LABEL: Record<UiScale, MessageKey> = {
  0.9: 'settings.scaleSmall',
  1: 'settings.scaleNormal',
  1.1: 'settings.scaleLarge'
}

const START_LABEL: Record<StartRoute, MessageKey> = {
  home: 'nav.home',
  discover: 'nav.discover',
  leaderboard: 'nav.leaderboard'
}

interface SearchEntry {
  tab: SettingsTab
  labelKey: MessageKey
  keywords: string
}

const SEARCH_ENTRIES: SearchEntry[] = [
  { tab: 'general', labelKey: 'settings.locale', keywords: 'language locale dil' },
  { tab: 'general', labelKey: 'settings.startRoute', keywords: 'start page route açılış sayfa' },
  { tab: 'general', labelKey: 'settings.launchAtLogin', keywords: 'login startup windows başlangıç otomatik' },
  { tab: 'general', labelKey: 'settings.startMinimized', keywords: 'minimized tray hidden küçült tepsi' },
  { tab: 'general', labelKey: 'settings.closeToTray', keywords: 'close tray quit kapat çıkış' },
  { tab: 'general', labelKey: 'settings.autoStartOverlay', keywords: 'overlay autostart başlat' },
  { tab: 'general', labelKey: 'settings.preventSleep', keywords: 'sleep screen uyku ekran' },
  { tab: 'appearance', labelKey: 'settings.uiScale', keywords: 'scale font size zoom ölçek yazı' },
  { tab: 'appearance', labelKey: 'settings.highContrast', keywords: 'contrast accessibility kontrast erişim' },
  { tab: 'appearance', labelKey: 'settings.motionTier', keywords: 'motion animation fps hareket animasyon' },
  { tab: 'appearance', labelKey: 'settings.themeQuick', keywords: 'theme skin tema görünüm' },
  { tab: 'overlay', labelKey: 'settings.overlay', keywords: 'overlay geometry konum boyut' },
  { tab: 'overlay', labelKey: 'settings.overlay.monitor', keywords: 'monitor display screen ekran monitör' },
  { tab: 'overlay', labelKey: 'settings.overlay.reset', keywords: 'reset position sıfırla konum' },
  { tab: 'overlay', labelKey: 'settings.overlayEditorTitle', keywords: 'overlay card style kart stil önizleme' },
  { tab: 'hotkeys', labelKey: 'settings.hotkeys', keywords: 'hotkey shortcut keyboard kısayol tuş' },
  { tab: 'hotkeys', labelKey: 'settings.pause.title', keywords: 'pause hotkeys duraklat' },
  { tab: 'hotkeys', labelKey: 'settings.hotkeysReset', keywords: 'reset default hotkeys kısayol sıfırla' },
  { tab: 'privacy', labelKey: 'settings.telemetry', keywords: 'telemetry crash sentry çökme telemetri' },
  { tab: 'privacy', labelKey: 'settings.usageTracking', keywords: 'usage tracking stats kullanım istatistik' },
  { tab: 'privacy', labelKey: 'settings.policyLinks', keywords: 'privacy terms consent gizlilik koşullar onay' },
  { tab: 'privacy', labelKey: 'settings.dataTools', keywords: 'export import data yedek veri' },
  { tab: 'privacy', labelKey: 'settings.exportSettings', keywords: 'export json copy dışa aktar' },
  { tab: 'privacy', labelKey: 'settings.importSettings', keywords: 'import json paste içe aktar' },
  { tab: 'privacy', labelKey: 'settings.resetSettings', keywords: 'reset defaults sıfırla' },
  { tab: 'privacy', labelKey: 'settings.cacheTitle', keywords: 'cache clear önbellek temizle' },
  { tab: 'privacy', labelKey: 'settings.data.title', keywords: 'folders logs imports klasör günlük' },
  { tab: 'privacy', labelKey: 'settings.diagnostics', keywords: 'diagnostics support tanılama destek' },
  { tab: 'about', labelKey: 'settings.systemTitle', keywords: 'version platform electron system sürüm sistem' },
  { tab: 'about', labelKey: 'settings.accountTitle', keywords: 'account profile wallet hesap profil cüzdan' },
  { tab: 'about', labelKey: 'settings.aboutLinks', keywords: 'about legal hakkında politika' },
  { tab: 'about', labelKey: 'update.title', keywords: 'update version güncelleme sürüm' }
]

function SettingsSection({
  icon: Icon,
  title,
  hint,
  action,
  children
}: {
  icon: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <section className="hud-panel p-4">
      <div className="mb-3 flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-brand/25 bg-brand/10 text-brand">
          <Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold tracking-wide text-ink">{title}</h2>
          {hint ? <p className="mt-0.5 text-[11px] leading-relaxed text-mute">{hint}</p> : null}
        </div>
        {action}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  )
}

function PrefToggle({
  label,
  hint,
  checked,
  onChange,
  badge
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (next: boolean) => void
  badge?: ReactNode
}): ReactNode {
  return (
    <div className="space-y-1">
      <Toggle
        checked={checked}
        onChange={onChange}
        label={
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            {label}
            {badge}
          </span>
        }
      />
      <p className="px-1 text-[10px] leading-relaxed text-mute">{hint}</p>
    </div>
  )
}

export function SettingsPage(): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()
  const hub = useSettingsHub()
  const settings = hub.settings.data
  const status = hub.status.data
  const motion = useMotion()
  const identity = useIdentity()
  const signedIn = useAuth(selectSignedIn)
  const signOut = useAuth((state) => state.signOut)
  const authBusy = useAuth((state) => state.busy)
  const overlayVisible = useAppStore((state) => state.overlayState?.visible ?? state.overlayVisible)

  const [tab, setTab] = useState<SettingsTab>('general')
  const [query, setQuery] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<MessageKey | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const copyTimer = useRef<number | null>(null)

  const patch = useMutation({
    mutationFn: async (value: Partial<Settings>) => call<Settings>(IPC_CHANNELS.settingsSet, value),
    onSuccess: (next) => {
      hub.writeSettings(next)
      setSavedAt(Date.now())
      setFailure(null)
      setNotice(null)
      if (next.locale !== i18next.language) void i18next.changeLanguage(next.locale)
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const pause = useMutation({
    mutationFn: async (paused: boolean) => call<HotkeyStatus>(IPC_CHANNELS.hotkeysPause, { paused }),
    onSuccess: hub.writeStatus
  })

  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: fetchWallet, enabled: signedIn, retry: 1 })
  const metaQuery = useQuery({
    queryKey: ['app', 'meta'],
    queryFn: () => call<AppMeta>(IPC_CHANNELS.appGetMeta),
    staleTime: 300_000,
    retry: false
  })

  const themeChoice = useMutation({
    mutationFn: (key: ThemeKey) => selectTheme(key),
    onSuccess: () => {
      setSavedAt(Date.now())
      setFailure(null)
      setNotice(null)
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      if (event.key === '/' && !typing) {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if (event.key === 'Escape' && target === searchRef.current) {
        setQuery('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    }
  }, [])

  const copyText = (text: string, key: string): void => {
    if (!navigator.clipboard) {
      setFailure(t('settings.clipboardUnavailable'))
      return
    }
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(key)
        if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
        copyTimer.current = window.setTimeout(() => setCopied(null), 1700)
      })
      .catch(() => setFailure(t('settings.clipboardUnavailable')))
  }

  const themeRows = useMemo(
    () => skinRows(walletQuery.data?.catalog ?? []).filter((row) => row.owned),
    [walletQuery.data]
  )
  const activeTheme = walletQuery.data?.theme ?? 'default'

  const searchResults = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr')
    if (normalized.length === 0) return []
    return SEARCH_ENTRIES.filter((entry) => {
      const label = t(entry.labelKey).toLocaleLowerCase('tr')
      return label.includes(normalized) || entry.keywords.includes(normalized) || entry.tab.includes(normalized)
    })
  }, [query, t])

  const diagnostics = (): string => {
    const s = hub.settings.data
    return [
      `TDS Companion ${metaQuery.data?.version ?? '?'} · Electron ${metaQuery.data?.electron ?? '?'} · ${metaQuery.data?.platform ?? '?'}`,
      `policy=${metaQuery.data?.policyVersion ?? '?'} packaged=${String(metaQuery.data?.packaged ?? false)}`,
      `data=${metaQuery.data?.userDataPath ?? '?'}`,
      `hotkeys=${status?.backend ?? '?'} running=${String(status?.running ?? false)} paused=${String(status?.paused ?? false)}`,
      `overlay=${String(overlayVisible)} motion=${motion.tier} fps=${motion.averageFps === null ? 'pending' : String(Math.round(motion.averageFps))}`,
      `theme=${walletQuery.data?.theme ?? 'default'} signedIn=${String(signedIn)} vip=${String(walletQuery.data?.vip ?? false)}`,
      `settings=${JSON.stringify(s ?? {})}`
    ].join('\n')
  }

  const applyImport = async (): Promise<void> => {
    setImportError(null)
    try {
      const raw: unknown = JSON.parse(importText)
      const parsed = settingsSchema.safeParse(raw)
      if (!parsed.success) {
        setImportError(t('settings.importInvalid'))
        return
      }
      await patch.mutateAsync(parsed.data)
      setImportText('')
      setNotice('settings.importSuccess')
    } catch {
      setImportError(t('settings.importInvalid'))
    }
  }

  const resetSettings = (): void => {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    setConfirmReset(false)
    setNotice(null)
    void patch
      .mutateAsync(settingsSchema.parse({}))
      .then(() => {
        setNotice('settings.resetSuccess')
      })
      .catch(() => undefined)
  }

  const clearCache = (): void => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setConfirmClear(false)
    queryClient.clear()
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('tds.leaderboard.watch.')) localStorage.removeItem(key)
    }
    setNotice('settings.cacheCleared')
  }

  const saveState = patch.isPending ? (
    <Chip tone="warn" icon={RefreshCw}>
      {t('settings.saving')}
    </Chip>
  ) : savedAt !== null ? (
    <Chip tone="good" icon={Check}>
      {t('settings.savedShort')}
    </Chip>
  ) : (
    <Chip tone="neutral">{t('settings.autoSave')}</Chip>
  )

  const renderSearch = (): ReactNode => (
    <section className="hud-panel p-4">
      <div className="mb-2 flex items-center gap-2">
        <Search size={14} className="text-brand" />
        <h2 className="text-[13px] font-semibold text-ink">{t('settings.searchResults')}</h2>
        <Chip tone="neutral">{t('settings.searchCount', { count: searchResults.length })}</Chip>
      </div>
      {searchResults.length === 0 ? (
        <p className="text-[11px] text-mute">{t('settings.searchEmpty')}</p>
      ) : (
        <div className="space-y-1">
          {searchResults.map((entry) => (
            <button
              key={`${entry.tab}-${entry.labelKey}`}
              type="button"
              onClick={() => {
                setTab(entry.tab)
                setQuery('')
              }}
              className="no-drag flex w-full items-center gap-2 rounded-lg border border-line/60 bg-base/35 px-2.5 py-2 text-left text-[12px] text-ink transition-colors hover:border-brand/50 hover:bg-brand/5"
            >
              <span className="min-w-0 flex-1 break-words">{t(entry.labelKey)}</span>
              <span className="text-[10px] text-mute">{t(TABS.find((item) => item.id === entry.tab)?.labelKey ?? 'settings.general')}</span>
              <ChevronRight size={12} className="shrink-0 text-mute" />
            </button>
          ))}
        </div>
      )}
    </section>
  )

  const renderGeneral = (): ReactNode => (
    <>
      <SettingsSection
        icon={Languages}
        title={t('settings.general')}
        hint={t('settings.generalHint')}
      >
        <Field label={t('settings.locale')} hint={t('settings.localeHint')}>
          <select
            className={INPUT_CLASS}
            value={settings?.locale ?? 'tr'}
            onChange={(event) => patch.mutate({ locale: event.target.value as Settings['locale'] })}
          >
            <option value="tr">Türkçe</option>
            <option value="en">English</option>
          </select>
        </Field>
        <Field label={t('settings.startRoute')} hint={t('settings.startRouteHint')}>
          <select
            className={INPUT_CLASS}
            value={settings?.startRoute ?? 'home'}
            onChange={(event) => patch.mutate({ startRoute: event.target.value as StartRoute })}
          >
            {START_ROUTES.map((route) => (
              <option key={route} value={route}>
                {t(START_LABEL[route])}
              </option>
            ))}
          </select>
        </Field>
      </SettingsSection>

      <SettingsSection icon={Power} title={t('settings.startupTitle')} hint={t('settings.startupHint')}>
        <PrefToggle
          label={t('settings.launchAtLogin')}
          hint={t('settings.launchAtLoginHint')}
          checked={settings?.launchAtLogin ?? false}
          onChange={(next) => patch.mutate({ launchAtLogin: next })}
          badge={metaQuery.data && !metaQuery.data.packaged ? <Chip tone="warn">{t('settings.packagedOnly')}</Chip> : undefined}
        />
        <PrefToggle
          label={t('settings.startMinimized')}
          hint={t('settings.startMinimizedHint')}
          checked={settings?.startMinimized ?? false}
          onChange={(next) => patch.mutate({ startMinimized: next })}
        />
        <PrefToggle
          label={t('settings.closeToTray')}
          hint={t('settings.closeToTrayHint')}
          checked={settings?.closeToTray ?? true}
          onChange={(next) => patch.mutate({ closeToTray: next })}
        />
        <PrefToggle
          label={t('settings.autoStartOverlay')}
          hint={t('settings.autoStartOverlayHint')}
          checked={settings?.autoStartOverlay ?? false}
          onChange={(next) => patch.mutate({ autoStartOverlay: next })}
        />
      </SettingsSection>

      <SettingsSection icon={MonitorPlay} title={t('settings.behaviorTitle')} hint={t('settings.behaviorHint')}>
        <PrefToggle
          label={t('settings.preventSleep')}
          hint={t('settings.preventSleepHint')}
          checked={settings?.preventSleep ?? false}
          onChange={(next) => patch.mutate({ preventSleep: next })}
        />
      </SettingsSection>
    </>
  )

  const renderAppearance = (): ReactNode => (
    <>
      <SettingsSection icon={Palette} title={t('settings.uiScale')} hint={t('settings.uiScaleHint')}>
        <Segmented
          value={String(settings?.uiScale ?? 1)}
          onChange={(value) => patch.mutate({ uiScale: Number(value) as UiScale })}
          options={UI_SCALES.map((scale) => ({ value: String(scale), label: t(SCALE_LABEL[scale]) }))}
        />
        <PrefToggle
          label={t('settings.highContrast')}
          hint={t('settings.highContrastHint')}
          checked={settings?.highContrast ?? false}
          onChange={(next) => patch.mutate({ highContrast: next })}
        />
      </SettingsSection>

      <SettingsSection icon={Sparkles} title={t('settings.motionTier')} hint={t('settings.motionTierHint')}>
        <Segmented
          value={settings?.motionTier ?? 'auto'}
          onChange={(value) => patch.mutate({ motionTier: value })}
          options={MOTION_SETTINGS.map((option) => ({ value: option, label: t(MOTION_TIER_LABEL[option]) }))}
        />
        <p className="text-[10px] leading-relaxed text-mute">
          {t('settings.motionProof', {
            tier: motion.tier,
            fps: motion.averageFps === null ? t('common.loading') : String(Math.round(motion.averageFps)),
            reason: motion.reason
          })}
        </p>
      </SettingsSection>

      <SettingsSection
        icon={Palette}
        title={t('settings.themeQuick')}
        hint={t('settings.themeQuickHint')}
        action={
          <Button size="sm" variant="subtle" onClick={() => navigate('/market')}>
            {t('settings.openMarket')}
          </Button>
        }
      >
        {!signedIn ? <p className="text-[11px] text-mute">{t('settings.themeSignedOut')}</p> : null}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {themeRows.map((row) => {
            const active = activeTheme === row.key
            return (
              <button
                key={row.key}
                type="button"
                disabled={themeChoice.isPending || !signedIn}
                onClick={() => themeChoice.mutate(row.key)}
                className={cn(
                  'no-drag rounded-lg border p-1.5 text-left transition-colors',
                  active ? 'border-brand bg-brand/10' : 'border-line bg-base/40 hover:border-brand/50'
                )}
              >
                <ThemePreview value={row.key} className="h-9 w-full" detailed={false} />
                <span className="mt-1 block break-words text-[10px] text-ink">{t(SKIN_NAME_KEYS[row.key])}</span>
                <span className="block text-[9px] text-mute">{active ? t('wallet.inUse') : t('wallet.use')}</span>
              </button>
            )
          })}
        </div>
      </SettingsSection>
    </>
  )

  const renderOverlay = (): ReactNode => (
    <>
      <OverlayPanel
        geometry={settings?.overlay}
        onSaved={(next) => {
          if (!settings) return
          hub.writeSettings({ ...settings, overlay: next })
          setSavedAt(Date.now())
        }}
      />
      {settings ? (
        <OverlayEditor
          geometry={settings.overlay}
          themeName={t(themeSkin(settings.overlayThemeKey).moodKey)}
          onSaved={(next) => {
            hub.writeSettings({ ...settings, overlay: next })
            setSavedAt(Date.now())
            void hub.patchSettings({ overlay: next }).catch(() => undefined)
          }}
        />
      ) : null}
    </>
  )

  const renderHotkeys = (): ReactNode => (
    <>
      <HotkeysPanel bindings={hub.bindings.data} status={status} onChanged={hub.refresh} />
      <SettingsSection icon={Pause} title={t('settings.pause.title')} hint={t('settings.pauseHint')}>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={status?.paused ? 'primary' : 'ghost'}
            busy={pause.isPending}
            disabled={!status}
            onClick={() => pause.mutate(!(status?.paused ?? false))}
          >
            {status?.paused ? <Play size={13} /> : <Pause size={13} />}
            {status?.paused ? t('settings.pause.on') : t('settings.pause.off')}
          </Button>
          <Button
            variant="subtle"
            onClick={() => patch.mutate({ hotkeys: DEFAULT_HOTKEY_BINDINGS })}
          >
            <RotateCcw size={13} />
            {t('settings.hotkeysReset')}
          </Button>
        </div>
        <p className="text-[10px] leading-relaxed text-mute">{t('settings.hotkeysResetHint')}</p>
      </SettingsSection>
      {pause.error ? <Banner tone="danger" title={t('common.errorTitle')}>{pause.error.message}</Banner> : null}
    </>
  )

  const renderPrivacy = (): ReactNode => (
    <>
      <SettingsSection icon={ShieldCheck} title={t('settings.privacyTitle')} hint={t('settings.privacyHint')}>
        <PrefToggle
          label={t('settings.telemetry')}
          hint={t('settings.telemetryHint')}
          checked={settings?.telemetryOptIn ?? false}
          onChange={(next) => patch.mutate({ telemetryOptIn: next })}
        />
        <PrefToggle
          label={t('settings.usageTracking')}
          hint={t('settings.usageHint')}
          checked={settings?.usageTracking ?? true}
          onChange={(next) => patch.mutate({ usageTracking: next })}
        />
      </SettingsSection>

      <SettingsSection icon={FileText} title={t('settings.policyLinks')} hint={t('settings.policyLinksHint')}>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate('/legal')}>
            <ExternalLink size={13} />
            {t('settings.openLegal')}
          </Button>
          <Button size="sm" variant="subtle" onClick={() => navigate('/about')}>
            <Info size={13} />
            {t('settings.openAbout')}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection icon={Database} title={t('settings.dataTools')} hint={t('settings.dataToolsHint')}>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (settings) copyText(JSON.stringify(settings, null, 2), 'settings-export')
            }}
          >
            {copied === 'settings-export' ? <Check size={13} /> : <Download size={13} />}
            {t('settings.exportSettings')}
          </Button>
          <Button
            size="sm"
            variant={confirmReset ? 'danger' : 'ghost'}
            onClick={resetSettings}
          >
            <RotateCcw size={13} />
            {confirmReset ? t('settings.resetConfirm') : t('settings.resetSettings')}
          </Button>
        </div>
        <p className="text-[10px] leading-relaxed text-mute">{t('settings.exportHint')}</p>
        <div className="space-y-1.5">
          <p className="hud-label">{t('settings.importSettings')}</p>
          <textarea
            className={cn(INPUT_CLASS, 'no-drag min-h-24 w-full resize-y font-mono text-[11px]')}
            value={importText}
            placeholder={t('settings.importPlaceholder')}
            onChange={(event) => setImportText(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={importText.trim().length === 0} onClick={() => void applyImport()}>
              <Upload size={13} />
              {t('settings.importApply')}
            </Button>
            {importError ? <span className="text-[10px] text-danger">{importError}</span> : null}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon={HardDrive} title={t('settings.cacheTitle')} hint={t('settings.cacheHint')}>
        <Button size="sm" variant={confirmClear ? 'danger' : 'ghost'} onClick={clearCache}>
          <Trash2 size={13} />
          {confirmClear ? t('settings.clearConfirm') : t('settings.clearCache')}
        </Button>
      </SettingsSection>

      <SettingsSection
        icon={FolderOpen}
        title={t('settings.data.title')}
        hint={t('settings.foldersHint')}
      >
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => void call(IPC_CHANNELS.importOpenDraftFolder).catch(() => undefined)}>
            <FolderOpen size={13} />
            {t('settings.data.imports')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void call(IPC_CHANNELS.logOpenFolder).catch(() => undefined)}>
            <FolderOpen size={13} />
            {t('settings.data.logs')}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        icon={RefreshCw}
        title={t('settings.diagnostics')}
        hint={t('settings.diagnosticsHint')}
        action={
          <Button size="sm" variant="ghost" onClick={() => copyText(diagnostics(), 'diagnostics')}>
            {copied === 'diagnostics' ? <Check size={13} /> : <Copy size={13} />}
            {t('settings.copyDiagnostics')}
          </Button>
        }
      >
        <p className="font-mono text-[10px] leading-relaxed text-mute">
          {`v${metaQuery.data?.version ?? '—'} · ${metaQuery.data?.platform ?? '—'} · ${status?.backend ?? '—'}`}
        </p>
      </SettingsSection>
    </>
  )

  const renderAbout = (): ReactNode => (
    <>
      <SettingsSection
        icon={HardDrive}
        title={t('settings.systemTitle')}
        hint={t('settings.systemHint')}
        action={
          <Button size="sm" variant="ghost" onClick={() => copyText(diagnostics(), 'diagnostics')}>
            {copied === 'diagnostics' ? <Check size={13} /> : <Copy size={13} />}
            {t('settings.copyDiagnostics')}
          </Button>
        }
      >
        <dl className="grid gap-x-4 gap-y-2 text-[11px] sm:grid-cols-2">
          {[
            [t('settings.systemVersion'), `${metaQuery.data?.version ?? '—'} · Electron ${metaQuery.data?.electron ?? '—'}`],
            [t('settings.systemPlatform'), metaQuery.data?.platform ?? '—'],
            [t('settings.systemPolicy'), metaQuery.data?.policyVersion ?? '—'],
            [t('settings.systemHotkeys'), status ? `${status.backend} · ${status.running ? t('settings.running') : t('settings.stopped')}` : '—'],
            [t('settings.systemOverlay'), overlayVisible ? t('settings.systemOverlayOn') : t('settings.systemOverlayOff')],
            [t('settings.systemMotion'), `${motion.tier} · ${motion.averageFps === null ? '—' : `${String(Math.round(motion.averageFps))} fps`}`],
            [t('settings.systemTheme'), t(themeSkin(walletQuery.data?.theme).moodKey)],
            [t('settings.systemAccount'), signedIn ? identity.display : t('settings.systemSignedOut')]
          ].map(([label, value]) => (
            <div key={label} className="flex min-w-0 items-baseline justify-between gap-2 border-b border-line/40 pb-1">
              <dt className="shrink-0 text-mute">{label}</dt>
              <dd className="min-w-0 break-words text-right text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line/60 bg-base/35 px-2.5 py-2">
          <HardDrive size={12} className="shrink-0 text-mute" />
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-mute" title={metaQuery.data?.userDataPath}>
            {metaQuery.data?.userDataPath ?? '—'}
          </span>
          <Button
            size="sm"
            variant="subtle"
            disabled={!metaQuery.data?.userDataPath}
            onClick={() => metaQuery.data?.userDataPath && copyText(metaQuery.data.userDataPath, 'data-path')}
          >
            {copied === 'data-path' ? <Check size={12} /> : <Copy size={12} />}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection icon={UserRound} title={t('settings.accountTitle')} hint={t('settings.accountHint')}>
        {signedIn ? (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5">
              <Avatar className="size-10 border border-line">
                {identity.avatarUrl ? <AvatarImage src={identity.avatarUrl} alt="" /> : null}
                <AvatarFallback className="bg-brand/15 text-xs font-semibold text-brand">{identity.initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="break-words text-[13px] font-medium text-ink">{identity.display}</p>
                <p className="break-words text-[10px] text-mute">{identity.email ?? identity.handle ?? ''}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                <Chip tone="neutral">{identity.provider ?? 'email'}</Chip>
                {walletQuery.data?.vip ? <Chip tone="warn">{t('profile.vip')}</Chip> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => navigate('/profile')}>
                <UserRound size={13} />
                {t('settings.openProfile')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate('/wallet')}>
                <Wallet size={13} />
                {t('settings.openWallet')}
              </Button>
              {walletQuery.data ? <Chip tone="neutral"><CoinAmount value={walletQuery.data.balance} size="sm" /></Chip> : null}
              <Button
                size="sm"
                variant="subtle"
                busy={authBusy}
                onClick={() => void signOut().then(() => navigate('/account')).catch(() => undefined)}
              >
                <LogOut size={13} />
                {t('settings.signOut')}
              </Button>
            </div>
            <p className="text-[10px] text-mute">{t('settings.signOutHint')}</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] text-mute">{t('settings.signedOut')}</p>
            <Button size="sm" variant="primary" onClick={() => navigate('/account')}>
              {t('settings.signIn')}
            </Button>
          </div>
        )}
      </SettingsSection>

      <UpdateSection />

      <SettingsSection icon={Info} title={t('settings.aboutLinks')} hint={t('settings.aboutLinksHint')}>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate('/about')}>
            <Info size={13} />
            {t('settings.openAbout')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('/legal')}>
            <ShieldCheck size={13} />
            {t('settings.openLegal')}
          </Button>
        </div>
      </SettingsSection>
    </>
  )

  const renderContent = (): ReactNode => {
    if (query.trim().length > 0) return renderSearch()
    if (hub.settings.isError) {
      return (
        <StateError
          detail={hub.settings.error.message}
          onRetry={() => void hub.settings.refetch()}
          busy={hub.settings.isFetching}
        />
      )
    }
    if (!settings) {
      return (
        <section className="hud-panel p-4">
          <StateLoading count={5} />
        </section>
      )
    }
    switch (tab) {
      case 'appearance':
        return renderAppearance()
      case 'overlay':
        return renderOverlay()
      case 'hotkeys':
        return renderHotkeys()
      case 'privacy':
        return renderPrivacy()
      case 'about':
        return renderAbout()
      default:
        return renderGeneral()
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
        badges={
          <>
            {saveState}
            {metaQuery.data ? <Chip tone="neutral">{`v${metaQuery.data.version}`}</Chip> : null}
            {walletQuery.data?.vip ? <Chip tone="warn" icon={Sparkles}>{t('profile.vip')}</Chip> : null}
          </>
        }
        actions={
          <Button
            size="sm"
            variant="ghost"
            disabled={!metaQuery.data}
            onClick={() => copyText(diagnostics(), 'diagnostics')}
          >
            {copied === 'diagnostics' ? <Check size={13} /> : <Copy size={13} />}
            <span className="hidden sm:inline">{t('settings.copyDiagnostics')}</span>
          </Button>
        }
      />

      <div className="hud-panel flex items-center gap-2 p-2.5">
        <div className="relative min-w-0 flex-1">
          <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-mute" />
          <input
            ref={searchRef}
            className={cn(INPUT_CLASS, 'no-drag h-8 pl-8 pr-8 text-xs')}
            value={query}
            placeholder={t('settings.searchPlaceholder')}
            aria-label={t('settings.searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-line bg-panel-soft px-1 text-[9px] text-mute">/</kbd>
        </div>
        {query.length > 0 ? (
          <Button size="sm" variant="subtle" onClick={() => setQuery('')}>
            <Trash2 size={12} />
            {t('settings.clearSearch')}
          </Button>
        ) : null}
      </div>

      {failure ? (
        <Banner tone="danger" title={t('common.errorTitle')}>
          <span className="break-words">{failure}</span>
        </Banner>
      ) : null}
      {notice ? <Banner tone="good">{t(notice)}</Banner> : null}

      <div className="grid gap-4 lg:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-2 lg:sticky lg:top-2 lg:self-start">
          <nav className="hud-panel flex gap-1 overflow-x-auto p-1.5 lg:flex-col">
            {TABS.map((entry) => {
              const Icon = entry.icon
              const active = tab === entry.id && query.trim().length === 0
              return (
                <button
                  key={entry.id}
                  type="button"
                  data-press
                  onClick={() => {
                    setTab(entry.id)
                    setQuery('')
                  }}
                  className={cn(
                    'no-drag flex min-w-max items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors lg:w-full',
                    active
                      ? 'bg-brand/15 text-ink ring-1 ring-inset ring-brand/30'
                      : 'text-mute hover:bg-panel-soft hover:text-ink'
                  )}
                >
                  <Icon size={14} className={active ? 'text-brand' : undefined} />
                  <span className="min-w-0 flex-1">{t(entry.labelKey)}</span>
                  {active ? <ChevronRight size={12} className="hidden shrink-0 text-brand lg:block" /> : null}
                </button>
              )
            })}
          </nav>

          <section className="hud-panel hidden p-3 lg:block">
            <p className="hud-label">{t('settings.quickStatus')}</p>
            <div className="mt-2 space-y-1.5 text-[10px]">
              <div className="flex justify-between gap-2">
                <span className="text-mute">{t('settings.systemVersion')}</span>
                <span className="hud-num text-ink">{metaQuery.data?.version ?? '—'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-mute">{t('settings.systemHotkeys')}</span>
                <span className="text-ink">{status?.backend ?? '—'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-mute">{t('settings.systemOverlay')}</span>
                <span className={overlayVisible ? 'text-good' : 'text-mute'}>
                  {overlayVisible ? t('settings.systemOverlayOn') : t('settings.systemOverlayOff')}
                </span>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (!status) return
                  pause.mutate(!(status.paused ?? false))
                }}
                disabled={!status}
              >
                {status?.paused ? <Play size={12} /> : <Pause size={12} />}
                {status?.paused ? t('settings.pause.on') : t('settings.pause.off')}
              </Button>
              <Button size="sm" variant="subtle" busy={hub.settings.isFetching} onClick={hub.refresh}>
                <RefreshCw size={12} />
              </Button>
            </div>
          </section>

          {hub.settings.isError ? (
            <button
              type="button"
              className="no-drag flex w-full items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-left text-[11px] text-danger"
              onClick={() => void hub.settings.refetch()}
            >
              <TriangleAlert size={13} />
              {t('common.retry')}
            </button>
          ) : null}
        </aside>

        <div className="min-w-0 space-y-3">{renderContent()}</div>
      </div>
    </div>
  )
}
