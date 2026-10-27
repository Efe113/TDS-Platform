import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FRAME_SKINS,
  PROFILE_THEME_KEYS,
  PROFILE_THEME_SKINS,
  pronounsIsValid,
  profileLink,
  profileShowcaseSchema,
  profileThemeSkin,
  routeFromDeepLink
} from '../src/index'

/**
 * 0043 puts three vocabularies side by side — the frame skins, the profile themes and the unlock rule
 * written in SQL. They only agree because these tests say so: the frame registry already shipped a
 * skin (`gold`) with no catalog row behind it, which could be seen but never equipped.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../../../supabase/migrations')
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
  .join('\n')
const theme = readFileSync(join(migrationsDir, '0043_profile_themes.sql'), 'utf8')

describe('profile themes (0043)', () => {
  it('lists the same theme keys the unlock function knows', () => {
    const start = theme.indexOf('app.profile_theme_unlocked')
    const stop = theme.indexOf('$$;', start)
    const block = theme.slice(start, stop)
    const stored = [...block.matchAll(/'([a-z]+)'/g)]
      .flatMap((match) => (typeof match[1] === 'string' ? [match[1]] : []))
      .filter((value) => PROFILE_THEME_KEYS.includes(value))
    expect([...new Set(stored)].sort()).toEqual([...PROFILE_THEME_KEYS].sort())
  })

  it('seeds a catalog row for every theme so every one can be owned', () => {
    for (const skin of PROFILE_THEME_SKINS) {
      expect(theme).toContain(`'theme_${skin.key}'`)
      expect(theme).toContain(`'${skin.key}'`)
    }
  })

  it('agrees with SQL on what a purchased theme costs', () => {
    for (const skin of PROFILE_THEME_SKINS.filter((entry) => entry.source === 'purchase')) {
      expect(theme).toContain(`'theme_${skin.key}', 'cosmetic', ${String(skin.price)}`)
    }
    // The tier themes are grants, not products: zero price and the benefit tag that blocks the till.
    expect(theme).toContain(`'theme_aurum', 'cosmetic', 0, 'aurum'`)
    expect(theme).toContain(`'theme_onyx', 'cosmetic', 0, 'onyx'`)
  })

  it('paints a distinct ground for each theme instead of reusing one gradient', () => {
    const stops = PROFILE_THEME_SKINS.map((skin) => skin.stops.join('|'))
    expect(new Set(stops).size).toBe(stops.length)
    expect(profileThemeSkin('aurum')?.source).toBe('vip')
    expect(profileThemeSkin('nope')).toBeNull()
  })

  it('gives every registered frame a catalog row, the way gold finally has', () => {
    for (const frame of FRAME_SKINS) {
      expect(migrations).toContain(`'frame_${frame.key}'`)
    }
  })

  /**
   * 0049 sells the five layers *by name*: the tile lists `perks` straight from the database while the
   * ring paints whatever the registry declares. If those two lists drift, the shelf promises a surface
   * the client never draws - so the row must carry exactly the five registry labels, in order.
   */
  it('sells exactly the five layers the client paints, in the registry order', () => {
    const frames = readFileSync(join(migrationsDir, '0049_void_theme_and_five_layer_frames.sql'), 'utf8')
    for (const frame of FRAME_SKINS) {
      const start = frames.indexOf(`('${frame.key === 'ember' ? 'frame_ember' : 'frame_' + frame.key}', 'frame'`)
      expect(start, `frame_${frame.key} row`).toBeGreaterThan(-1)
      const end = frames.indexOf("'::jsonb", start)
      const block = frames.slice(start, end)
      const labels = frame.layers.map((layer) => layer.labelTr)
      expect(block, `frame_${frame.key} perks`).toContain(`["${labels.join('","')}"]`)
      expect((block.match(/"/g) ?? []).length, `frame_${frame.key} has exactly five perks`).toBe(10)
    }
  })

  it('keeps the VIP frame a benefit rather than a renewed product', () => {
    // 'renewed' is a marketing chip. On the rainbow it would take the row out of the tier grant and
    // put a free entitlement behind the till (the same trap 0042 closed for the membership itself).
    const frames = readFileSync(join(migrationsDir, '0049_void_theme_and_five_layer_frames.sql'), 'utf8')
    const start = frames.indexOf("('frame_rainbow'")
    // The rainbow is the last row of the block, so its text runs up to the conflict clause.
    const row = frames.slice(start, frames.indexOf('on conflict', start))
    expect(start).toBeGreaterThan(-1)
    expect(row).toContain("'frame_rainbow', 'frame', 0, 'rainbow'")
    expect(row).toContain("'vip'")
    expect(row).not.toContain("'renewed'")
  })

  it('parses a showcase from a database that has not run 0043', () => {
    const parsed = profileShowcaseSchema.parse({
      userId: '7c1a6a1e-6d0d-4a71-8f0e-2f2b4c1d9a10',
      handle: 'efe',
      displayName: null,
      bio: null,
      joinedAt: '2026-10-22T11:00:00Z',
      themeKey: null,
      themeName: null,
      themeAccent: null
    })
    expect(parsed.profileTheme).toBeNull()
    expect(parsed.pronouns).toBeNull()
    expect(parsed.profileThemeNameEn).toBeNull()
  })

  it('accepts pronouns up to the length SQL allows', () => {
    expect(pronounsIsValid('')).toBe(true)
    expect(pronounsIsValid('onlar/onlar')).toBe(true)
    expect(pronounsIsValid('a'.repeat(60))).toBe(true)
    expect(pronounsIsValid('a'.repeat(61))).toBe(false)
    expect(theme).toContain("raise exception 'PRONOUNS_TOO_LONG'")
  })
})

describe('the shared deep link (0043)', () => {
  const id = '7c1a6a1e-6d0d-4a71-8f0e-2f2b4c1d9a10'

  it('turns a profile link into the route the card copies', () => {
    expect(profileLink(id)).toBe(`tdsapp://profile/${id}`)
    expect(routeFromDeepLink(profileLink(id))).toBe(`/profile/${id}`)
    expect(routeFromDeepLink(`tdsapp://strategy/${id}?from=share`)).toBeNull()
    expect(routeFromDeepLink(`tdsapp://strategy/${id}`)).toBe(`/strategy/${id}`)
  })

  it('routes hosts it knows and refuses everything else', () => {
    expect(routeFromDeepLink('tdsapp://market')).toBe('/market')
    expect(routeFromDeepLink('tdsapp://profile/nope')).toBeNull()
    expect(routeFromDeepLink('tdsapp://../../etc/passwd')).toBeNull()
    expect(routeFromDeepLink('https://example.com/profile/' + id)).toBeNull()
    expect(routeFromDeepLink(null)).toBeNull()
  })
})

describe('the cosmetic pins 0037 lost (0043)', () => {
  it('pins every server-owned cosmetic column again', () => {
    expect(theme).toContain('new.theme_key := old.theme_key;')
    expect(theme).toContain('new.active_title := old.active_title;')
    expect(theme).toContain('new.frame_key := old.frame_key;')
    expect(theme).toContain('new.profile_theme_key := old.profile_theme_key;')
  })

  it('keeps the tier columns behind their own escape hatches', () => {
    expect(theme).toContain("current_setting('app.cosmetic_write', true)")
    expect(theme).toContain("current_setting('app.theme_write', true)")
    expect(theme).toContain("current_setting('app.verified_write', true)")
    expect(theme).toContain("current_setting('app.corporate_write', true)")
  })

  it('teaches equipping the profile kind without loosening anything else', () => {
    expect(theme).toContain("if p_kind not in ('title', 'frame', 'profile') then")
    expect(theme).toContain('elsif p_kind = ')
    expect(theme).toContain("update public.profiles set profile_theme_key = v_ref")
  })
})

/**
 * A re-declared reader silently loses fields: 0040 rewrote `profile_showcase` without `frameKey` and
 * 0043 copied that shape, so the equip wrote to `profiles.frame_key` while the client parsed a missing
 * key into `null`. The schema defaults every late field, so nothing threw — it just looked like
 * equipping was broken. This test is the closed door: the newest declaration has to carry the whole
 * client contract.
 */
describe('the profile reader contract', () => {
  const latestShowcase = (() => {
    let body = ''
    for (const name of readdirSync(migrationsDir).filter((entry) => entry.endsWith('.sql')).sort()) {
      const text = readFileSync(join(migrationsDir, name), 'utf8')
      const start = text.indexOf('create or replace function public.profile_showcase')
      if (start < 0) continue
      const stop = text.indexOf('$$;', start)
      body = text.slice(start, stop)
    }
    return body.slice(body.lastIndexOf('return jsonb_build_object'))
  })()

  const emitted = new Set(
    [...latestShowcase.matchAll(/'([a-zA-Z_]+)'/g)].flatMap((match) => (typeof match[1] === 'string' ? [match[1]] : []))
  )

  it('emits every field the showcase schema reads', () => {
    const missing = Object.keys(profileShowcaseSchema.shape).filter((key) => !emitted.has(key))
    expect(missing).toEqual([])
  })

  it('sends the equipped frame from the profile row, not from a receipt', () => {
    expect(latestShowcase).toContain("'frameKey', v_profile.frame_key,")
  })
})
