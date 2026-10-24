import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { logger } from '../log'

const FILE_NAME = 'session.bin'

type AsyncSafeStorage = {
  isAsyncEncryptionAvailable?: () => Promise<boolean>
  encryptStringAsync?: (text: string) => Promise<Buffer>
  decryptStringAsync?: (buffer: Buffer) => Promise<string>
}

const asyncApi = safeStorage as unknown as AsyncSafeStorage

function sessionPath(): string {
  const dir = join(app.getPath('userData'), 'auth')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, FILE_NAME)
}

async function encryptionAvailable(): Promise<boolean> {
  try {
    if (asyncApi.isAsyncEncryptionAvailable) return await asyncApi.isAsyncEncryptionAvailable()
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export async function saveSession(payload: string): Promise<void> {
  if (await encryptionAvailable()) {
    const encrypted = asyncApi.encryptStringAsync
      ? await asyncApi.encryptStringAsync(payload)
      : safeStorage.encryptString(payload)
    await writeFile(sessionPath(), encrypted)
    return
  }
  // DPAPI unavailable (rare, e.g. a locked profile): keep the file but make the risk visible.
  logger.warn('safeStorage unavailable, session stored unencrypted for this run only')
  await writeFile(sessionPath(), JSON.stringify({ unencrypted: true, payload }), 'utf8')
}

export async function loadSession(): Promise<string | null> {
  const path = sessionPath()
  if (!existsSync(path)) return null
  try {
    const raw = await readFile(path)
    if (await encryptionAvailable()) {
      return asyncApi.decryptStringAsync
        ? await asyncApi.decryptStringAsync(raw)
        : safeStorage.decryptString(raw)
    }
    const parsed = JSON.parse(raw.toString('utf8')) as { unencrypted?: boolean; payload?: string }
    return parsed.unencrypted ? (parsed.payload ?? null) : null
  } catch (error) {
    logger.warn('session file unreadable, dropping it', error)
    clearSession()
    return null
  }
}

export function clearSession(): void {
  try {
    rmSync(sessionPath(), { force: true })
  } catch (error) {
    logger.warn('session file could not be removed', error)
  }
}
