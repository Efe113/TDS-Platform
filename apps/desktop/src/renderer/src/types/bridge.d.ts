import type { HotkeyAction, IpcResult, OverlayState } from '@tds/shared'

export interface TdsBridge {
  invoke<T>(channel: string, payload?: unknown): Promise<IpcResult<T>>
  on(channel: string, listener: (payload: unknown) => void): () => void
  platform: string
}

export interface OverlayCssPayload {
  css: { left: string; right: string; top: string; bottom: string; transform?: string }
  width: number
  height: number
  opacity: number
  /** Free prefs plus the paid cosmetics, resolved by main so the overlay never reads settings itself. */
  fontScale: number
  upcomingCount: number
  cardStyle: 'classic' | 'glow' | 'scan'
  showCounter: boolean
  themeBound: boolean
  themeKey: string | null
}

export interface OverlayBridge {
  onStateChanged(listener: (payload: OverlayState | null) => void): () => void
  onCss(listener: (payload: OverlayCssPayload) => void): () => void
  setInteractive(interactive: boolean): void
  step(action: HotkeyAction): void
  hide(): void
}

declare global {
  interface Window {
    /** Preload bridge of the main window (see src/preload/main.ts). */
    tds: TdsBridge
    /** Preload bridge of the always-on-top overlay window (see src/preload/overlay.ts). */
    overlay: OverlayBridge
  }
}
