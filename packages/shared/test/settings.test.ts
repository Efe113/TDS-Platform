import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOTKEY_BINDINGS,
  appMetaSchema,
  displayInfoSchema,
  overlayGeometryPatchSchema,
  settingsPatchSchema,
  settingsSchema
} from '../src/ipc/contract'

describe('settings contract', () => {
  it('fills the desktop defaults without mutating an old settings file', () => {
    const parsed = settingsSchema.parse({})
    expect(parsed.closeToTray).toBe(true)
    expect(parsed.launchAtLogin).toBe(false)
    expect(parsed.startMinimized).toBe(false)
    expect(parsed.preventSleep).toBe(false)
    expect(parsed.startRoute).toBe('home')
    expect(parsed.uiScale).toBe(1)
    expect(parsed.highContrast).toBe(false)
    expect(parsed.hotkeys).toEqual(DEFAULT_HOTKEY_BINDINGS)
  })

  it('never fills defaults into a patch, which would reset untouched controls', () => {
    expect(settingsPatchSchema.parse({ closeToTray: false })).toEqual({ closeToTray: false })
    expect(settingsPatchSchema.parse({ overlayThemeKey: 'ember' })).toEqual({ overlayThemeKey: 'ember' })
    expect(overlayGeometryPatchSchema.parse({ opacity: 0.5 })).toEqual({ opacity: 0.5 })
  })

  it('validates the display list and packaged app metadata', () => {
    const display = displayInfoSchema.parse({ id: 1, label: 'Primary', primary: true, width: 1920, height: 1080 })
    expect(display.primary).toBe(true)
    const meta = appMetaSchema.parse({
      name: 'TDS Companion',
      version: '0.1.0',
      electron: '45',
      platform: 'win32',
      userDataPath: 'C:/data',
      policyVersion: '1.0'
    })
    expect(meta.packaged).toBe(false)
  })
})
