import { contextBridge, ipcRenderer } from 'electron'
import type { IpcResult } from './bridge-channels'

// Sandboxed preloads cannot require sibling chunks, so this file must stay self-contained:
// channel names are literals here, mirrored from @tds/shared by scripts/check-channels.mjs.
const INVOCABLE = new Set<string>([
  'app:getMeta',
  'app:openExternal',
  'display:list',
  'app:quit',
  'app:minimizeToTray',
  'window:minimize',
  'window:toggleMaximize',
  'window:close',
  'window:getMaximized',
  'overlay:show',
  'overlay:hide',
  'overlay:toggle',
  'overlay:setGeometry',
  'overlay:setInteractive',
  'hotkeys:getBindings',
  'hotkeys:setBinding',
  'hotkeys:clear',
  'hotkeys:getStatus',
  'hotkeys:pause',
  'settings:get',
  'settings:set',
  'strategy:load',
  'strategy:unload',
  'strategy:step',
  'strategy:jump',
  'session:flushNow',
  'session:outboxStatus',
  'import:submitLink',
  'import:submitPaste',
  'import:pickFiles',
  'import:extractImage',
  'import:openDraftFolder',
  'auth:getSession',
  'auth:signIn',
  'auth:signUp',
  'auth:signOut',
  'auth:oauthStart',
  'auth:oauthCallback',
  'update:check',
  'update:apply',
  'log:openFolder'
])

const SUBSCRIBABLE = new Set<string>([
  'overlay:stateChanged',
  'overlay:css',
  'app:deepLink',
  'hotkeys:event',
  'hotkeys:degraded',
  'hotkeys:bindingsChanged',
  'hotkeys:statusChanged',
  'settings:changed',
  'import:progress',
  'import:result',
  'update:status',
  'auth:tokenChanged',
  'window:maximizedChanged'
])

const api = {
  invoke<T = unknown>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
    if (!INVOCABLE.has(channel)) {
      return Promise.resolve({ ok: false, error: `ipc invoke blocked: ${channel}`, code: 'blocked-channel' })
    }
    return ipcRenderer.invoke(channel, payload) as Promise<IpcResult<T>>
  },
  on(channel: string, listener: (payload: unknown) => void): () => void {
    if (!SUBSCRIBABLE.has(channel)) return () => undefined
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('tds', api)

export type TdsBridge = typeof api
