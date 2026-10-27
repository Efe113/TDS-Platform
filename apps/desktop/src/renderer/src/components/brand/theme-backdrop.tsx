import type { CSSProperties, ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { Transition } from 'framer-motion'
import { isStillLayer, storageUrl, type AmbientLayer, type ParticleScene, type ThemeSkin } from '@tds/shared'
import { useMotion } from '../../motion/context'
import { drift } from '../../motion/presets'
import { ParticleField } from '../../motion/primitives/ParticleField'
import { CursorGlow } from '../../motion/primitives/CursorGlow'
import { SUPABASE_BASE_URL } from '../../lib/storage-base'

/**
 * The skin's backdrop, assembled from the layers the skin declares.
 *
 * Layer order matters and is chosen per skin: the first entry is the signature effect, so a machine
 * that can only afford one layer still gets an ember window that visibly moves heat, not a generic
 * glow. Layers that only paint (`vignette`, `grain`, `grid`) are exempt from the tier's budget -
 * they cost nothing per frame and cutting them would take legibility away from weak machines.
 *
 * The rule this file exists to enforce: **a moving surface must move on transform or opacity only**.
 * No `filter: blur()` and no `mix-blend-mode` on anything that animates, and no animated
 * `background-position` either — all three re-rasterize the surface on every frame it moves, which is
 * the frame the game underneath wanted. Softness comes from gradient stops instead, and a pattern that
 * needs to crawl is drawn as an oversized sheet that translates by exactly one period.
 *
 * Big surfaces are the expensive ones, so each data table below says which of its entries move
 * (`live`) and which only hold the shape. A miniature cuts that further to a single mover.
 */

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")"

/**
 * Six tongues of different heights and speeds, anchored to the floor so the fire never drifts
 * across the content. Half of them hold the shape while the others breathe: six full-height gradient
 * surfaces animating at once was the most expensive thing a window could ask for.
 */
interface FlameTongue {
  left: string
  width: string
  height: string
  duration: number
  delay: number
  live: boolean
}

const FLAME_TONGUES: FlameTongue[] = [
  { left: '-6%', width: '24%', height: '62%', duration: 7.8, delay: 0, live: true },
  { left: '12%', width: '20%', height: '46%', duration: 6.4, delay: 1.1, live: false },
  { left: '28%', width: '28%', height: '78%', duration: 9.2, delay: 0.4, live: true },
  { left: '48%', width: '22%', height: '52%', duration: 7.1, delay: 1.7, live: false },
  { left: '64%', width: '26%', height: '70%', duration: 8.6, delay: 0.8, live: true },
  { left: '84%', width: '24%', height: '48%', duration: 6.9, delay: 1.4, live: false }
]

interface Plume {
  left: string
  size: number
  duration: number
  delay: number
  live: boolean
}

const EMBER_SMOKE: Plume[] = [
  { left: '4%', size: 340, duration: 20, delay: 0, live: true },
  { left: '38%', size: 440, duration: 26, delay: 5, live: true },
  { left: '72%', size: 300, duration: 22, delay: 9, live: false }
]

interface Bubble {
  left: string
  size: number
  duration: number
  delay: number
}

const TOXIC_BUBBLES: Bubble[] = [
  { left: '5%', size: 18, duration: 13, delay: 0 },
  { left: '17%', size: 30, duration: 17, delay: 2.4 },
  { left: '33%', size: 14, duration: 11, delay: 4.1 },
  { left: '51%', size: 24, duration: 15, delay: 1.2 },
  { left: '65%', size: 12, duration: 10, delay: 5.3 },
  { left: '78%', size: 34, duration: 19, delay: 3.2 },
  { left: '90%', size: 20, duration: 14, delay: 6.1 },
  { left: '26%', size: 9, duration: 9, delay: 7.4 },
  { left: '44%', size: 38, duration: 21, delay: 8.6 },
  { left: '72%', size: 11, duration: 12, delay: 9.8 }
]

/**
 * The coal bed. Every chip carries its own clock, size and depth so the floor cools in places instead
 * of blinking as one sheet. Three of them are flare pops: a coal that catches, not the whole fire.
 * Chips are a few pixels wide, so fourteen of them cost nothing - it is the full-window surfaces that
 * have to be rationed.
 */
interface Coal {
  left: string
  bottom: string
  size: number
  duration: number
  delay: number
  hot: boolean
  flare?: boolean
}

const FORGE_COALS: Coal[] = [
  { left: '3%', bottom: '1%', size: 7, duration: 5.4, delay: 0, hot: true },
  { left: '9%', bottom: '4%', size: 4, duration: 3.8, delay: 1.2, hot: false },
  { left: '16%', bottom: '0%', size: 9, duration: 6.6, delay: 0.6, hot: true },
  { left: '23%', bottom: '6%', size: 3, duration: 2.9, delay: 2.1, hot: false, flare: true },
  { left: '31%', bottom: '2%', size: 6, duration: 4.7, delay: 0.3, hot: true },
  { left: '38%', bottom: '8%', size: 4, duration: 5.9, delay: 1.8, hot: false },
  { left: '46%', bottom: '1%', size: 10, duration: 7.2, delay: 0.9, hot: true },
  { left: '54%', bottom: '5%', size: 5, duration: 4.1, delay: 2.6, hot: true },
  { left: '61%', bottom: '0%', size: 8, duration: 6.1, delay: 0.2, hot: false },
  { left: '68%', bottom: '7%', size: 3, duration: 3.3, delay: 1.5, hot: true, flare: true },
  { left: '75%', bottom: '2%', size: 7, duration: 5.1, delay: 0.8, hot: true },
  { left: '83%', bottom: '5%', size: 4, duration: 4.4, delay: 2.9, hot: false },
  { left: '90%', bottom: '1%', size: 9, duration: 6.8, delay: 0.4, hot: true },
  { left: '96%', bottom: '6%', size: 3, duration: 3.1, delay: 1.9, hot: true, flare: true }
]

/** Four bands at different widths and speeds, so the shimmer never reads as one moving stripe. */
interface Band {
  left: string
  width: string
  height: number
  duration: number
  delay: number
  live: boolean
}

const HEAT_BANDS: Band[] = [
  { left: '-6%', width: '58%', height: 220, duration: 9.5, delay: 0, live: true },
  { left: '34%', width: '44%', height: 300, duration: 12.5, delay: 2.2, live: true },
  { left: '62%', width: '52%', height: 250, duration: 10.5, delay: 4.1, live: false },
  { left: '12%', width: '38%', height: 180, duration: 8.5, delay: 6, live: false }
]

/**
 * Ooze strands hanging from the ceiling. Each one sheds a drop on its own clock: a leak that drips in
 * step reads as a loop, and a loop is what this skin was before.
 */
interface Strand {
  left: string
  width: number
  length: number
  delay: number
  duration: number
}

const TOXIC_DRIPS: Strand[] = [
  { left: '6%', width: 5, length: 96, delay: 0.4, duration: 6.2 },
  { left: '19%', width: 3, length: 58, delay: 2.8, duration: 5.1 },
  { left: '34%', width: 6, length: 132, delay: 1.2, duration: 7.4 },
  { left: '52%', width: 4, length: 76, delay: 3.9, duration: 5.8 },
  { left: '68%', width: 7, length: 118, delay: 0.9, duration: 8.2 },
  { left: '84%', width: 3, length: 64, delay: 4.6, duration: 6.6 },
  { left: '94%', width: 5, length: 88, delay: 2.1, duration: 6.9 }
]

/** Blowholes in the acid pool: where the churn visibly vents. */
interface Vent {
  left: string
  size: number
  duration: number
  delay: number
}

const TOXIC_VENTS: Vent[] = [
  { left: '14%', size: 120, duration: 7.5, delay: 0 },
  { left: '46%', size: 170, duration: 9.5, delay: 2.4 },
  { left: '76%', size: 130, duration: 8.5, delay: 4.2 }
]

/**
 * Five curtains, each leaning its own way and waving on its own clock. A single sine for all of them is
 * what made the old aurora look like one wallpaper stripe; the hue alternates so the sky reads as
 * several gases, the way a real polar display does. Three of them move - the rest hold a column of
 * light so the sky stays full while only three surfaces composite.
 */
interface Curtain {
  left: string
  width: string
  tilt: number
  duration: number
  delay: number
  hue: number
  live: boolean
}

const AURORA_CURTAINS: Curtain[] = [
  { left: '-8%', width: '30%', tilt: -8, duration: 16, delay: 0, hue: 0, live: true },
  { left: '16%', width: '24%', tilt: 6, duration: 13, delay: 2.5, hue: 1, live: true },
  { left: '38%', width: '32%', tilt: -4, duration: 19, delay: 1.2, hue: 0, live: true },
  { left: '62%', width: '22%', tilt: 9, duration: 14, delay: 4.4, hue: 1, live: false },
  { left: '78%', width: '30%', tilt: -6, duration: 17, delay: 2, hue: 0, live: false }
]

/**
 * The gas clouds of a void, at three depths. Depth is the whole idea: two clouds moving at the same
 * rate read as one wash, while three at different rates read as distance.
 */
interface Cloud {
  left: string
  top: string
  size: string
  duration: number
  delay: number
  tone: 'brand' | 'warn' | 'good'
  live: boolean
}

const VOID_CLOUDS: Cloud[] = [
  { left: '-12%', top: '4%', size: '58%', duration: 34, delay: 0, tone: 'brand', live: true },
  { left: '42%', top: '38%', size: '46%', duration: 46, delay: 4, tone: 'warn', live: true },
  { left: '16%', top: '58%', size: '38%', duration: 58, delay: 9, tone: 'good', live: false }
]

/** Three elliptical paths, one body each, at three rates - a solar clock, not a spinner. */
const VOID_ORBITS = [
  { size: '46%', duration: 26, squash: 0.34, tone: 'warn', delay: 0 },
  { size: '66%', duration: 41, squash: 0.26, tone: 'brand', delay: 6 },
  { size: '88%', duration: 64, squash: 0.4, tone: 'good', delay: 13 }
] as const

interface Ambient {
  animate?: Record<string, (number | string)[]>
  transition?: Transition
}

/**
 * The one place that decides whether a surface moves. A miniature keeps exactly one mover per layer,
 * which is enough to show what the layer does; a frozen machine keeps none and the static style the
 * layer was designed around.
 */
function mover(live: boolean, compact: boolean, index: number, animate: Record<string, (number | string)[]>, duration: number, delay: number): Ambient {
  return live && (!compact || index === 0)
    ? { animate, transition: { duration, delay, repeat: Infinity, ease: 'easeInOut' } }
    : {}
}

function Layer({ skin, name, still, compact, frozen }: { skin: ThemeSkin; name: AmbientLayer; still: boolean; compact: boolean; frozen: boolean }): ReactNode {
  const { budget } = useMotion()
  const animation = drift(budget, 60)
  const tokens = skin.tokens

  if (name === 'curtain') {
    // The curtain is the signature: vertical light, a mask that fades it into the sky, and a striation
    // texture that stays static (a crawling texture would re-rasterize a third of the window per frame).
    return (
      <span className="absolute inset-x-0 top-0 h-[78%]">
        {AURORA_CURTAINS.map((curtain, index) => {
          const hue = curtain.hue === 0 ? tokens.brand : tokens.warn
          const soft = curtain.hue === 0 ? skin.glow[0] : skin.glow[1]
          return (
            <motion.span
              key={curtain.left}
              className="aurora-curtain absolute -top-[12%] origin-top"
              style={
                {
                  left: curtain.left,
                  width: curtain.width,
                  height: '84%',
                  background: `linear-gradient(to bottom, ${soft}, transparent 78%)`,
                  ['--aurora-hue' as string]: hue,
                  opacity: curtain.live ? 0.5 : 0.32
                } as CSSProperties
              }
              {...mover(curtain.live && !frozen, compact, index, {
                skewX: [curtain.tilt, -curtain.tilt, curtain.tilt / 2, curtain.tilt],
                scaleY: [1, 1.12, 0.96, 1.06, 1],
                opacity: [0.34, 0.62, 0.42, 0.58, 0.34]
              }, curtain.duration, curtain.delay)}
            />
          )
        })}
      </span>
    )
  }

  if (name === 'horizon') {
    // A polar night is lit from below: the ice carries the glow, and the line between them stays crisp.
    return (
      <span className="absolute inset-x-0 bottom-0 h-[38%]">
        <span
          className="absolute inset-x-0 bottom-0 h-full"
          style={{ background: `linear-gradient(to top, ${skin.glow[1]}, transparent 62%)`, opacity: 0.5 }}
        />
        <span
          className="absolute inset-x-0 h-px"
          style={{
            bottom: compact ? '18%' : '30%',
            background: `linear-gradient(90deg, transparent, ${tokens.brand} 22%, ${tokens.good} 50%, ${tokens.warn} 78%, transparent)`,
            opacity: 0.55
          }}
        />
        {[0, 1].map((index) => (
          <motion.span
            key={index}
            className="absolute bottom-[18%] size-56 rounded-full"
            style={{
              left: index === 0 ? '8%' : '58%',
              background: `radial-gradient(circle, ${index === 0 ? tokens.brand : tokens.warn} 0%, transparent 62%)`,
              opacity: 0.2
            }}
            {...mover(!frozen, compact, index, { x: [0, index === 0 ? 60 : -60, 0], opacity: [0.14, 0.3, 0.18, 0.28, 0.14] }, skin.motion.cycleSeconds * (1.2 + index * 0.4), 0)}
          />
        ))}
      </span>
    )
  }

  if (name === 'crucible') {
    // The bath breathes on transform/opacity only and the seam is a sheet that translates by one
    // period, so the signature layer costs no rasterization.
    return (
      <span className="absolute inset-x-0 bottom-0 h-[46%]">
        <motion.span
          className="absolute inset-x-[-12%] bottom-0 h-[30%]"
          style={{
            background: `linear-gradient(to top, ${tokens.warn}, ${tokens.brand} 34%, transparent)`,
            transformOrigin: '50% 100%',
            opacity: 0.5
          }}
          {...mover(!frozen, compact, 0, { scaleY: [1, 1.16, 1.05, 1.2, 1], opacity: [0.4, 0.62, 0.48, 0.64, 0.4] }, skin.motion.cycleSeconds, 0)}
        />
        <span className="forge-seam absolute inset-x-0" style={{ bottom: compact ? '16%' : '26%' }} />
        <span
          className="absolute inset-x-0 bottom-0 h-[18%]"
          style={{ background: `linear-gradient(to top, ${skin.glow[0]}, transparent 78%)`, opacity: 0.55 }}
        />
        {[0, 1].map((index) => (
          <motion.span
            key={index}
            className="absolute bottom-[14%] size-40 rounded-full"
            style={{
              left: index === 0 ? '12%' : '62%',
              background: `radial-gradient(circle, ${tokens.warn} 0%, transparent 64%)`,
              opacity: 0.3
            }}
            {...mover(!frozen, compact, index, { scale: [0.9, 1.25, 0.95, 1.15, 0.9], opacity: [0.22, 0.4, 0.26, 0.38, 0.22] }, skin.motion.cycleSeconds * (1.3 + index * 0.5), 0)}
          />
        ))}
      </span>
    )
  }

  if (name === 'coals') {
    const coals = compact ? FORGE_COALS.filter((coal) => coal.hot || coal.flare) : FORGE_COALS
    return (
      <span className="absolute inset-x-0 bottom-0 h-[30%]">
        {coals.map((coal) => (
          <span
            key={coal.left}
            className={coal.flare ? 'forge-coal forge-coal--flare' : 'forge-coal'}
            style={
              {
                left: coal.left,
                bottom: coal.bottom,
                width: compact ? coal.size * 0.6 : coal.size,
                height: compact ? coal.size * 0.6 : coal.size,
                background: coal.hot ? tokens.warn : tokens.brand,
                ['--coal-duration']: `${String(coal.duration)}s`,
                ['--coal-delay']: `${String(coal.delay)}s`
              } as CSSProperties
            }
          />
        ))}
      </span>
    )
  }

  if (name === 'shimmer') {
    if (frozen) return null
    return (
      <span className="absolute inset-0 overflow-hidden">
        {HEAT_BANDS.map((band, index) => (
          <motion.span
            key={band.left}
            className="absolute bottom-[-30%] rounded-full"
            style={{
              left: band.left,
              width: band.width,
              height: compact ? band.height * 0.4 : band.height,
              background: `linear-gradient(to top, ${skin.glow[1]}, transparent 72%)`,
              opacity: band.live ? 0.7 : 0.35
            }}
            {...mover(band.live, compact, index, { y: [0, -((compact ? 60 : 260) + index * 24)], scaleX: [1, 1.14, 0.94, 1.08, 1], opacity: [0, 0.6, 0.45, 0] }, (compact ? band.duration * 0.5 : band.duration), band.delay)}
          />
        ))}
      </span>
    )
  }

  if (name === 'sludge') {
    // The pool is the signature layer, so it survives to the low tier: still a churning acid floor.
    return (
      <span className="absolute inset-x-0 bottom-0 h-[42%]">
        <motion.span
          className="absolute inset-x-[-10%] bottom-0 h-[26%]"
          style={{
            background: `linear-gradient(to top, ${tokens.brand}, ${tokens.brandSoft} 58%, transparent)`,
            transformOrigin: '50% 100%',
            opacity: 0.46
          }}
          {...mover(!frozen, compact, 0, { scaleY: [1, 1.14, 1.02, 1.18, 1], opacity: [0.36, 0.56, 0.42, 0.58, 0.36] }, skin.motion.cycleSeconds, 0)}
        />
        <span className="toxic-foam absolute inset-x-0" style={{ bottom: compact ? '15%' : '25%' }} />
        {TOXIC_VENTS.map((vent, index) => (
          <motion.span
            key={vent.left}
            className="absolute bottom-[16%] rounded-full"
            style={{
              left: vent.left,
              width: compact ? vent.size * 0.4 : vent.size,
              height: compact ? vent.size * 0.4 : vent.size,
              background: `radial-gradient(circle, ${tokens.warn} 0%, transparent 62%)`,
              opacity: 0.22
            }}
            {...mover(!frozen, compact, index, { scale: [0.8, 1.3, 0.9, 1.2, 0.8], opacity: [0.14, 0.34, 0.2, 0.3, 0.14], y: [0, -12, -4, -18, 0] }, vent.duration, vent.delay)}
          />
        ))}
        <span
          className="absolute inset-x-0 bottom-0 h-[60%]"
          style={{ background: `linear-gradient(to top, ${skin.glow[1]}, transparent 72%)`, opacity: 0.5 }}
        />
      </span>
    )
  }

  if (name === 'drip') {
    // CSS keyframes rather than seven motion components: the drops fall forever and a background
    // thread should not cost a JS tick per drop.
    if (frozen) return null
    const strands = compact ? TOXIC_DRIPS.slice(0, 3) : TOXIC_DRIPS
    return (
      <span className="absolute inset-x-0 top-0 h-[70%]">
        {strands.map((strand) => {
          const length = compact ? strand.length * 0.35 : strand.length
          return (
            <span
              key={strand.left}
              className="absolute top-0"
              style={
                {
                  left: strand.left,
                  width: strand.width,
                  ['--strand-duration']: `${String(strand.duration)}s`,
                  ['--drop-delay']: `${String(strand.delay)}s`,
                  ['--drop-duration']: `${String(strand.duration * 0.55)}s`,
                  ['--drop-fall']: compact ? '16vh' : '44vh'
                } as CSSProperties
              }
            >
              <span
                className="toxic-strand"
                style={{
                  width: strand.width,
                  height: length,
                  background: `linear-gradient(to bottom, ${tokens.brandSoft}, ${tokens.brand} 62%, ${tokens.warn})`
                }}
              />
              <span
                className="toxic-drop"
                style={{ width: strand.width * 1.7, height: strand.width * 2.1, background: tokens.warn }}
              />
            </span>
          )
        })}
      </span>
    )
  }

  if (name === 'flames') {
    return (
      <span className="absolute inset-x-0 bottom-0 h-[55%]">
        <span
          className="absolute inset-x-0 bottom-0 h-3/5"
          style={{ background: `radial-gradient(ellipse 62% 100% at 50% 100%, ${skin.glow[0]}, transparent 72%)` }}
        />
        {FLAME_TONGUES.map((tongue, index) => (
          <motion.span
            key={tongue.left}
            className="absolute bottom-0"
            style={{
              left: tongue.left,
              width: tongue.width,
              height: tongue.height,
              transformOrigin: '50% 100%',
              background: `radial-gradient(ellipse 54% 62% at 50% 94%, ${tokens.warn} 0%, ${tokens.brand} 42%, transparent 76%)`,
              borderRadius: '50% 50% 18% 18% / 72% 72% 28% 28%',
              opacity: tongue.live ? 0.42 : 0.3
            }}
            {...mover(tongue.live && !frozen, compact, index, {
              scaleY: [0.9, 1.08, 0.95, 1.05, 0.9],
              scaleX: [1, 0.94, 1.04, 0.97, 1],
              opacity: [0.3, 0.55, 0.38, 0.5, 0.3],
              skewX: [-2, 2, -1, 1.5, -2]
            }, tongue.duration, tongue.delay)}
          />
        ))}
        <span
          className="absolute inset-x-0 bottom-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent, ${tokens.brand}, ${tokens.warn}, ${tokens.brand}, transparent)`,
            opacity: 0.6
          }}
        />
      </span>
    )
  }

  if (name === 'accretion') {
    // The disc that feeds the hole. The gradient is baked into a circular sheet that turns on the
    // compositor inside a static annulus mask - the mask never moves, so the shape of the window and
    // of a squared avatar stay put while the light runs round them.
    const center = compact ? { left: '54%', top: '16%', size: '58%' } : { left: '56%', top: '12%', size: '42%' }
    return (
      <span
        className="void-accretion absolute"
        style={{
          left: center.left,
          top: center.top,
          width: center.size,
          aspectRatio: '1',
          ['--void-a' as string]: tokens.brand,
          ['--void-b' as string]: tokens.warn,
          ['--void-c' as string]: tokens.ink
        } as CSSProperties}
      >
        <span className="void-accretion-disc" style={{ animationDuration: `${String(compact ? 18 : 34)}s` }} />
      </span>
    )
  }

  if (name === 'singularity') {
    // The hole itself: a dark core that eats the backdrop and a photon hairline that breathes on it.
    return (
      <motion.span
        className="void-core absolute rounded-full"
        style={{
          left: compact ? '54%' : '56%',
          top: compact ? '16%' : '12%',
          width: compact ? '58%' : '42%',
          aspectRatio: '1',
          background: `radial-gradient(circle, ${tokens.base} 0%, ${tokens.base} 34%, transparent 62%)`
        }}
        {...mover(!frozen, compact, 0, { opacity: [0.86, 1, 0.9, 0.98, 0.86] }, skin.motion.cycleSeconds * 1.4, 0)}
      />
    )
  }

  if (name === 'nebula') {
    return (
      <span className="absolute inset-0">
        {VOID_CLOUDS.map((cloud, index) => {
          const tone = tokens[cloud.tone]
          return (
            <motion.span
              key={cloud.left}
              className="absolute rounded-full"
              style={{
                left: cloud.left,
                top: cloud.top,
                width: cloud.size,
                aspectRatio: '1',
                background: `radial-gradient(circle at 40% 40%, ${tone} 0%, transparent 58%)`,
                opacity: 0.16 + index * 0.04
              }}
              {...mover(cloud.live && !frozen, compact, index, { x: [0, 42 - index * 26, -18 + index * 12, 0], y: [0, -26 + index * 18, 14 - index * 8, 0], scale: [1, 1.06, 0.98, 1.03, 1] }, cloud.duration, cloud.delay)}
            />
          )
        })}
      </span>
    )
  }

  if (name === 'orbits') {
    // Three paths, three rates, one body per path: a solar clock. The rings are static hairlines and
    // only the body sheets turn, so the layer costs three composited circles.
    return (
      <span
        className="void-orbits absolute"
        style={{
          left: compact ? '54%' : '56%',
          top: compact ? '16%' : '12%',
          width: compact ? '92%' : '72%',
          aspectRatio: '1',
          ['--void-a' as string]: tokens.brand,
          ['--void-b' as string]: tokens.warn,
          ['--void-c' as string]: tokens.good
        } as CSSProperties}
      >
        {VOID_ORBITS.map((orbit, index) => (
          <span
            key={orbit.size}
            className="void-orbit"
            style={
              {
                width: orbit.size,
                ['--orbit-squash']: String(orbit.squash),
                ['--orbit-tone']: tokens[orbit.tone]
              } as CSSProperties
            }
          >
            <span
              className="void-orbit-body"
              style={{ animationDuration: `${String(orbit.duration)}s`, animationDelay: `${String(-orbit.delay)}s` }}
            />
          </span>
        ))}
      </span>
    )
  }

  if (name === 'rift') {
    // A tear with light leaking out of it: the seam is static, the leak slides along it on transform.
    return (
      <span className="rift absolute" style={{ ['--rift-tone' as string]: tokens.warn, ['--rift-edge' as string]: tokens.brand } as CSSProperties}>
        <span
          className="rift-leak"
          style={{ animationDuration: `${String(compact ? 9 : 18)}s` }}
        />
      </span>
    )
  }

  if (name === 'mesh') {
    return (
      <>
        <motion.span
          className="absolute -left-40 -top-48 size-[38rem] rounded-full"
          style={{ background: `radial-gradient(circle at 30% 30%, ${skin.glow[0]}, transparent 62%)` }}
          animate={frozen || !animation ? undefined : animation.animate}
          transition={animation?.transition}
        />
        <motion.span
          className="absolute -right-40 top-1/3 size-[34rem] rounded-full"
          style={{ background: `radial-gradient(circle at 70% 30%, ${skin.glow[1]}, transparent 62%)` }}
          animate={frozen || !animation ? undefined : animation.animate}
          transition={animation?.transition}
        />
      </>
    )
  }

  if (name === 'grid') {
    return (
      <span
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse 90% 70% at 50% 0%, #000 20%, transparent 72%)',
          opacity: 0.18
        }}
      />
    )
  }

  if (name === 'ribbons') {
    const count = compact ? 1 : 3
    return (
      <>
        {Array.from({ length: count }, (_, index) => index).map((index) => (
          <motion.span
            key={index}
            className="absolute inset-x-[-20%] h-56"
            style={{
              top: `${String(12 + index * 26)}%`,
              background: `linear-gradient(100deg, transparent, ${index % 2 === 0 ? skin.glow[0] : skin.glow[1]}, transparent)`,
              opacity: 0.5
            }}
            {...mover(!frozen, compact, index, { x: ['-8%', '8%', '-8%'], rotate: [-2 - index, 2 + index, -2 - index] }, skin.motion.cycleSeconds * (1 + index * 0.25), 0)}
          />
        ))}
      </>
    )
  }

  if (name === 'grain') {
    return <span className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: NOISE }} />
  }

  if (name === 'smoke') {
    if (frozen) return null
    return (
      <span className="absolute inset-0">
        {EMBER_SMOKE.map((plume, index) => {
          const size = compact ? plume.size * 0.35 : plume.size
          return (
            <motion.span
              key={plume.left}
              className="absolute rounded-full"
              style={{
                left: plume.left,
                bottom: '-12%',
                width: size,
                height: size,
                background: 'radial-gradient(circle at 50% 58%, rgba(82, 48, 34, 0.34), rgba(36, 22, 17, 0.18) 52%, transparent 72%)'
              }}
              {...mover(plume.live, compact, index, {
                y: [0, -((compact ? 46 : 190) + index * 16)],
                x: [0, index % 2 === 0 ? 26 : -22, 0],
                scale: [0.95, 1.12, 1.04, 1.18],
                opacity: [0, 0.55, 0.4, 0]
              }, compact ? plume.duration * 0.5 : plume.duration, plume.delay)}
            />
          )
        })}
      </span>
    )
  }

  if (name === 'bubbles') {
    // A still frame made of bubbles at the bottom would read as a bug, so a frozen machine skips the
    // layer entirely instead of freezing it mid-rise.
    if (frozen) return null
    const bubbles = compact ? TOXIC_BUBBLES.slice(0, 4) : TOXIC_BUBBLES
    return (
      <span className="absolute inset-0">
        {bubbles.map((bubble, index) => (
          <motion.span
            key={bubble.left}
            className="absolute rounded-full"
            style={{
              left: bubble.left,
              bottom: '-8%',
              width: bubble.size,
              height: bubble.size,
              border: '1px solid rgba(190, 242, 100, 0.22)',
              background: 'radial-gradient(circle at 34% 28%, rgba(217, 249, 157, 0.45), rgba(126, 217, 87, 0.14) 55%, transparent 72%)'
            }}
            {...mover(true, compact, index, {
              y: [0, -((compact ? 70 : 160) + bubble.size * 5)],
              x: [0, index % 2 === 0 ? 14 : -14, 0],
              // The bubble swells and bursts at the top of its rise instead of fading out.
              opacity: [0, 0.5, 0.58, 0.8, 0],
              scale: [0.8, 1, 1.08, 1.34, 1.55]
            }, compact ? bubble.duration * 0.55 : bubble.duration, bubble.delay)}
          />
        ))}
      </span>
    )
  }

  if (name === 'hazard') {
    // Two tapes in two corners, crawling opposite ways. Each tape is an oversized sheet of stripes
    // that translates by exactly one period of its own pattern, so the crawl is a compositor job.
    return (
      <span className="absolute inset-0 overflow-hidden">
        <span className="toxic-tape toxic-tape--a" />
        <span className="toxic-tape toxic-tape--b" />
      </span>
    )
  }

  if (name === 'scanline') {
    // One band is a screensaver; two bands crossing each other are an instrument. Both travel on
    // transform: `top` would re-layout the whole document sixty times a second.
    return (
      <>
        <span
          className="toxic-scan toxic-scan--broad"
          style={{
            background: `linear-gradient(to bottom, transparent, ${skin.glow[0]}, transparent)`,
            animationDuration: `${String(skin.motion.cycleSeconds * 1.6)}s`
          }}
        />
        <span
          className="toxic-scan toxic-scan--hair"
          style={{
            background: `linear-gradient(90deg, transparent, ${tokens.warn}, transparent)`,
            animationDuration: `${String(skin.motion.cycleSeconds * 2.4)}s`
          }}
        />
      </>
    )
  }

  return <span className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 40%, transparent 45%, rgba(0,0,0,0.55) 100%)' }} />
}

