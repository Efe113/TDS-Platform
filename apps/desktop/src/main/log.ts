import log from 'electron-log/main'
import { app } from 'electron'

// With ELECTRON_RUN_AS_NODE set, `require('electron')` returns the binary path string and `app`
// is undefined — logging must not be the thing that takes the process down.
const isPackaged = typeof app?.isPackaged === 'boolean' ? app.isPackaged : false

log.initialize({ preload: false })

log.transports.file.maxSize = 10 * 1024 * 1024
log.transports.file.level = 'info'
log.transports.console.level = isPackaged ? 'warn' : 'debug'

export const logger = log

export function scrub(text: string): string {
  return text
    .replace(
      /(access_token|refresh_token|id_token|password|authorization)["']?\s*[:=]\s*["']?[^\s"',}]+/gi,
      '$1=[redacted]'
    )
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[jwt-redacted]')
}
