import { captureException, init } from '@sentry/electron/renderer'

/**
 * The renderer never talks to sentry.io: it forwards events to the main process over the
 * sentry-ipc:// scheme, so no DSN or network permission belongs in this bundle. With no DSN
 * configured in main the forwarded events are simply dropped.
 */
export function initRendererTelemetry(): void {
  init()
}

/** Used by the error boundary; the SDK's own global handlers already cover window errors. */
export function reportRendererError(error: unknown, context: string): void {
  captureException(error instanceof Error ? error : new Error(String(error)), {
    level: 'error',
    tags: { context }
  })
}
