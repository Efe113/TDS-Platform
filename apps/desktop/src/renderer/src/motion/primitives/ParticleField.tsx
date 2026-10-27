import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { clampParticles, type ParticleScene } from '@tds/shared'
import { useMotion } from '../context'
import { subscribeToTicker } from '../ticker'
import { useAmbientActive } from '../useAmbientActive'

/**
 * The skin's living layer: one canvas, shared with every other field on the page, and up to two
 * scenes inside it.
 *
 * Deliberately canvas instead of DOM/CSS: a hundred animated elements would each cost a layout and
 * paint, while this is a single composited surface. It also stops completely when the window is
 * hidden, when the surface has scrolled out, or when the machine is on the low tier - the app sits
 * over a game, and a background animation that steals frames from it is a bug, not a feature.
 *
 * Two scenes share the one loop because a renewed skin needs both directions at once: `ember` runs
 * embers up and ash down, `void` runs a star field and a dust field. Particles are drawn in
 * per-scene passes so a scene can pick its own blend mode.
 *
 * The per-frame cost is the point of this file. Building a colour string, a gradient or a shadow
 * *inside* the particle loop re-rasterizes on the main thread once per particle per frame, which is
 * how a decoration meant to be free ends up costing thirty milliseconds. So colours and sprites are
 * built once per resize, and the loop only moves things and calls `drawImage`.
 */

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  phase: number
  depth: number
  /** Tumble for flake-like kinds, unused where the kind is a round glow. */
  spin: number
  /** Colour and sprite bucket are decided at seed time; the loop must not recompute either. */
  color: string
  bucket: number
  alpha: number
}

interface Pass {
  scene: ParticleScene
  particles: Particle[]
  /** One cached sprite per palette stop. `null` for kinds that are drawn as shapes. */
  sprites: (HTMLCanvasElement | null)[]
  ribbonGradients: (CanvasGradient | null)[]
  /** Additive merging is what makes overlapping embers glow instead of stacking as flat dots. */
  additive: boolean
  /** Kinds drawn from a sprite never need a path, a fill style or a shadow. */
  usesSprite: boolean
}

const TAU = Math.PI * 2
/** Three stops across the scene palette: enough variation to read as organic, few enough to cache. */
const BUCKET_STOPS = [0.18, 0.5, 0.86] as const
const SPRITE_EDGE = 48
/** A 2x backing store doubles the pixels cleared and composited per frame for no visible gain here. */
const MAX_DPR = 1.5

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((char) => `${char}${char}`).join('') : value
  const int = Number.parseInt(full.slice(0, 6), 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

function rgba(rgb: [number, number, number], alpha: number): string {
  return `rgba(${String(rgb[0])}, ${String(rgb[1])}, ${String(rgb[2])}, ${String(alpha)})`
}

function mix(palette: [string, string], t: number): [number, number, number] {
  const a = hexToRgb(palette[0])
  const b = hexToRgb(palette[1])
  const channel = (index: 0 | 1 | 2): number => Math.round((a[index] ?? 0) + ((b[index] ?? 0) - (a[index] ?? 0)) * t)
  return [channel(0), channel(1), channel(2)]
}

/** How visible a particle of this kind is, decided once instead of inside the loop. */
function baseAlpha(kind: ParticleScene['kind']): number {
  if (kind === 'dust' || kind === 'ash') return 0.22
  if (kind === 'ember' || kind === 'spark') return 0.62
  if (kind === 'star') return 0.7
  return 0.5
}

/**
 * A cached soft blob. `glow` gets a hot core for fire, the rest get a plain falloff that replaces the
 * `shadowBlur` this used to set per particle - a blur applied inside a loop is the most expensive line
 * in a canvas renderer and it never showed up in a screenshot.
 */
function buildSprite(color: [number, number, number], glow: boolean): HTMLCanvasElement {
  const sprite = document.createElement('canvas')
  sprite.width = SPRITE_EDGE
  sprite.height = SPRITE_EDGE
  const paint = sprite.getContext('2d')
  const center = SPRITE_EDGE / 2
  if (paint) {
    const gradient = paint.createRadialGradient(center, center, 0, center, center, center)
    if (glow) {
      gradient.addColorStop(0, 'rgba(255, 247, 230, 1)')
      gradient.addColorStop(0.26, rgba(color, 0.95))
      gradient.addColorStop(0.62, rgba(color, 0.34))
      gradient.addColorStop(1, rgba(color, 0))
    } else {
      gradient.addColorStop(0, rgba(color, 0.95))
      gradient.addColorStop(0.45, rgba(color, 0.55))
      gradient.addColorStop(1, rgba(color, 0))
    }
    paint.fillStyle = gradient
    paint.fillRect(0, 0, SPRITE_EDGE, SPRITE_EDGE)
  }
  return sprite
}

function seed(scene: ParticleScene, count: number, width: number, height: number): Particle[] {
  const particles: Particle[] = []
  for (let index = 0; index < count; index += 1) {
    const depth = scene.kind === 'star' ? 0.25 + (index % 3) * 0.35 : 0.4 + Math.random() * 0.6
    const bucket = index % BUCKET_STOPS.length
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * (scene.kind === 'spark' ? 0.5 : 0.18) * scene.speed,
      vy: (scene.gravity === 0 ? (Math.random() - 0.5) * 0.16 : -scene.gravity) * scene.speed * depth,
      size: scene.size * (scene.kind === 'spark' ? 0.35 + Math.random() * 0.5 : 0.4 + Math.random() * 0.9) * depth,
      phase: Math.random() * TAU,
      depth,
      spin: (Math.random() - 0.5) * 0.03,
      color: rgba(mix(scene.palette, BUCKET_STOPS[bucket] ?? 0.5), 1),
      bucket,
      alpha: baseAlpha(scene.kind) * depth
    })
  }
  return particles
}

