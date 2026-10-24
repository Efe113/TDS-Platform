import { useEffect, useRef } from 'react'
import type { z } from 'zod'
import { subscribe } from './ipc'

/** Event payloads cross the bridge untyped, so every subscription validates with a shared schema. */
export function useIpcEvent<T>(channel: string, schema: z.ZodType<T>, handler: (payload: T) => void): void {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(
    () =>
      subscribe(channel, (payload) => {
        const parsed = schema.safeParse(payload)
        if (parsed.success) handlerRef.current(parsed.data)
      }),
    [channel, schema]
  )
}
