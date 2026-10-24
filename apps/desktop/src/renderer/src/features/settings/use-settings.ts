import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IPC_CHANNELS,
  hotkeyBindingsSchema,
  hotkeyStatusSchema,
  type HotkeyBindings,
  type HotkeyStatus,
  type Settings
} from '@tds/shared'
import { call } from '../../lib/ipc'
import { useIpcEvent } from '../../lib/events'

export const SETTINGS_KEY = ['settings'] as const
export const BINDINGS_KEY = ['hotkeys', 'bindings'] as const
export const STATUS_KEY = ['hotkeys', 'status'] as const

export function useSettingsHub() {
  const queryClient = useQueryClient()

  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => call<Settings>(IPC_CHANNELS.settingsGet), retry: false })
  const bindings = useQuery({ queryKey: BINDINGS_KEY, queryFn: () => call<HotkeyBindings>(IPC_CHANNELS.hotkeysGetBindings), retry: false })
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => call<HotkeyStatus>(IPC_CHANNELS.hotkeysGetStatus), retry: false })

  const writeSettings = useCallback(
    (next: Settings) => queryClient.setQueryData<Settings>(SETTINGS_KEY, next),
    [queryClient]
  )

  const writeBindings = useCallback(
    (next: HotkeyBindings) => queryClient.setQueryData<HotkeyBindings>(BINDINGS_KEY, next),
    [queryClient]
  )

  const writeStatus = useCallback(
    (next: HotkeyStatus) => queryClient.setQueryData<HotkeyStatus>(STATUS_KEY, next),
    [queryClient]
  )

  const patchSettings = useCallback(
    async (patch: Partial<Settings>) => writeSettings(await call<Settings>(IPC_CHANNELS.settingsSet, patch)),
    [writeSettings]
  )

  // Main owns these values and also changes them from the tray and the global hook, so re-read after a write.
  const refresh = useCallback(() => {
    void settings.refetch()
    void bindings.refetch()
    void status.refetch()
  }, [settings, bindings, status])

  useIpcEvent(IPC_CHANNELS.hotkeysBindingsChanged, hotkeyBindingsSchema, writeBindings)
  useIpcEvent(IPC_CHANNELS.hotkeysStatusChanged, hotkeyStatusSchema, writeStatus)

  return { settings, bindings, status, patchSettings, writeSettings, writeBindings, writeStatus, refresh }
}
