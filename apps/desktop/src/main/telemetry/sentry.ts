import { app } from 'electron'
import * as Sentry from '@sentry/electron/main'
import { logger, scrub } from '../log'

/**
 * Error reporting, env-gated: with no VITE_SENTRY_DSN the SDK is never initialised and this module
 * costs one string check. That is deliberate - the DSN belongs in .env.local (gitignored), so a
 * checkout without it must still build and run exactly as before.
 *
 * The renderer is covered by the same DSN through @sentry/electron/renderer, which forwards events to
 * this process over the sentry-ipc:// scheme instead of letting the page reach the network itself.
 * That is why the CSP only has to allow that local scheme and never sentry.io.
 */

const dsn = (process.env.VITE_SENTRY_DSN ?? '').trim()

export const telemetryEnabled = (): boolean => dsn.length > 0

/**
 * Crash reports are telemetry, so they wait for Settings > "çökme raporu gönder" (settings.telemetryOptIn,
 * default off). The SDK still initialises before app ready - it registers its privileged IPC scheme at
 * init time and Electron refuses that later - but nothing leaves this machine until the toggle is on,
 * and turning it off clears the user id again.
 *
 * Two layers, because they work differently:
 *   * JS errors (main and renderer) are gated by beforeSend, so flipping the toggle takes effect at
 *     once in both directions.
 *   * The native crash handler (SentryMinidump/ElectronMinidump) is decided at init and is not
 *     registered at all when the app starts without the toggle on. A user who enables it mid-session
 *     therefore starts sending minidumps on the next launch - a false negative, never a leak.
 */
let consentGranted = false

const NATIVE_CRASH_INTEGRATIONS = ['SentryMinidump', 'ElectronMinidump']

export function setTelemetryConsent(granted: boolean): void {
  consentGranted = granted
  if (!granted && telemetryEnabled()) Sentry.setUser(null)
}

/**
 * The leak vector is the error text itself: our log lines and thrown messages can carry a session
 * fragment. Breadcrumbs are left alone - they come from Electron lifecycle events, not from user
 * documents, and scrubbing them would mean re-serialising every one of them on every event.
 */
function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const next: Sentry.ErrorEvent = { ...event }

  if (typeof next.message === 'string') next.message = scrub(next.message)

  if (next.exception?.values) {
    next.exception = {
      values: next.exception.values.map((value) => ({
        ...value,
        value: typeof value.value === 'string' ? scrub(value.value) : value.value
      }))
    }
  }

  return next
}

export function initTelemetry(consented: boolean): void {
  consentGranted = consented
  if (!telemetryEnabled()) {
    logger.info('telemetry disabled (no SENTRY_DSN configured)')
    return
  }

  // Called at module scope in index.ts, before app.whenReady(): the SDK registers its privileged
  // scheme during init, and Electron refuses that once the app is ready.
  Sentry.init({
    dsn,
    release: app.getVersion(),
    environment: app.isPackaged ? 'production' : 'development',
    // The Electron SDK options have no sendDefaultPii switch (the type rejects it), and we attach no
    // identity of our own except the account id set explicitly after sign-in. What is inherently lost
    // is the source IP of the upload itself - that is true of any crash reporter, and why the toggle
    // is opt-in.
    beforeSend: (event) => (consentGranted ? scrubEvent(event) : null),
    integrations: (integrations) =>
      consentGranted ? integrations : integrations.filter((integration) => !NATIVE_CRASH_INTEGRATIONS.includes(integration.name)),
    maxValueLength: 400
  })

  logger.info(`telemetry initialised (native crash reporting ${consentGranted ? 'on' : 'off'})`)
}

/** Called from the existing crash handlers, after the log line, so nothing is lost if Sentry is off. */
export function captureError(context: string, error: unknown): void {
  if (!telemetryEnabled()) return
  try {
    Sentry.captureException(error instanceof Error ? error : new Error(scrub(String(error))), {
      level: 'error',
      tags: { context }
    })
  } catch (failure: unknown) {
    logger.warn(`telemetry capture failed (${context})`, failure)
  }
}

export function captureMessage(context: string, message: string): void {
  if (!telemetryEnabled()) return
  try {
    Sentry.captureMessage(scrub(message), { level: 'warning', tags: { context } })
  } catch (failure: unknown) {
    logger.warn(`telemetry capture failed (${context})`, failure)
  }
}

/**
 * The account id only, never the handle, display name or email. Signing out clears it, so a shared
 * machine cannot leave a previous user's events attributable.
 */
export function setTelemetryUser(userId: string | null): void {
  if (!telemetryEnabled() || !consentGranted) return
  Sentry.setUser(userId === null ? null : { id: userId })
}
