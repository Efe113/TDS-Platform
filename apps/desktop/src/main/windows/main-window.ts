import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '@tds/shared'
import { ipcSender } from '../ipc/sender'
import { logger } from '../log'

const DEV_URL = process.env['ELECTRON_RENDERER_URL']

export interface MainWindowOptions {
  width?: number
  height?: number
  showOnLoad?: boolean
}

export function createMainWindow(options: MainWindowOptions = {}): BrowserWindow {
  const window = new BrowserWindow({
    width: options.width ?? 1240,
    height: options.height ?? 800,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b0e14',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/main.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  window.once('ready-to-show', () => {
    if (options.showOnLoad !== false) window.show()
  })

  // Our own caption buttons need to know the real state, and the only trustworthy source is main:
  // snapping, Win+Up/Down and the taskbar all change it without the renderer being involved.
  const pushMaximized = (): void => ipcSender.sendTo(window, IPC_CHANNELS.windowMaximizedChanged, { maximized: window.isMaximized() })
  window.on('maximize', pushMaximized)
  window.on('unmaximize', pushMaximized)

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url).catch((error) => logger.warn('main openExternal failed', error))
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (url === window.webContents.getURL()) return
    event.preventDefault()
    if (/^https?:/i.test(url) && DEV_URL === undefined) {
      void shell.openExternal(url).catch((error) => logger.warn('blocked navigation openExternal', error))
    }
  })

  if (DEV_URL) {
    // Electron has no F12 binding, and the title bar is hidden by design, so the console would
    // otherwise be unreachable. Detached keeps the overlay tests unaffected by a docked panel.
    window.once('ready-to-show', () => window.webContents.openDevTools({ mode: 'detach' }))
  }

  if (DEV_URL) void window.loadURL(`${DEV_URL}/index.html`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))

  return window
}
