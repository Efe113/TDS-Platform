import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 0.3.5 stopped the stutter by changing how the skins move, and this file is the promise that they
 * keep moving that way. Every rule here is about the cost of one frame, not about taste:
 *
 * - an animated registered custom property (`@property --frame-angle`) re-rasterizes every gradient
 *   that reads it, sixty times a second, on every tile of a shelf;
 * - `filter: blur()` and `backdrop-filter` over the animated surface do the same to a whole window;
 * - `background-position`, `box-shadow`, `text-shadow` and `filter` repaint the element they sit on,
 *   while `transform` and `opacity` are handed to the compositor for free.
 *
 * The paint list below is not empty on purpose: the ember rail, the hazard tape and the VIP badges are
 * two- and three-pixel-high strips, and repainting one of those is cheaper than rebuilding it as a
 * rotating sheet. What is not allowed is a *new* name in that list, because the next thing someone
 * animates is likely to be a full-window layer.
 */

const here = dirname(fileURLToPath(import.meta.url))
const rendererDir = join(here, '../../../apps/desktop/src/renderer/src')
const cssPath = join(rendererDir, 'styles/global.css')
const css = readFileSync(cssPath, 'utf8')

/** Comments explain the old bugs, so a guard that reads them finds bugs everywhere. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\*.*$/gm, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

const code = stripComments(css)

function keyframes(source: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = []
  const re = /@keyframes\s+[\w-]+\s*\{/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) {
    let depth = 1
    let index = re.lastIndex
    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth += 1
      else if (source[index] === '}') depth -= 1
      index += 1
    }
    const name = match[0].match(/@keyframes\s+([\w-]+)/)?.[1] ?? ''
    out.push({ name, body: source.slice(re.lastIndex, index - 1) })
  }
  return out
}

const PAINT_PROPERTIES = ['background-position', 'box-shadow', 'text-shadow', 'filter']

/** Thin strips and small badges: repainting them costs less than re-architecting them. */
const PAINT_ALLOWLIST = [
  'skin-ember-flow',
  'skin-ember-breathe',
  'skin-toxic-tape',
  'skin-toxic-rail',
  'skin-toxic-flow',
  'skin-toxic-pulse',
  'forge-name-burn',
  'market-tag-renewed-run',
  'title-badge-rainbow',
  'verified-badge-pulse',
  'corporate-badge-pulse'
]

function animatedProperties(body: string): string[] {
  const found = new Set<string>()
  for (const declaration of body.matchAll(/(?:^|[{;\s])([-a-z]+)\s*:/gm)) {
    const property = declaration[1]
    if (property && !['from', 'to'].includes(property)) found.add(property)
  }
  return [...found].sort()
}

describe('render performance (0.3.5)', () => {
  it('animates only compositor properties, plus the listed thin strips', () => {
    const offenders = keyframes(code)
      .map((entry) => ({ name: entry.name, paint: animatedProperties(entry.body).filter((p) => PAINT_PROPERTIES.includes(p)) }))
      .filter((entry) => entry.paint.length > 0)
    expect(offenders.map((entry) => entry.name).sort()).toEqual([...PAINT_ALLOWLIST].sort())
  })

  it('never animates a registered custom property', () => {
    // The two @property declarations this file used to carry (--frame-angle, --edge-angle) are why the
    // frame engine rotates a sheet inside a static mask instead of turning a conic gradient's angle.
    expect(code).not.toMatch(/@property/)
    expect(code).not.toMatch(/--frame-angle/)
    expect(code).not.toMatch(/--edge-angle/)
  })

  it('keeps blur off the animated surface', () => {
    expect(code).not.toMatch(/backdrop-filter\s*:/)
    expect(code).not.toMatch(/filter\s*:\s*[^;]*blur\(/)
    // Tailwind compiles backdrop-blur-* into a backdrop-filter, so the class is the same mistake.
    const blurred = sourceFiles()
      .filter((file) => /backdrop-blur|backdrop-filter/.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(rendererDir, file).replace(/\\/g, '/'))
    expect(blurred).toEqual([])
  })

  it('runs one animation loop for the whole renderer', () => {
    const owners = sourceFiles()
      .filter((file) => /requestAnimationFrame\s*\(/.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(rendererDir, file).replace(/\\/g, '/'))
      .sort()
    // ticker.ts is the loop; sampler.ts is the one-shot startup measurement that decides the tier.
    expect(owners).toEqual(['motion/sampler.ts', 'motion/ticker.ts'])
  })

  it('pays the canvas only for moving points', () => {
    const field = stripComments(readFileSync(join(rendererDir, 'motion/primitives/ParticleField.tsx'), 'utf8'))
    expect(field).not.toMatch(/shadowBlur\s*=/)
    expect(field).toMatch(/MAX_DPR\s*=\s*1\.5/)
    expect(field).toMatch(/subscribeToTicker/)
    expect(field).not.toMatch(/requestAnimationFrame\s*\(/)
  })

  it('gives the frame engine five surfaces and no animated angle', () => {
    for (const surface of ['halo', 'core', 'spin', 'spark', 'mark']) {
      expect(code, `.frame-${surface}`).toMatch(new RegExp(`\\.frame-${surface}\\b`))
    }
    expect(code).toMatch(/\.frame-spin-disc\s*\{[^}]*animation:\s*frame-disc-turn/)
    expect(code).toMatch(/will-change:\s*transform/)
  })

  it('asks the tier before it asks the GPU', () => {
    // MotionProvider writes the measured tier onto the root element, and CSS parks the rotations there.
    const context = readFileSync(join(rendererDir, 'motion/context.tsx'), 'utf8')
    expect(context).toMatch(/dataset\.motion\s*=/)
    expect(code).toMatch(/\[data-motion='low'\][^{]*\{[^}]*animation:\s*none/)
  })

  it('stops a preview that is not on screen', () => {
    const hook = readFileSync(join(rendererDir, 'motion/useAmbientActive.ts'), 'utf8')
    expect(hook).toMatch(/IntersectionObserver/)
    const backdrop = stripComments(readFileSync(join(rendererDir, 'components/brand/theme-backdrop.tsx'), 'utf8'))
    expect(backdrop).toMatch(/active/)
    expect(backdrop).not.toMatch(/mixBlendMode/)
    expect(backdrop).not.toMatch(/filter:\s*['"`]?blur/)
  })

  it('leaves the cards without a blur behind them', () => {
    // A hud-panel over the moving skin used to re-rasterize the whole panel on every frame of the theme.
    const panel = code.match(/\.hud-panel\s*\*\{[\s\S]*?\}|\.hud-panel\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(panel).not.toMatch(/backdrop-filter/)
  })
})

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry.name)) out.push(path)
    }
  }
  walk(rendererDir)
  return out
}
