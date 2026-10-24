import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import type { IpcResult } from '@tds/shared'
import { logger } from '../log'

type HandlerArgs = [event: IpcMainInvokeEvent, args: unknown]

function describe(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    const withIssue = error as Error & { issues?: { message: string; path: (string | number)[] }[] }
    const issue = withIssue.issues?.[0]
    if (issue) return { message: `${issue.path.join('.')}: ${issue.message}`, code: 'bad-payload' }
    return { message: error.message, code: 'handler-error' }
  }
  return { message: String(error), code: 'unknown' }
}

export function handle<T>(channel: string, fn: (...args: HandlerArgs) => T | Promise<T>): void
export function handle<T, S extends z.ZodTypeAny>(channel: string, input: S, fn: (event: IpcMainInvokeEvent, args: z.infer<S>) => T | Promise<T>): void
export function handle<T>(
  channel: string,
  inputOrFn: z.ZodTypeAny | ((...args: HandlerArgs) => T | Promise<T>),
  maybeFn?: (...args: HandlerArgs) => T | Promise<T>
): void {
  const schema = typeof inputOrFn === 'function' ? null : inputOrFn
  const fn = (typeof inputOrFn === 'function' ? inputOrFn : maybeFn) as (...args: HandlerArgs) => T | Promise<T>

  ipcMain.handle(channel, async (event, raw): Promise<IpcResult<T>> => {
    try {
      const args = schema ? schema.parse(raw) : raw
      const data = await fn(event, args as never)
      return { ok: true, data }
    } catch (error) {
      const { message, code } = describe(error)
      logger.warn(`ipc ${channel} failed: ${message}`)
      return { ok: false, error: message, code }
    }
  })
}

export function emitTo(window: Electron.BrowserWindow | null, channel: string, payload: unknown): void {
  if (!window || window.isDestroyed()) return
  window.webContents.send(channel, payload)
}
