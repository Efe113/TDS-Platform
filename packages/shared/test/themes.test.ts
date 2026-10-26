import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_KEY, THEME_KEYS, THEME_SKINS, TOKEN_VARS, resolveThemeKey, themeSkin } from '../src/domain/themes'
import { TIER_BUDGETS } from '../src/domain/motion'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../../../supabase/migrations')

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
    expect(THEME_SKINS.ember.tokens.brand).toBe('#ff8a3d')
    expect(THEME_SKINS.toxic.tokens.brand).toBe('#84f95c')
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

/**
 * 0.3.2 renews one skin instead of tinting it, and the renewal is only real if the layer stack, the
 * second particle field and the database copy all move together. These tests are the seams between
 * those three places: the registry, the migration and the two dictionaries.
 */
describe('the renewed forge skin (0045)', () => {
  const forge = readFileSync(join(migrationsDir, '0045_forge_theme_renewal.sql'), 'utf8')
  const tr = readFileSync(join(here, '../../../apps/desktop/src/renderer/src/i18n/extra-tr.ts'), 'utf8')
  const en = readFileSync(join(here, '../../../apps/desktop/src/renderer/src/i18n/extra-en.ts'), 'utf8')
  const skin = THEME_SKINS.ember

  it('stacks more layers than any unrenewed skin', () => {
    expect(skin.renewed).toBe(true)
    expect(skin.layers.length).toBeGreaterThan(Math.max(...THEME_KEYS.filter((key) => !THEME_SKINS[key].renewed).map((key) => THEME_SKINS[key].layers.length)))
    expect(skin.layers.slice(0, 3)).toEqual(['crucible', 'flames', 'coals'])
    expect(skin.layers).toContain('shimmer')
  })

  it('runs embers up and ash down in one field', () => {
    // Gravity is negated into the vertical velocity by the seed, so positive rises and negative falls.
    expect(skin.scene?.kind).toBe('ember')
    expect((skin.scene?.gravity ?? 0)).toBeGreaterThan(0)
    expect(skin.sceneAlt?.kind).toBe('ash')
    expect((skin.sceneAlt?.gravity ?? 0)).toBeLessThan(0)
    // Only a renewed skin runs a second field; the ones still waiting for their renewal do not.
    for (const key of THEME_KEYS.filter((entry) => !THEME_SKINS[entry].renewed)) {
      expect(THEME_SKINS[key].sceneAlt, `${key} should not have a second field yet`).toBeNull()
    }
  })

  it('has a tier ladder that can actually show the stack', () => {
    // Declaring seven layers means nothing if the top budget still cuts them to three.
    expect(TIER_BUDGETS.high.ambientLayers).toBeGreaterThanOrEqual(6)
    expect(TIER_BUDGETS.medium.ambientLayers).toBeGreaterThanOrEqual(4)
  })

  it('renames the display name in both languages and keeps the key', () => {
    expect(tr).toContain("'theme.name.ember': 'Ocak'")
    expect(en).toContain("'theme.name.ember': 'Forge'")
    expect(forge).toContain("name_tr = 'Ocak'")
    expect(forge).toContain("name_en = 'Forge'")
    expect(forge).toContain("key = 'ember'")
  })

  it('puts the same accent in the database as the registry paints', () => {
    expect(forge).toContain(`"${skin.tokens.brand}"`)
  })

  it('keeps the renewal chip out of the till\'s benefit list', () => {
    // 'renewed' is marketing. If it ever lands next to the benefit tags, membership products stop selling.
    expect(forge).toContain("'renewed'")
    expect(forge).not.toMatch(/v_item\.tag in \([^)]*renewed/)
    expect(forge).not.toMatch(/coalesce\(p_tag, 'none'\) in \([^)]*renewed/)
    const till = readFileSync(join(migrationsDir, '0042_vip_membership_is_a_product.sql'), 'utf8')
    expect(till).toContain("v_item.kind <> 'vip' and v_item.tag in ('vip', 'verified', 'corporate')")
  })

  it('teaches both the constraint and the editor the new chip', () => {
    // Two tag vocabularies in the database; a widened CHECK with a narrow editor is a silent 500.
    const constraint = forge.match(/check \(tag in \(([^)]*)\)/)
    const editor = forge.match(/p_tag, 'none'\) not in \(([^)]*)\)/)
    expect(constraint?.[1]).toContain("'renewed'")
    expect(editor?.[1]).toContain("'renewed'")
    expect(constraint?.[1]).toBe(editor?.[1])
  })
})

/**
 * Renewal #2 (0.3.3, toxic). The point of doing this as a *standard* rather than as one nice fire
 * theme is that the next skin inherits the chrome and the shelf treatment; what has to be proven each
 * time is that the renewal is real (stack, second field, accent equality) and that it did not quietly
 * rename or re-price something somebody already bought.
 */
describe('the renewed toxic skin (0047)', () => {
  const leak = readFileSync(join(migrationsDir, '0047_toxic_theme_renewal.sql'), 'utf8')
  const skin = THEME_SKINS.toxic

  it('meets the same renewal bar as the forge', () => {
    const renewed = THEME_KEYS.filter((key) => THEME_SKINS[key].renewed)
    expect(renewed).toEqual(['ember', 'toxic'])
    for (const key of renewed) {
      const entry = THEME_SKINS[key]
      expect(entry.layers.length, `${key} stack`).toBeGreaterThanOrEqual(6)
      // A renewal that cannot survive its own layer list is just CSS with a new name.
      expect(TIER_BUDGETS.high.ambientLayers, `${key} needs headroom`).toBeGreaterThanOrEqual(entry.layers.length - 1)
      expect(entry.sceneAlt, `${key} needs a second field`).not.toBeNull()
    }
  })

  it('leads with the leak instead of the stripe', () => {
    expect(skin.layers.slice(0, 3)).toEqual(['sludge', 'drip', 'hazard'])
    expect(skin.layers).toContain('scanline')
    expect(skin.layers).toContain('grain')
    expect(skin.scene?.kind).toBe('spore')
    expect(skin.sceneAlt?.kind).toBe('dust')
    // Spores fall, dust floats: two directions, one canvas.
    expect((skin.scene?.gravity ?? 1)).toBeLessThan(0)
    expect(skin.sceneAlt?.gravity).toBe(0)
  })

  it('keeps the name and the price an owner bought', () => {
    expect(leak).toContain("'Toksik', 'Toxic',")
    expect(leak).toContain("'theme_toxic', 'theme', 220, 'toxic'")
    expect(leak).toContain("where key = 'toxic'")
  })

  it('keeps the database accent equal to the registry brand', () => {
    expect(leak).toContain(`"${skin.tokens.brand}"`)
  })

  it('re-declares the identical chip vocabulary', () => {
    const forge = readFileSync(join(migrationsDir, '0045_forge_theme_renewal.sql'), 'utf8')
    const in45 = forge.match(/check \(tag in \(([^)]*)\)/)
    const in47 = leak.match(/check \(tag in \(([^)]*)\)/)
    expect(in47?.[1]).toBe(in45?.[1])
    expect(in47?.[1]).toContain("'renewed'")
  })
})
