import type { IpcResult } from '@tds/shared'
import type { TdsBridge } from '../types/bridge'

export class IpcError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message)
    this.name = 'IpcError'
  }
}

function requireBridge(): TdsBridge {
  const bridge: TdsBridge | undefined = typeof window === 'undefined' ? undefined : window.tds
  if (!bridge) throw new IpcError('window.tds bridge unavailable', 'bridge-missing')
  return bridge
}

function unwrap<T>(result: IpcResult<T>): T {
  if (result.ok) return result.data
  throw new IpcError(result.error, result.code)
}

/** Every call site passes an IPC_CHANNELS value, never a string literal. */
export async function call<T>(channel: string, payload?: unknown): Promise<T> {
  return unwrap(await requireBridge().invoke<T>(channel, payload))
}

export function subscribe(channel: string, listener: (payload: unknown) => void): () => void {
  const bridge: TdsBridge | undefined = typeof window === 'undefined' ? undefined : window.tds
  if (!bridge) return () => undefined
  return bridge.on(channel, listener)
}

export function platform(): string {
  try {
    return requireBridge().platform
  } catch {
    return 'unknown'
  }
}

export function isBridgeMissing(error: unknown): boolean {
  return error instanceof IpcError && error.code === 'bridge-missing'
}
