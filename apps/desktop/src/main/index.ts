import { app, BrowserWindow, powerSaveBlocker, screen, Tray } from 'electron'
import { IPC_CHANNELS, routeFromDeepLink, type DeepLink } from '@tds/shared'
import { authManager } from './auth/manager'
import { looksLikeAuthCallback } from './auth/callback'
import { createMainWindow } from './windows/main-window'
import { overlayWindows } from './windows/overlay-window'
import { HotkeyRegistry } from './hotkeys/registry'
import { overlaySession } from './overlay/session'
import { registerIpc } from './ipc/register'
import { ipcSender } from './ipc/sender'
import { settingsStore } from './settings/store'
import { featureFlags } from './flags/store'
import { captureError, captureMessage, initTelemetry, setTelemetryConsent, setTelemetryUser } from './telemetry/sentry'
import { updateService } from './updater/service'
import { usageService } from './usage/service'
import { createTray } from './tray'
import { logger } from './log'

const PROTOCOL = 'tdsapp'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let hotkeys: HotkeyRegistry | null = null
let isQuitting = false
let quitHandled = false
let sleepBlocker: number | null = null

/** Login-at-start is only meaningful for an installed build; dev would register electron.exe. */
function applyLoginItem(): void {
  if (!app.isPackaged) return
  const settings = settingsStore.get()
  app.setLoginItemSettings({
    openAtLogin: settings.launchAtLogin,
    // Windows passes args; macOS has no openAsHidden in this Electron type, so the setting still
    // starts the process and the same hidden flag is the portable half.
    args: settings.startMinimized ? ['--hidden'] : []
  })
}

/** Prevent the screen from sleeping only while the overlay window is actually up and the user opted in. */
function syncSleepBlocker(): void {
  const shouldBlock = settingsStore.get().preventSleep && overlayWindows.isVisible()
  if (shouldBlock && sleepBlocker === null) {
    sleepBlocker = powerSaveBlocker.start('prevent-display-sleep')
  } else if (!shouldBlock && sleepBlocker !== null) {
    powerSaveBlocker.stop(sleepBlocker)
    sleepBlocker = null
  }
}

/**
 * Closing the main window is not quitting unless the user asked for it - the overlay and the tray keep
 * running - so the window can legitimately be gone by the time the tray or a second instance asks for
 * it, and this is the single place that brings it back.
 */
function ensureMainWindow(initial = false): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  const startHidden = initial && (process.argv.includes('--hidden') || settingsStore.get().startMinimized)
  mainWindow = createMainWindow({ showOnLoad: !startHidden })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.on('close', () => {
    if (isQuitting || settingsStore.get().closeToTray) return
    isQuitting = true
    app.quit()
  })
  return mainWindow
}

function showMainWindow(): void {
  const frame = ensureMainWindow()
  if (!frame.isVisible()) frame.show()
  frame.focus()
}

// Registered during init, and Electron only allows the SDK's privileged IPC scheme before the app is
// ready - so this runs at module scope, not inside bootstrap(). settingsStore.get() reads the stored
// opt-in lazily, which is what decides whether the native crash handler is registered at all.
initTelemetry(settingsStore.get().telemetryOptIn)

function handleDeepLink(link: string): void {
  if (looksLikeAuthCallback(link)) {
    void authManager
      .handleCallback(link)
      .then((outcome) => logger.info(outcome.ok ? 'auth callback ok' : `auth callback failed: ${outcome.error}`))
      .catch((error) => logger.error('auth callback threw', error))
    return
  }
  // Anything else routable becomes a renderer navigation. `routeFromDeepLink` is the allow list:
  // an unknown host or a non-uuid id returns null instead of reaching the router.
  const route = routeFromDeepLink(link)
  if (route !== null) {
    ipcSender.send(IPC_CHANNELS.appDeepLink, { route } satisfies DeepLink)
    return
  }
  logger.info(`deep link ignored: ${link.split('?')[0]}`)
}

