import { BrowserWindow } from 'electron'

export interface IpcSender {
  send: (channel: string, payload: unknown) => void
  sendTo: (window: BrowserWindow | null, channel: string, payload: unknown) => void
}

export const ipcSender: IpcSender = {
  send(channel, payload) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue
      window.webContents.send(channel, payload)
    }
  },
  sendTo(window, channel, payload) {
    if (!window || window.isDestroyed()) return
    window.webContents.send(channel, payload)
  }
}
