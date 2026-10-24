import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IPC_CHANNELS, usageFlushResultSchema, usageStatusSchema, type UsageFlushResult, type UsageStatus } from '@tds/shared'
import { call } from './ipc'

/**
 * The usage pipeline lives in the main process (it owns the overlay session), so the renderer only
 * reads a snapshot of it. Polled rather than pushed: it changes on the order of seconds and only
 * matters while a page is open.
 */
export function useUsageStatus(enabled = true) {
  return useQuery({
    queryKey: ['usage', 'status'],
    queryFn: async (): Promise<UsageStatus> => usageStatusSchema.parse(await call<unknown>(IPC_CHANNELS.sessionOutboxStatus)),
    enabled,
    refetchInterval: 5_000,
    retry: 0
  })
}

export function useUsageFlush() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<UsageFlushResult> =>
      usageFlushResultSchema.parse(await call<unknown>(IPC_CHANNELS.sessionFlushNow)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['usage', 'status'] })
    }
  })
}