/** A ribbon is a full-width wave, so its gradient is built once in local coordinates per bucket. */
function buildRibbonGradients(context: CanvasRenderingContext2D, scene: ParticleScene, width: number): (CanvasGradient | null)[] {
  return BUCKET_STOPS.map((stop) => {
    const gradient = context.createLinearGradient(0, -90, width, 90)
    const color = mix(scene.palette, stop)
    gradient.addColorStop(0, 'transparent')
    gradient.addColorStop(0.5, rgba(color, 0.9))
    gradient.addColorStop(1, 'transparent')
    return gradient
  })
}

export function ParticleField({
  scenes,
  countCap,
  frameRate
}: {
  scenes: ParticleScene[]
  countCap?: number
  /** Overrides the tier ceiling; a miniature in a grid wants 30 even on a machine that can do 60. */
  frameRate?: number
}): ReactNode {
  const { budget, reduced } = useMotion()
  const [canvasRef, onScreen] = useAmbientActive<HTMLCanvasElement>()
  const allowed = countCap === undefined ? budget.particles : Math.min(budget.particles, countCap)
  // The budget is split across the scenes by request weight, so adding ash cannot starve the embers.
  const wanted = scenes.reduce((total, scene) => total + scene.density, 0)
  const counts = scenes.map((scene) =>
    clampParticles(scene.density, { ...budget, particles: allowed === 0 ? 0 : Math.max(1, Math.round((allowed * scene.density) / Math.max(1, wanted))) })
  )
  const total = counts.reduce((sum, count) => sum + count, 0)
  const cap = frameRate ?? budget.frameRate
  // A string, not the arrays: the effect has to restart when the field actually changes, and
  // `scenes`/`counts` are new arrays on every render.
  const spec = `${scenes.map((scene) => scene.kind).join(',')}|${counts.join(',')}`

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || total === 0 || reduced || !onScreen) return

    const context = canvas.getContext('2d', { alpha: true })
    if (!context) return

    let width = canvas.clientWidth
    let height = canvas.clientHeight
    let passes: Pass[] = []
    let time = 0

    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      passes = scenes.flatMap((scene, index) => {
        const count = counts[index] ?? 0
        if (count <= 0) return []
        const usesSprite = scene.kind !== 'ash' && scene.kind !== 'ribbon'
        const glow = scene.kind === 'ember' || scene.kind === 'spark'
        return [
          {
            scene,
            particles: seed(scene, count, width, height),
            sprites: usesSprite ? BUCKET_STOPS.map((stop) => buildSprite(mix(scene.palette, stop), glow)) : [],
            ribbonGradients: scene.kind === 'ribbon' ? buildRibbonGradients(context, scene, width) : [],
            additive: scene.kind === 'ember' || scene.kind === 'spark',
            usesSprite
          }
        ]
      })
    }

    resize()
    window.addEventListener('resize', resize)

    const drawRibbon = (pass: Pass, particle: Particle): void => {
      const gradient = pass.ribbonGradients[particle.bucket] ?? null
      if (!gradient) return
      const scene = pass.scene
      context.strokeStyle = gradient
      context.globalAlpha = 0.16 * particle.depth
      context.lineWidth = scene.size * 2.2
      context.beginPath()
      // Local coordinates: the cached gradient is only valid for this band, so the path is drawn
      // around y = 0 and the transform carries it to the ribbon.
      context.save()
      context.translate(0, particle.y)
      for (let x = 0; x <= width; x += 40) {
        const y = Math.sin(x / 220 + time / 900 + particle.phase) * (26 + particle.depth * 34)
        if (x === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.stroke()
      context.restore()
    }

    const drawPass = (pass: Pass, step: number): void => {
      const { scene, particles } = pass
      context.globalCompositeOperation = pass.additive ? 'lighter' : 'source-over'

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index]
        if (!particle) continue

        // Ash and embers sway on different clocks: the embers are kicked by the fire below, the ash
        // falls through still air and only drifts.
        const sway = (scene.kind === 'ash' ? Math.sin(time / 2600 + particle.phase) * 0.22 : Math.sin(time / 1400 + particle.phase) * 0.12) * step
        particle.x += (particle.vx + sway) * step
        particle.y += particle.vy * step
        if (scene.kind === 'spark') particle.vy += 0.004 * scene.speed * step

        if (particle.y < -20) particle.y = height + 20
        if (particle.y > height + 20) particle.y = -20
        if (particle.x < -20) particle.x = width + 20
        if (particle.x > width + 20) particle.x = -20

        if (scene.kind === 'ribbon') {
          drawRibbon(pass, particle)
          continue
        }

        const sprite = pass.sprites[particle.bucket] ?? null
        if (sprite) {
          const flicker = scene.twinkle || pass.additive ? 0.55 + Math.abs(Math.sin(time / 190 + particle.phase)) * 0.45 : 1
          const radius = particle.size * (2.5 + Math.sin(time / 330 + particle.phase) * 0.3)
          const alpha = particle.alpha * flicker
          if (budget.glow && pass.additive) {
            context.globalAlpha = alpha * 0.32
            context.drawImage(sprite, particle.x - radius * 1.8, particle.y - radius * 1.8, radius * 3.6, radius * 3.6)
          }
          context.globalAlpha = alpha
          context.drawImage(sprite, particle.x - radius, particle.y - radius, radius * 2, radius * 2)
          if (scene.kind === 'spark') {
            // A spark is a streak, not a dot: the head glows and the tail marks where it came from.
            context.globalAlpha = alpha * 0.4
            context.strokeStyle = particle.color
            context.lineWidth = Math.max(0.4, particle.size * 0.5)
            context.beginPath()
            context.moveTo(particle.x, particle.y)
            context.lineTo(particle.x - particle.vx * 26, particle.y - particle.vy * 26)
            context.stroke()
          }
          continue
        }

        if (scene.kind === 'ash') {
          // A tumbling flake: a rotated sliver that changes width as it turns, so it never reads as a
          // rising-dot recolour.
          const turn = Math.abs(Math.sin(time / 900 + particle.phase))
          context.globalAlpha = particle.alpha
          context.fillStyle = particle.color
          context.save()
          context.translate(particle.x, particle.y)
          context.rotate(particle.phase + time * particle.spin)
          context.fillRect(-particle.size, -particle.size * 0.35, particle.size * 2, particle.size * (0.35 + turn * 0.5))
          context.restore()
        }
      }
    }

    const tick = (_nowMs: number, deltaMs: number): void => {
      time += deltaMs
      context.clearRect(0, 0, width, height)
      for (const pass of passes) drawPass(pass, deltaMs / 16.667)
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 1
    }

    const unsubscribe = subscribeToTicker(tick, cap)

    return () => {
      unsubscribe()
      window.removeEventListener('resize', resize)
    }
  }, [spec, total, reduced, onScreen, cap, budget.glow, canvasRef])

  if (total === 0 || reduced) return null

  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
}
