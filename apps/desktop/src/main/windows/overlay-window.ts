import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS, type OverlayGeometry, type OverlayState } from '@tds/shared'
import { logger } from '../log'
import { ipcSender } from '../ipc/sender'
import { resolveCardCss, resolveWindowBounds } from '../overlay/geometry'
import { settingsStore } from '../settings/store'

const DEV_URL = process.env['ELECTRON_RENDERER_URL']

export interface OverlayWindowEvents {
  onReady: (window: BrowserWindow) => void
}

export class OverlayWindowManager {
  private window: BrowserWindow | null = null
  private lastState: OverlayState | null = null
  private interactive = false
  private readonly visibilityListeners = new Set<(visible: boolean) => void>()

  constructor(private readonly events: OverlayWindowEvents = { onReady: () => undefined }) {
    // The overlay editor writes through settings:set, while the geometry panel uses its own channel.
    // Listening here makes both paths update the live window instead of only the next run.
    settingsStore.onChange(() => this.reposition())
  }

  get isCreated(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  get currentWindow(): BrowserWindow | null {
    return this.isCreated ? this.window : null
  }

  create(): BrowserWindow {
    if (this.isCreated) return this.window as BrowserWindow

    const geometry = settingsStore.overlay
    const display = this.resolveDisplay(geometry)
    const bounds = resolveWindowBounds(display)

    const window = new BrowserWindow({
      ...bounds,
      show: false,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      focusable: false,
      roundedCorners: false,
      backgroundColor: '#00000000',
      paintWhenInitiallyHidden: true,
      webPreferences: {
        preload: join(__dirname, '../preload/overlay.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        devTools: !process.env['VITEST']
      }
    })

    this.window = window

    window.setAlwaysOnTop(true, 'screen-saver', 1)
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.setMenu(null)

    // Observe-only by default: clicks fall through to the game, mouse-move is still forwarded
    // to the page so the card can opt into interactivity when the pointer hovers it.
    window.setIgnoreMouseEvents(true, { forward: true })

    window.webContents.on('did-finish-load', () => {
      window.webContents.setZoomFactor(geometry.zoomFactor)
      this.pushCss(window, geometry)
      if (this.lastState) this.pushState(this.lastState)
      this.events.onReady(window)
    })

    window.on('closed', () => {
      this.window = null
      this.interactive = false
      this.notifyVisibility(false)
    })

    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url).catch((error) => logger.warn('overlay openExternal failed', error))
      return { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('context-menu', (event) => event.preventDefault())

    if (DEV_URL) void window.loadURL(`${DEV_URL}/overlay.html`)
    else void window.loadFile(join(__dirname, '../renderer/overlay.html'))

    return window
  }

  private watchDisplays(): void {
    const reposition = () => this.reposition()
    screen.on('display-metrics-changed', reposition)
    screen.on('display-added', reposition)
    screen.on('display-removed', reposition)
  }

  private resolveDisplay(geometry: OverlayGeometry) {
    const displays = screen.getAllDisplays()
    return displays.find((display) => display.id === geometry.displayId) ?? screen.getPrimaryDisplay()
  }

  private pushCss(window: BrowserWindow, geometry: OverlayGeometry): void {
    window.webContents.send(IPC_CHANNELS.overlayCss, {
      css: resolveCardCss(geometry),
      width: geometry.width,
      height: geometry.height,
      opacity: geometry.opacity,
      fontScale: geometry.fontScale,
      upcomingCount: geometry.upcomingCount,
      cardStyle: geometry.cardStyle,
      showCounter: geometry.showCounter,
      themeBound: geometry.themeBound,
      themeKey: settingsStore.get().overlayThemeKey
    })
  }

  reposition(): void {
    if (!this.isCreated) return
    const geometry = settingsStore.overlay
    const display = this.resolveDisplay(geometry)
    const bounds = resolveWindowBounds(display)
    const window = this.window as BrowserWindow
    window.setBounds(bounds)
    window.setAlwaysOnTop(true, 'screen-saver', 1)
    window.webContents.setZoomFactor(geometry.zoomFactor)
    this.pushCss(window, geometry)
  }

  setGeometry(geometry: Partial<OverlayGeometry>): void {
    // The store emits synchronously, so the constructor listener repositions the live window.
    settingsStore.setOverlay(geometry)
  }

  setVisible(visible: boolean): void {
    if (!visible) {
      this.hide()
      return
    }
    const window = this.create()
    if (window.isVisible()) return
    // showInactive never takes keyboard focus away from the game window.
    window.showInactive()
    window.setAlwaysOnTop(true, 'screen-saver', 1)
    this.pushState(this.lastState ?? this.emptyState())
    this.notifyVisibility(true)
  }

  show(): void {
    this.setVisible(true)
  }

  hide(): void {
    if (!this.isCreated) return
    this.setInteractive(false)
    this.window?.hide()
    this.pushState(this.lastState)
    this.notifyVisibility(false)
  }

  toggle(): void {
    if (this.isCreated && this.window?.isVisible()) this.hide()
    else this.show()
  }

  isVisible(): boolean {
    return this.isCreated === true && (this.window?.isVisible() ?? false)
  }

  setInteractive(interactive: boolean): void {
    if (!this.isCreated) return
    this.interactive = interactive
    if (interactive) this.window?.setIgnoreMouseEvents(false)
    else this.window?.setIgnoreMouseEvents(true, { forward: true })
  }

  get isInteractive(): boolean {
    return this.interactive
  }

  pushState(state: OverlayState | null): void {
    this.lastState = state ? { ...state, visible: this.isVisible() } : null
    // Every window needs the truth: the shell shows whether the overlay is actually up.
    ipcSender.send(IPC_CHANNELS.overlayStateChanged, this.lastState)
  }

  getState(): OverlayState | null {
    return this.lastState
  }

  private emptyState(): OverlayState {
    return {
      strategyId: '',
      strategyName: '',
      isEventStrategy: false,
      modifierNotes: [],
      stepIndex: 0,
      current: null,
      upcoming: [],
      sessionId: null,
      sessionStartedAt: null,
      stepsAdvanced: 0,
      maxStep: 0,
      source: 'live',
      savedAt: null,
      totalSteps: 0,
      visible: true
    }
  }

  onVisibilityChange(listener: (visible: boolean) => void): () => void {
    this.visibilityListeners.add(listener)
    return () => this.visibilityListeners.delete(listener)
  }

  private notifyVisibility(visible: boolean): void {
    for (const listener of this.visibilityListeners) listener(visible)
  }

  init(): void {
    this.watchDisplays()
    this.create()
  }
}

export const overlayWindows = new OverlayWindowManager()