/**
 * The skin's layers on their own, so a preview inside a card can show the same thing the window
 * background does. The caller owns the positioned container.
 *
 * `cap` marks a miniature: fewer moving surfaces, a lower particle ceiling and a 30 fps field, because
 * five of these on one shelf used to cost more than the window behind them.
 */
export function SkinLayers({ skin, cap, active = true }: { skin: ThemeSkin; cap?: number; active?: boolean }): ReactNode {
  const reduced = useReducedMotion()
  const still = reduced === true
  const { budget } = useMotion()
  const compact = cap !== undefined
  // Three ways a surface stands still: the user asked for it, the machine cannot afford it, or nobody
  // can see it right now. Only the last one is temporary - a miniature scrolled out of view keeps its
  // layers mounted and painted, and gives back every frame it used to spend compositing them.
  const frozen = still || !budget.spin || !active
  const moving = skin.layers.filter((layer) => !isStillLayer(layer))
  const kept = compact ? moving.slice(0, Math.max(1, cap)) : moving.slice(0, Math.max(1, budget.ambientLayers))
  const layers = [...kept, ...skin.layers.filter(isStillLayer)]

  return (
    <>
      {layers.map((layer) => (
        <Layer key={layer} skin={skin} name={layer} still={still} compact={compact} frozen={frozen} />
      ))}
      <ParticleField
        scenes={[skin.scene, skin.sceneAlt].filter((entry): entry is ParticleScene => entry !== null)}
        countCap={compact ? Math.max(6, (cap ?? 2) * 4) : undefined}
        frameRate={compact ? Math.min(30, budget.frameRate) : budget.frameRate}
      />
    </>
  )
}

export function ThemeBackdrop({ skin, backgroundPath }: { skin: ThemeSkin; backgroundPath?: string | null }): ReactNode {
  const backgroundUrl =
    backgroundPath && SUPABASE_BASE_URL.length > 0 ? storageUrl(SUPABASE_BASE_URL, backgroundPath) : null

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <span className="absolute inset-0 bg-base" />
      {backgroundUrl ? (
        <>
          {/* CSS background rather than <img>: a failed or deleted object leaves no broken-image chrome. */}
          <span
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url("${backgroundUrl}")` }}
          />
          <span className="absolute inset-0 bg-base/55" />
        </>
      ) : null}
      <SkinLayers skin={skin} />
      <CursorGlow color={skin.glow[0]} />
    </div>
  )
}
