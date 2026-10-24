import { Menu, Tray, app, nativeImage } from 'electron'
import { join } from 'node:path'
import { logger } from './log'

const PLACEHOLDER_TRAY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export interface TrayActions {
  toggleOverlay: () => void
  step: (action: 'next' | 'prev' | 'reset') => void
  pauseHotkeys: (paused: boolean) => void
  isHotkeysPaused: () => boolean
  openMainWindow: () => void
}

function trayImage(): Electron.NativeImage {
  if (app.isPackaged) {
    const fromResources = nativeImage.createFromPath(join(process.resourcesPath, 'build', 'trayIcon.png'))
    if (!fromResources.isEmpty()) return fromResources
  }
  const fromBuild = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'trayIcon.png'))
  if (!fromBuild.isEmpty()) return fromBuild
  return nativeImage.createFromDataURL(`data:image/png;base64,${PLACEHOLDER_TRAY_PNG}`)
}

export function createTray(actions: TrayActions): Tray {
  const tray = new Tray(trayImage())
  tray.setToolTip('TDS Companion')

  const buildMenu = (): Menu =>
    Menu.buildFromTemplate([
      { label: 'Overlay göster/gizle', click: () => actions.toggleOverlay() },
      { type: 'separator' },
      { label: 'Sonraki adım', click: () => actions.step('next') },
      { label: 'Önceki adım', click: () => actions.step('prev') },
      { label: 'Başa sar', click: () => actions.step('reset') },
      { type: 'separator' },
      {
        label: 'Tuşları duraklat',
        type: 'checkbox',
        checked: actions.isHotkeysPaused(),
        click: (item) => actions.pauseHotkeys(item.checked)
      },
      { type: 'separator' },
      {
        label: 'Pencereyi aç',
        click: () => actions.openMainWindow()
      },
      { label: 'Çıkış', click: () => app.quit() }
    ])

  tray.setContextMenu(buildMenu())
  tray.on('double-click', () => actions.toggleOverlay())
  logger.info('tray ready')
  return tray
}
