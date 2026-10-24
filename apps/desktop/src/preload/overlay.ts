import { contextBridge, ipcRenderer } from 'electron'

// Self-contained by design: a sandboxed preload cannot require sibling chunks.
const CHANNEL = {
  stateChanged: 'overlay:stateChanged',
  css: 'overlay:css',
  setInteractive: 'overlay:setInteractive',
  step: 'strategy:step',
  hide: 'overlay:hide'
} as const

const on = (channel: string, listener: (payload: unknown) => void) => {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = {
  onStateChanged: (listener: (payload: unknown) => void) => on(CHANNEL.stateChanged, listener),
  onCss: (listener: (payload: unknown) => void) => on(CHANNEL.css, listener),
  setInteractive(interactive: boolean): void {
    void ipcRenderer.invoke(CHANNEL.setInteractive, { interactive })
  },
  step(action: 'next' | 'prev' | 'reset'): void {
    void ipcRenderer.invoke(CHANNEL.step, { action })
  },
  hide(): void {
    void ipcRenderer.invoke(CHANNEL.hide)
  }
}

contextBridge.exposeInMainWorld('overlay', api)

export type OverlayBridge = typeof api
