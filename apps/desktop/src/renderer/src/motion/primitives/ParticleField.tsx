import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { clampParticles, type ParticleScene } from '@tds/shared'
import { useMotion } from '../context'

/**
 * The skin's living layer: one canvas, one rAF loop, one particle array.
 *
 * Deliberately canvas instead of DOM/CSS: a hundred animated elements would each cost a layout and
 * paint, while this is a single composited surface. It also stops completely when the window is
 * hidden or the machine is on the low tier - the app sits over a game, and a background animation
 * that steals frames from it is a bug, not a feature.
 */

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  phase: number
  depth: number
}

const TAU = Math.PI * 2

function seed(scene: ParticleScene, count: number, width: number, height: number): Particle[] {
  const particles: Particle[] = []
  for (let index = 0; index < count; index += 1) {
    const depth = scene.kind === 'star' ? 0.25 + (index % 3) * 0.35 : 0.4 + Math.random() * 0.6
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.18 * scene.speed,
      vy: (scene.gravity === 0 ? (Math.random() - 0.5) * 0.16 : -scene.gravity) * scene.speed * depth,
      size: scene.size * (0.4 + Math.random() * 0.9) * depth,
      phase: Math.random() * TAU,
      depth
    })
  }
  return particles
}

function mix(palette: [string, string], t: number): string {
  // Both entries are hex colors from the registry; a cheap lerp keeps the canvas free of parsing.
  const toRgb = (hex: string): [number, number, number] => {
    const value = hex.replace('#', '')
    const full = value.length === 3 ? value.split('').map((char) => `${char}${char}`).join('') : value
    const int = Number.parseInt(full.slice(0, 6), 16)
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
  }
  const a = toRgb(palette[0])
  const b = toRgb(palette[1])
  const channel = (index: 0 | 1 | 2): number => {
    const from = a[index] ?? 0
    const to = b[index] ?? 0
    return Math.round(from + (to - from) * t)
  }
  return `rgb(${String(channel(0))}, ${String(channel(1))}, ${String(channel(2))})`
}

export function ParticleField({ scene, countCap }: { scene: ParticleScene | null; countCap?: number }): ReactNode {
  const { budget, reduced } = useMotion()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const allowed = countCap === undefined ? budget.particles : Math.min(budget.particles, countCap)
  const count = scene ? clampParticles(scene.density, { ...budget, particles: allowed }) : 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !scene || count === 0 || reduced) return

    const context = canvas.getContext('2d', { alpha: true })
    if (!context) return

    let width = canvas.clientWidth
    let height = canvas.clientHeight
    let particles = seed(scene, count, width, height)
    let frame = 0
    let running = true
    let time = 0

    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      particles = seed(scene, count, width, height)
    }

    resize()
    window.addEventListener('resize', resize)

    // One cached radial sprite for every ember: a soft hot core reads as fire, while a flat circle
    // reads as a dot. drawImage is cheaper than building a gradient per particle per frame.
    const emberSprite = ((): HTMLCanvasElement | null => {
      if (scene.kind !== 'ember') return null
      const sprite = document.createElement('canvas')
      sprite.width = 64
      sprite.height = 64
      const paint = sprite.getContext('2d')
      if (!paint) return null
      const gradient = paint.createRadialGradient(32, 32, 0, 32, 32, 32)
      gradient.addColorStop(0, '#fff7e6')
      gradient.addColorStop(0.24, scene.palette[1])
      gradient.addColorStop(0.58, scene.palette[0])
      gradient.addColorStop(1, 'rgba(255, 90, 31, 0)')
      paint.fillStyle = gradient
      paint.fillRect(0, 0, 64, 64)
      return sprite
    })()

    const drawRibbon = (particle: Particle, index: number): void => {
      const gradient = context.createLinearGradient(0, particle.y - 90, width, particle.y + 90)
      gradient.addColorStop(0, 'transparent')
      gradient.addColorStop(0.5, mix(scene.palette, (index % 5) / 5))
      gradient.addColorStop(1, 'transparent')
      context.strokeStyle = gradient
      context.globalAlpha = 0.16 * particle.depth
      context.lineWidth = scene.size * 2.2
      context.beginPath()
      for (let x = 0; x <= width; x += 24) {
        const y = particle.y + Math.sin(x / 220 + time / 900 + particle.phase) * (26 + particle.depth * 34)
        if (x === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.stroke()
    }

    const step = (): void => {
      if (!running) return
      time += 16
      context.clearRect(0, 0, width, height)

      // Additive merging is what makes overlapping embers glow instead of stacking as flat dots.
      if (emberSprite) context.globalCompositeOperation = 'lighter'

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index]
        if (!particle) continue

        particle.x += particle.vx + Math.sin(time / 1400 + particle.phase) * 0.12
        particle.y += particle.vy

        if (particle.y < -20) particle.y = height + 20
        if (particle.y > height + 20) particle.y = -20
        if (particle.x < -20) particle.x = width + 20
        if (particle.x > width + 20) particle.x = -20

        if (scene.kind === 'ribbon') {
          drawRibbon(particle, index)
          continue
        }

        if (emberSprite) {
          const flicker = 0.55 + Math.abs(Math.sin(time / 190 + particle.phase)) * 0.45
          const radius = particle.size * (2.5 + Math.sin(time / 330 + particle.phase) * 0.3)
          const alpha = 0.62 * particle.depth * flicker
          if (budget.glow) {
            context.globalAlpha = alpha * 0.32
            context.drawImage(emberSprite, particle.x - radius * 1.8, particle.y - radius * 1.8, radius * 3.6, radius * 3.6)
          }
          context.globalAlpha = alpha
          context.drawImage(emberSprite, particle.x - radius, particle.y - radius, radius * 2, radius * 2)
          continue
        }

        const twinkle = scene.twinkle ? 0.45 + Math.abs(Math.sin(time / 700 + particle.phase)) * 0.55 : 1
        context.globalAlpha = (scene.kind === 'dust' ? 0.22 : 0.5) * particle.depth * twinkle
        context.fillStyle = mix(scene.palette, particle.depth)

        if (scene.kind === 'spore' && budget.glow) {
          context.shadowBlur = 10
          context.shadowColor = scene.palette[0]
        } else {
          context.shadowBlur = 0
        }

        context.beginPath()
        context.arc(particle.x, particle.y, particle.size, 0, TAU)
        context.fill()
      }

      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 1
      context.shadowBlur = 0
      frame = window.requestAnimationFrame(step)
    }

    const pause = (): void => {
      running = false
      window.cancelAnimationFrame(frame)
    }

    const resume = (): void => {
      if (running) return
      running = true
      frame = window.requestAnimationFrame(step)
    }

    const onVisibility = (): void => (document.hidden ? pause() : resume())
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', pause)
    window.addEventListener('focus', resume)

    frame = window.requestAnimationFrame(step)

    return () => {
      pause()
      window.removeEventListener('resize', resize)
      window.removeEventListener('blur', pause)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [scene, count, reduced, budget.glow])

  if (!scene || count === 0 || reduced) return null

  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
}