function bootstrap(): void {
  settingsStore.load()
  applyLoginItem()

  if (process.defaultApp) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [app.getAppPath()])
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL)
  }

  hotkeys = new HotkeyRegistry({
    sender: ipcSender,
    isAppWindowFocused: () => mainWindow?.isFocused() === true
  })

  authManager.init({
    broadcast: (payload) => {
      // Id only, and cleared on sign-out; the payload also carries a handle and display name.
      setTelemetryUser(payload.summary.userId)
      ipcSender.send(IPC_CHANNELS.authTokenChanged, payload)
    }
  })

  registerIpc({
    overlay: overlayWindows,
    hotkeys,
    getMainWindow: () => mainWindow,
    auth: authManager
  })

  overlaySession.onChange((state) => {
    overlayWindows.pushState(state)
    syncSleepBlocker()
  })
  settingsStore.onChange((settings) => {
    ipcSender.send(IPC_CHANNELS.settingsChanged, settings)
    // The opt-in already exists in Settings and in the contract; this is the half that was missing -
    // main deciding whether anything may leave the machine.
    setTelemetryConsent(settings.telemetryOptIn)
    if (settings.telemetryOptIn) setTelemetryUser(authManager.current().summary.userId)
    applyLoginItem()
    syncSleepBlocker()
  })

  setTelemetryConsent(settingsStore.get().telemetryOptIn)

  ensureMainWindow(true)

  overlayWindows.init()
  overlayWindows.onVisibilityChange(syncSleepBlocker)
  overlayWindows.pushState(overlaySession.state())
  syncSleepBlocker()

  const status = hotkeys.start()
  logger.info(`hotkey backend: ${status.backend} running=${String(status.running)}`)

  // The admin panel's hotkeys_enabled flag has to reach the process that owns the hook.
  featureFlags.init({ db: () => authManager.db })
  featureFlags.onChange((hotkeysEnabled) => hotkeys?.setDisabledByRemoteFlag(!hotkeysEnabled))

  usageService.init({
    db: () => authManager.db,
    signedIn: () => authManager.current().summary.userId !== null,
    drainEvents: () => overlaySession.drainEvents(),
    trackingEnabled: () => settingsStore.get().usageTracking,
    meta: () => {
      const window = overlayWindows.currentWindow
      return {
        appVersion: app.getVersion(),
        hookBackend: hotkeys?.status().backend ?? null,
        displayId: window ? String(screen.getDisplayMatching(window.getBounds()).id) : null
      }
    }
  })

  tray = createTray({
    toggleOverlay: () => overlayWindows.toggle(),
    step: (action) => hotkeys?.dispatch(action),
    pauseHotkeys: (paused) => hotkeys?.setPaused(paused),
    isHotkeysPaused: () => hotkeys?.status().paused === true,
    openMainWindow: () => showMainWindow()
  })

  updateService.init(ipcSender)

  if (settingsStore.get().autoStartOverlay || process.env['TDS_AUTO_SHOW_OVERLAY'] === '1') {
    overlayWindows.show()
    syncSleepBlocker()
  }

  app.on('activate', () => showMainWindow())
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const link = argv.find((argument) => argument.startsWith(`${PROTOCOL}://`))
    if (link) handleDeepLink(link)
    showMainWindow()
  })

  app.on('open-url', (event, link) => {
    event.preventDefault()
    handleDeepLink(link)
  })

  void app.whenReady().then(bootstrap)

  // Closing the main window keeps the overlay + tray alive; only an explicit quit stops them.
  app.on('window-all-closed', () => {
    if (!isQuitting && process.platform !== 'darwin') return
    app.quit()
  })

  app.on('before-quit', (event) => {
    if (quitHandled) return
    quitHandled = true
    isQuitting = true
    if (sleepBlocker !== null) {
      powerSaveBlocker.stop(sleepBlocker)
      sleepBlocker = null
    }
    // Stop listening first: a flush racing with new key presses would under-report.
    hotkeys?.stop()
    featureFlags.stop()
    usageService.stop()

    if (usageService.status().pending > 0) {
      // One capped attempt, then leave: pending events also survive in the outbox for next start.
      event.preventDefault()
      void usageService
        .flushForQuit()
        .catch((error) => logger.warn('final usage flush threw', error))
        .finally(() => {
          authManager.dispose()
          tray?.destroy()
          tray = null
          app.exit(0)
        })
      return
    }

    authManager.dispose()
    tray?.destroy()
    tray = null
  })

  app.on('child-process-gone', (_event, details) => {
    logger.error('renderer process gone', details)
    // A dead renderer is a crash the user felt but never saw an error for.
    captureMessage('child-process-gone', `${details.reason} (${details.type}) exit=${String(details.exitCode)}`)
  })

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', reason)
    captureError('unhandledRejection', reason)
  })
  process.on('uncaughtException', (error) => {
    logger.error('uncaughtException', error)
    captureError('uncaughtException', error)
  })
}
