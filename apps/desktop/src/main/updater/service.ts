import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC_CHANNELS, type UpdateStatus } from '@tds/shared'
import type { IpcSender } from '../ipc/sender'
import { logger } from '../log'

/**
 * GitHub Releases is the feed (electron-builder writes app-update.yml from its `publish` block at
 * build time). Nothing here works from a dev or `--dir` build: there is no installed app to replace
 * and no app-update.yml to read, so the honest answer is the `unsupported` state rather than a fake
 * "up to date".
 *
 * Downloading starts on its own once an update is found, because the interesting moment for the user
 * is the restart, not the download. installUpdate() installs when the file is already there and
 * otherwise re-triggers the check, so the button never sits dead on a slow connection.
 */

const STARTUP_CHECK_DELAY_MS = 15_000

export class UpdateService {
  private sender: IpcSender | null = null
  private current: UpdateStatus = {
    state: 'idle',
    currentVersion: '0.0.0',
    availableVersion: null,
    progressPercent: null,
    detail: null,
    checkedAt: null
  }

  get status(): UpdateStatus {
    return this.current
  }

  init(sender: IpcSender): void {
    this.sender = sender
    this.publish({ ...this.current, currentVersion: app.getVersion() })

    if (!app.isPackaged) {
      this.publish({ ...this.current, state: 'unsupported', detail: 'not packaged' })
      logger.info('updater unavailable in an unpackaged build')
      return
    }

    autoUpdater.logger = logger
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => this.publish({ ...this.current, state: 'checking' }))

    autoUpdater.on('update-available', (info) =>
      this.publish({ ...this.current, state: 'downloading', availableVersion: info.version, progressPercent: 0 })
    )

    autoUpdater.on('update-not-available', () => this.publish({ ...this.current, state: 'idle', checkedAt: Date.now() }))

    autoUpdater.on('download-progress', (info) =>
      this.publish({ ...this.current, state: 'downloading', progressPercent: Math.round(info.percent) })
    )

    autoUpdater.on('update-downloaded', (info) =>
      this.publish({
        ...this.current,
        state: 'downloaded',
        availableVersion: info.version,
        progressPercent: 100,
        checkedAt: Date.now()
      })
    )

    // A failed feed lookup reports itself as a state, never as a crash.
    autoUpdater.on('error', (error, message) => {
      logger.warn(`updater error: ${message ?? error.message}`)
      this.publish({ ...this.current, state: 'error', detail: message ?? error.message, checkedAt: Date.now() })
    })

    setTimeout(() => void this.check(), STARTUP_CHECK_DELAY_MS).unref?.()
  }

  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) return this.current
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.publish({ ...this.current, state: 'error', detail, checkedAt: Date.now() })
    }
    return this.current
  }

  /** False means "not ready yet, still fetching" - the UI keeps the progress line instead of lying. */
  installUpdate(): boolean {
    if (!app.isPackaged) return false
    if (this.current.state !== 'downloaded') {
      void this.check()
      return false
    }
    // quitAndInstall closes the windows first and only then emits before-quit, which is where the
    // usage outbox gets its final flush - so the restart path keeps the counting guarantee.
    autoUpdater.quitAndInstall(false, true)
    return true
  }

  private publish(status: UpdateStatus): void {
    this.current = status
    this.sender?.send(IPC_CHANNELS.updateStatus, status)
  }
}

export const updateService = new UpdateService()
