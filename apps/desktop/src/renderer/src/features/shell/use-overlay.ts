import { useMutation } from '@tanstack/react-query'
import { IPC_CHANNELS, type OverlayState } from '@tds/shared'
import { useAppStore } from '../../store/app-store'
import { call } from '../../lib/ipc'

export function useOverlayControls() {
  const visible = useAppStore((state) => state.overlayVisible)
  const setVisible = useAppStore((state) => state.setOverlayVisible)

  const show = useMutation({
    mutationFn: async () => call<unknown>(IPC_CHANNELS.overlayShow),
    onSuccess: () => setVisible(true)
  })

  const hide = useMutation({
    mutationFn: async () => call<unknown>(IPC_CHANNELS.overlayHide),
    onSuccess: () => setVisible(false)
  })

  const step = useMutation({
    mutationFn: async (action: 'next' | 'prev' | 'reset') => call<OverlayState | null>(IPC_CHANNELS.strategyStep, { action }),
    onSuccess: (state) => useAppStore.getState().applyOverlayState(state)
  })

  const jump = useMutation({
    mutationFn: async (index: number) => call<OverlayState | null>(IPC_CHANNELS.strategyJump, { step: index }),
    onSuccess: (state) => useAppStore.getState().applyOverlayState(state)
  })

  return { visible, show, hide, step, jump }
}
