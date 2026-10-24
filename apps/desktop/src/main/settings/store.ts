import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { settingsSchema, type OverlayGeometry, type Settings, type HotkeyBindings } from '@tds/shared'

const FILE_NAME = 'settings.json'

export type SettingsListener = (settings: Settings) => void

class SettingsStore {
  private current: Settings = settingsSchema.parse({})
  private readonly listeners = new Set<SettingsListener>()
  private loaded = false

  private get filePath(): string {
    return join(app.getPath('userData'), FILE_NAME)
  }

  load(): Settings {
    try {
      if (existsSync(this.filePath)) {
        const parsed = settingsSchema.safeParse(JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown)
        if (parsed.success) this.current = parsed.data
      }
    } catch {
      // A corrupt settings file must not prevent the app from starting; defaults win.
    }
    this.loaded = true
    return this.current
  }

  get(): Settings {
    if (!this.loaded) this.load()
    return this.current
  }

  get hotkeys(): HotkeyBindings {
    return this.get().hotkeys
  }

  get overlay(): OverlayGeometry {
    return this.get().overlay
  }

  update(patch: Partial<Settings>): Settings {
    const merged = settingsSchema.parse({ ...this.get(), ...patch })
    this.current = merged
    this.persist()
    this.emit()
    return merged
  }

  setHotkey(action: keyof HotkeyBindings, code: string | null): Settings {
    const hotkeys = { ...this.get().hotkeys, [action]: code }
    return this.update({ hotkeys })
  }

  setOverlay(patch: Partial<OverlayGeometry>): Settings {
    return this.update({ overlay: { ...this.get().overlay, ...patch } })
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.current)
  }

  private persist(): void {
    try {
      const dir = app.getPath('userData')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.current, null, 2), 'utf8')
    } catch {
      // Settings stay in memory for this session if the disk write fails.
    }
  }
}

export const settingsStore = new SettingsStore()
