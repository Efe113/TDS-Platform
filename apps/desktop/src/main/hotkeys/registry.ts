import { IPC_CHANNELS, type HotkeyAction, type HotkeyBindings, type HotkeyStatus } from '@tds/shared'
import type { IpcSender } from '../ipc/sender'
import { createKoffiLowLevelKeyboardHook, type LowLevelKeyboardHook, type ObservedKeyEvent } from './backends/koffi-ll-hook'
import { decodeKeyRecord } from './vk-to-code'
import { logger } from '../log'
import { overlaySession } from '../overlay/session'
import { settingsStore } from '../settings/store'

export interface HotkeyRegistryDeps {
  sender: IpcSender
  isAppWindowFocused: () => boolean
}

const ACTION_BY_CODE = (bindings: HotkeyBindings): Map<string, HotkeyAction> => {
  const map = new Map<string, HotkeyAction>()
  for (const action of ['next', 'prev', 'reset'] as HotkeyAction[]) {
    const code = bindings[action]
    if (code) map.set(code, action)
  }
  return map
}

export class HotkeyRegistry {
  private hook: LowLevelKeyboardHook | null = null
  private lookup = new Map<string, HotkeyAction>()
  private degraded = false
  private paused = false
  private disabledByRemoteFlag = false
  private backend: HotkeyStatus['backend'] = 'tray-only'
  private readonly deps: HotkeyRegistryDeps

  constructor(deps: HotkeyRegistryDeps) {
    this.deps = deps
    this.rebuildLookup()
    settingsStore.onChange(() => {
      this.rebuildLookup()
      this.deps.sender.send(IPC_CHANNELS.hotkeysBindingsChanged, this.bindings)
      this.publishStatus()
    })
  }

  get bindings(): HotkeyBindings {
    return settingsStore.hotkeys
  }

  start(): HotkeyStatus {
    if (this.hook?.running) return this.status()

    try {
      this.hook = createKoffiLowLevelKeyboardHook({
        onKey: (event) => this.handleKey(event),
        onError: (stage, error) => logger.error(`hotkey ${stage} failed`, error),
        decode: (vkCode, scanCode, flags) => decodeKeyRecord(vkCode, scanCode, flags)
      })
      this.hook.start()
      this.backend = 'koffi-ll-hook'
      this.degraded = false
      logger.info('global key hook started (observe-only)')
    } catch (error) {
      this.hook = null
      this.backend = 'tray-only'
      this.degraded = true
      logger.error('global key hook failed to start, falling back to in-app controls', error)
      this.deps.sender.send(IPC_CHANNELS.hotkeysDegraded, {
        messageKey: 'settings.degraded.body'
      })
    }

    this.publishStatus()
    return this.status()
  }

  stop(): void {
    this.hook?.stop()
    this.hook = null
    this.publishStatus()
  }

  setBinding(action: HotkeyAction, code: string | null): HotkeyStatus {
    settingsStore.setHotkey(action, code)
    this.rebuildLookup()
    return this.status()
  }

  setPaused(paused: boolean): HotkeyStatus {
    this.paused = paused
    this.publishStatus()
    return this.status()
  }

  setDisabledByRemoteFlag(disabled: boolean): HotkeyStatus {
    this.disabledByRemoteFlag = disabled
    if (disabled) this.hook?.stop()
    else this.hook?.start()
    this.publishStatus()
    return this.status()
  }

  status(): HotkeyStatus {
    return {
      backend: this.backend,
      running: Boolean(this.hook?.running),
      degraded: this.degraded,
      paused: this.paused || this.disabledByRemoteFlag,
      disabledByRemoteFlag: this.disabledByRemoteFlag
    }
  }

  /** Dispatched from tray/menu/in-app buttons as well, so the fallback path shares the logic. */
  dispatch(action: HotkeyAction): void {
    if (action === 'next') overlaySession.next()
    if (action === 'prev') overlaySession.previous()
    if (action === 'reset') overlaySession.reset()
  }

  private handleKey(event: ObservedKeyEvent): void {
    if (event.isInjected || event.kind !== 'down') return
    if (this.paused || this.disabledByRemoteFlag) return
    if (this.deps.isAppWindowFocused()) return

    const action = this.lookup.get(event.code)
    if (!action) return

    this.dispatch(action)
    this.deps.sender.send(IPC_CHANNELS.hotkeysEvent, { action, code: event.code, at: Date.now() })
  }

  private rebuildLookup(): void {
    this.lookup = ACTION_BY_CODE(settingsStore.hotkeys)
  }

  private publishStatus(): void {
    this.deps.sender.send(IPC_CHANNELS.hotkeysStatusChanged, this.status())
  }
}
