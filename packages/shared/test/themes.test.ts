import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_KEY, THEME_KEYS, THEME_SKINS, TOKEN_VARS, resolveThemeKey, themeSkin } from '../src/domain/themes'

const TOKEN_KEYS = Object.keys(TOKEN_VARS)

describe('theme skins', () => {
  it('gives every skin a value for every token the applier writes', () => {
    for (const key of THEME_KEYS) {
      const skin = THEME_SKINS[key]
      const missing = TOKEN_KEYS.filter((token) => typeof skin.tokens[token as keyof typeof skin.tokens] !== 'string')
      expect(missing, `${key} missing tokens`).toEqual([])
    }
  })

  it('falls back to the default skin for an unknown or missing key', () => {
    // profile_themes rows can be added in the database before a client that knows them ships.
    expect(resolveThemeKey('neon')).toBe(DEFAULT_THEME_KEY)
    expect(resolveThemeKey(null)).toBe(DEFAULT_THEME_KEY)
    expect(resolveThemeKey('toxic')).toBe('toxic')
  })

  it('keeps the seeded accents equal to each skin brand color', () => {
    // The wallet swatch reads profile_themes.css {"accent": ...}; a different brand there would show
    // one color in the picker and another on the window.
    expect(THEME_SKINS.default.tokens.brand).toBe('#4c8dff')
    expect(THEME_SKINS.ember.tokens.brand).toBe('#ff7a45')
    expect(THEME_SKINS.toxic.tokens.brand).toBe('#7ed957')
  })

  it('separates the skins by more than the brand color', () => {
    const bases = THEME_KEYS.map((key) => THEME_SKINS[key].tokens.base)
    const signatures = THEME_KEYS.map((key) => THEME_SKINS[key].signature)
    const edges = THEME_KEYS.map((key) => THEME_SKINS[key].cardEdge)
    expect(new Set(bases).size).toBe(THEME_KEYS.length)
    expect(new Set(signatures).size).toBe(THEME_KEYS.length)
    expect(new Set(edges).size).toBe(THEME_KEYS.length)
  })

  it('gives every paid skin a scene, and leaves the free one without one', () => {
    // The distinction has to be visible in motion, otherwise the price difference is a lie.
    expect(THEME_SKINS.default.scene).toBeNull()
    for (const key of ['ember', 'toxic', 'aurora', 'void'] as const) {
      const scene = THEME_SKINS[key].scene
      expect(scene, `${key} has no scene`).not.toBeNull()
      expect(scene?.density).toBeGreaterThan(0)
      expect(scene?.palette).toHaveLength(2)
    }
  })

  it('keeps the new skin keys and their accent pairs', () => {
    expect(THEME_SKINS.aurora.tokens.brand).toBe('#38bdf8')
    expect(THEME_SKINS.void.tokens.brand).toBe('#a78bfa')
    expect(THEME_SKINS.aurora.layers).toContain('ribbons')
    expect(THEME_SKINS.void.layers).toContain('grain')
    expect(THEME_SKINS.toxic.layers).toContain('bubbles')
    expect(THEME_SKINS.toxic.scene?.kind).toBe('spore')
    expect(THEME_SKINS.ember.layers).toContain('smoke')
    expect(THEME_SKINS.ember.scene?.kind).toBe('ember')
  })

  it('carries a mood label key the renderer can translate', () => {
    for (const key of THEME_KEYS) {
      expect(themeSkin(key).moodKey.startsWith('theme.mood')).toBe(true)
    }
  })
})
