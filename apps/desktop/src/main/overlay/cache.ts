import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { strategyCacheEntrySchema, strategyCacheFileName, type StrategyCacheEntry, type StrategyCacheRow } from '@tds/shared'
import { logger } from '../log'
import { strategyFromIr, type TrackedStrategy } from './labels'

/**
 * The offline shelf.
 *
 * Every document the member tracks is written here, so a restart — or a dropped connection mid-run,
 * which is exactly when the overlay earns its keep — does not lose the run. Only the renderer can read
 * the database, so the payload has to be saved where the overlay lives: the main process.
 *
 * Two rules hold this together:
 *  - the key never becomes a file name raw. `strategyCacheFileName` (shared, tested) turns a uuid or a
 *    typed document name into `[a-z0-9-]+\.json`, so nothing here can be steered outside the directory.
 *  - a bad file is moved aside, not overwritten, and an old one is dropped. The cache is a convenience,
 *    not a source of truth; nothing here may outlive its usefulness silently.
 */

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CACHE_CAPACITY = 12

const dirPath = (): string => join(app.getPath('userData'), 'strategies')

function pathFor(key: string): string {
  return join(dirPath(), strategyCacheFileName(key))
}

function isExpired(savedAt: number, now: number): boolean {
  return now - savedAt > CACHE_TTL_MS
}

class StrategyCache {
  private writeChain: Promise<void> = Promise.resolve()

  private async ensureDir(): Promise<void> {
    await mkdir(dirPath(), { recursive: true })
  }

  /** Fire-and-forget from the IPC handler: a slow disk must never delay the overlay appearing. */
  save(entry: StrategyCacheEntry): Promise<void> {
    const checked = strategyCacheEntrySchema.parse(entry)
    this.writeChain = this.writeChain.then(async () => {
      try {
        await this.ensureDir()
        const path = pathFor(checked.key)
        const temp = `${path}.tmp`
        await writeFile(temp, JSON.stringify(checked), 'utf8')
        await rename(temp, path)
        await this.prune()
      } catch (error) {
        logger.warn('strategy cache could not be written', error)
      }
    })
    return this.writeChain
  }

  async list(): Promise<StrategyCacheRow[]> {
    let names: string[]
    try {
      names = await readdir(dirPath())
    } catch {
      return []
    }

    const now = Date.now()
    const rows: StrategyCacheRow[] = []
    for (const name of names.filter((file) => file.endsWith('.json'))) {
      const entry = await this.readPath(join(dirPath(), name), now)
      if (entry === null) continue
      rows.push({
        key: entry.key,
        name: entry.name,
        savedAt: entry.savedAt,
        steps: entry.ir.steps.length,
        mapName: entry.ir.meta.map.key,
        isEventStrategy: entry.ir.meta.event.isEvent
      })
    }
    return rows.sort((a, b) => b.savedAt - a.savedAt)
  }

  /** The tracked shape the session takes, or null when nothing usable is on disk. */
  async track(key: string): Promise<TrackedStrategy | null> {
    const entry = await this.readPath(pathFor(key), Date.now())
    if (entry === null) return null
    return strategyFromIr(entry.ir, {
      id: entry.key,
      towerNamesTr: entry.towerNamesTr,
      stepHealth: entry.stepHealth,
      source: 'cache',
      savedAt: entry.savedAt
    })
  }

  /** Privacy, not housekeeping: the member can erase every tracked document this machine kept. */
  async clear(): Promise<number> {
    let names: string[]
    try {
      names = await readdir(dirPath())
    } catch {
      return 0
    }
    let removed = 0
    for (const name of names.filter((file) => file.endsWith('.json') || file.endsWith('.bad'))) {
      try {
        await unlink(join(dirPath(), name))
        removed += 1
      } catch (error) {
        logger.warn(`strategy cache entry ${name} could not be deleted`, error)
      }
    }
    return removed
  }

  private async readPath(path: string, now: number): Promise<StrategyCacheEntry | null> {
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      return null
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      await this.setAside(path, 'unparsable')
      return null
    }

    const checked = strategyCacheEntrySchema.safeParse(parsed)
    if (!checked.success) {
      await this.setAside(path, 'schema')
      return null
    }
    if (isExpired(checked.data.savedAt, now)) {
      try {
        await unlink(path)
      } catch {
        // A file we cannot delete is simply not usable; it is already out of every listing below.
      }
      return null
    }
    return checked.data
  }

  /** Keeps a corrupt entry for inspection instead of overwriting evidence with a silent reset. */
  private async setAside(path: string, reason: string): Promise<void> {
    try {
      await rename(path, `${path}.${reason}.bad`)
      logger.warn(`strategy cache ${reason}, moved aside`)
    } catch (error) {
      logger.warn('strategy cache could not be moved aside', error)
    }
  }

  /** Drops everything past the capacity, newest first, so the shelf cannot grow without bound. */
  private async prune(): Promise<void> {
    let names: string[]
    try {
      names = await readdir(dirPath())
    } catch {
      return
    }
    const entries: { path: string; savedAt: number }[] = []
    for (const name of names.filter((file) => file.endsWith('.json'))) {
      const path = join(dirPath(), name)
      const entry = await this.readPath(path, Date.now())
      if (entry === null) continue
      entries.push({ path, savedAt: entry.savedAt })
    }
    entries.sort((a, b) => b.savedAt - a.savedAt)
    for (const stale of entries.slice(CACHE_CAPACITY)) {
      try {
        await unlink(stale.path)
      } catch (error) {
        logger.warn('a stale strategy cache entry could not be deleted', error)
      }
    }
  }
}

export const strategyCache = new StrategyCache()
