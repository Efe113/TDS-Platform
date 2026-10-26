import type { CSSProperties, ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { storageUrl, type AmbientLayer, type ParticleScene, type ThemeSkin } from '@tds/shared'
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
 * glow. Everything here is composited (transform/opacity) or a static gradient - no per-frame React
 * work except the canvas field, which owns its own loop.
 */

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")"

/**
 * Six tongues of different heights and speeds, anchored to the floor so the fire never drifts
 * across the content. They are gradients rather than sprites: the blur is the only expensive part
 * and the low tier drops it without losing the shape.
 */
const FLAME_TONGUES = [
  { left: '-6%', width: '24%', height: '62%', duration: 7.8, delay: 0 },
  { left: '12%', width: '20%', height: '46%', duration: 6.4, delay: 1.1 },
  { left: '28%', width: '28%', height: '78%', duration: 9.2, delay: 0.4 },
  { left: '48%', width: '22%', height: '52%', duration: 7.1, delay: 1.7 },
  { left: '64%', width: '26%', height: '70%', duration: 8.6, delay: 0.8 },
  { left: '84%', width: '24%', height: '48%', duration: 6.9, delay: 1.4 }
] as const

const EMBER_SMOKE = [
  { left: '4%', size: 340, duration: 20, delay: 0 },
  { left: '38%', size: 440, duration: 26, delay: 5 },
  { left: '72%', size: 300, duration: 22, delay: 9 }
] as const

const TOXIC_BUBBLES = [
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
] as const

/**
 * The coal bed. Every chip carries its own clock, size and depth so the floor cools in places instead
 * of blinking as one sheet. Three of them are flare pops: a coal that catches, not the whole fire.
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
const HEAT_BANDS = [
  { left: '-6%', width: '58%', height: 220, duration: 9.5, delay: 0 },
  { left: '34%', width: '44%', height: 300, duration: 12.5, delay: 2.2 },
  { left: '62%', width: '52%', height: 250, duration: 10.5, delay: 4.1 },
  { left: '12%', width: '38%', height: 180, duration: 8.5, delay: 6 }
] as const

/**
 * Ooze strands hanging from the ceiling. Each one sheds a drop on its own clock: a leak that drips in
 * step reads as a loop, and a loop is what this skin was before.
 */
const TOXIC_DRIPS = [
  { left: '6%', width: 5, length: 96, delay: 0.4, duration: 6.2 },
  { left: '19%', width: 3, length: 58, delay: 2.8, duration: 5.1 },
  { left: '34%', width: 6, length: 132, delay: 1.2, duration: 7.4 },
  { left: '52%', width: 4, length: 76, delay: 3.9, duration: 5.8 },
  { left: '68%', width: 7, length: 118, delay: 0.9, duration: 8.2 },
  { left: '84%', width: 3, length: 64, delay: 4.6, duration: 6.6 },
  { left: '94%', width: 5, length: 88, delay: 2.1, duration: 6.9 }
] as const

/** Blowholes in the acid pool: where the churn visibly vents. */
const TOXIC_VENTS = [
  { left: '14%', size: 120, duration: 7.5, delay: 0 },
  { left: '46%', size: 170, duration: 9.5, delay: 2.4 },
  { left: '76%', size: 130, duration: 8.5, delay: 4.2 }
] as const

/**
 * Five curtains, each leaning its own way and waving on its own clock. A single sine for all of them is
 * what made the old aurora look like one wallpaper stripe; the hue alternates so the sky reads as
 * several gases, the way a real polar display does.
 */
const AURORA_CURTAINS = [
  { left: '-8%', width: '30%', tilt: -8, duration: 16, delay: 0, hue: 0 },
  { left: '16%', width: '24%', tilt: 6, duration: 13, delay: 2.5, hue: 1 },
  { left: '38%', width: '32%', tilt: -4, duration: 19, delay: 1.2, hue: 0 },
  { left: '62%', width: '22%', tilt: 9, duration: 14, delay: 4.4, hue: 1 },
  { left: '78%', width: '30%', tilt: -6, duration: 17, delay: 2, hue: 0 }
] as const

function Layer({ skin, name, still, compact }: { skin: ThemeSkin; name: AmbientLayer; still: boolean; compact: boolean }): ReactNode {
  const { budget } = useMotion()
  const animation = drift(budget, 60)

  if (name === 'curtain') {
    // The curtain is the signature: vertical light, a mask that fades it into the sky, and a shimmer
    // running *along* each column instead of across the window. Transforms and opacity only.
    return (
      <span className="absolute inset-x-0 top-0 h-[78%]">
        {AURORA_CURTAINS.map((curtain, index) => {
          const hue = curtain.hue === 0 ? skin.tokens.brand : skin.tokens.warn
          const soft = curtain.hue === 0 ? skin.glow[0] : skin.glow[1]
          return (
            <motion.span
              key={curtain.left}
              className="aurora-curtain absolute -top-[12%] origin-top"
              style={{
                left: curtain.left,
                width: curtain.width,
                height: '84%',
                background: `linear-gradient(to bottom, ${soft}, transparent 78%)`,
                ['--aurora-hue' as string]: hue,
                ['--curtain-duration' as string]: `${String(curtain.duration)}s`,
                ['--curtain-delay' as string]: `${String(curtain.delay)}s`,
                filter: budget.blur ? 'blur(34px)' : undefined,
                mixBlendMode: 'screen',
                opacity: 0.5
              }}
              animate={
                still
                  ? undefined
                  : {
                      skewX: [curtain.tilt, -curtain.tilt, curtain.tilt / 2, curtain.tilt],
                      scaleY: [1, 1.12, 0.96, 1.06, 1],
                      opacity: [0.34, 0.62, 0.42, 0.58, 0.34]
                    }
              }
              transition={{ duration: curtain.duration, delay: curtain.delay, repeat: Infinity, ease: 'easeInOut' }}
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
            background: `linear-gradient(90deg, transparent, ${skin.tokens.brand} 22%, ${skin.tokens.good} 50%, ${skin.tokens.warn} 78%, transparent)`,
            opacity: 0.55
          }}
        />
        {[0, 1].map((index) => (
          <motion.span
            key={index}
            className="absolute bottom-[18%] size-56 rounded-full"
            style={{
              left: index === 0 ? '8%' : '58%',
              background: `radial-gradient(circle, ${index === 0 ? skin.tokens.brand : skin.tokens.warn}, transparent 66%)`,
              filter: budget.blur ? 'blur(42px)' : undefined,
              opacity: 0.2
            }}
            animate={still ? undefined : { x: [0, index === 0 ? 60 : -60, 0], opacity: [0.14, 0.3, 0.18, 0.28, 0.14] }}
            transition={{ duration: skin.motion.cycleSeconds * (1.2 + index * 0.4), repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
      </span>
    )
  }

  if (name === 'crucible') {
    // The bath breathes on transform/opacity only and the seam is a CSS background-position run, so
    // the signature layer costs no layout. On the low tier the blur drops but the shape stays.
    return (
      <span className="absolute inset-x-0 bottom-0 h-[46%]">
        <motion.span
          className="absolute inset-x-[-12%] bottom-0 h-[30%]"
          style={{
            background: `linear-gradient(to top, ${skin.tokens.warn}, ${skin.tokens.brand} 34%, transparent)`,
            filter: budget.blur ? 'blur(26px)' : undefined,
            transformOrigin: '50% 100%',
            opacity: 0.5
          }}
          animate={still ? undefined : { scaleY: [1, 1.16, 1.05, 1.2, 1], opacity: [0.4, 0.62, 0.48, 0.64, 0.4] }}
          transition={{ duration: skin.motion.cycleSeconds, repeat: Infinity, ease: 'easeInOut' }}
        />
        <span className="forge-seam absolute inset-x-0" style={{ bottom: compact ? '16%' : '26%', height: 2 }} />
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
              background: `radial-gradient(circle, ${skin.tokens.warn}, transparent 68%)`,
              filter: budget.blur ? 'blur(34px)' : undefined,
              opacity: 0.3
            }}
            animate={still ? undefined : { scale: [0.9, 1.25, 0.95, 1.15, 0.9], opacity: [0.22, 0.4, 0.26, 0.38, 0.22] }}
            transition={{ duration: skin.motion.cycleSeconds * (1.3 + index * 0.5), repeat: Infinity, ease: 'easeInOut' }}
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
                background: coal.hot ? skin.tokens.warn : skin.tokens.brand,
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
    if (still) return null
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
              mixBlendMode: 'soft-light',
              filter: budget.blur ? 'blur(18px)' : undefined
            }}
            animate={{ y: [0, -((compact ? 60 : 260) + index * 24)], scaleX: [1, 1.14, 0.94, 1.08, 1], opacity: [0, 0.6, 0.45, 0] }}
            transition={{
              duration: compact ? band.duration * 0.5 : band.duration,
              delay: compact ? band.delay * 0.4 : band.delay,
              repeat: Infinity,
              ease: 'easeInOut'
            }}
          />
        ))}
      </span>
    )
  }

  if (name === 'sludge') {
    // The pool is the signature layer, so it survives to the low tier: no blur, still a churning
    // acid floor. Everything here is transform/opacity or a background-position run — no layout.
    return (
      <span className="absolute inset-x-0 bottom-0 h-[42%]">
        <motion.span
          className="absolute inset-x-[-10%] bottom-0 h-[26%]"
          style={{
            background: `linear-gradient(to top, ${skin.tokens.brand}, ${skin.tokens.brandSoft} 58%, transparent)`,
            filter: budget.blur ? 'blur(26px)' : undefined,
            transformOrigin: '50% 100%',
            opacity: 0.46
          }}
          animate={still ? undefined : { scaleY: [1, 1.14, 1.02, 1.18, 1], opacity: [0.36, 0.56, 0.42, 0.58, 0.36] }}
          transition={{ duration: skin.motion.cycleSeconds, repeat: Infinity, ease: 'easeInOut' }}
        />
        <span className="toxic-foam absolute inset-x-0" style={{ bottom: compact ? '15%' : '25%', height: 2 }} />
        {TOXIC_VENTS.map((vent, index) => (
          <motion.span
            key={vent.left}
            className="absolute bottom-[16%] rounded-full"
            style={{
              left: vent.left,
              width: compact ? vent.size * 0.4 : vent.size,
              height: compact ? vent.size * 0.4 : vent.size,
              background: `radial-gradient(circle, ${skin.tokens.warn}, transparent 66%)`,
              filter: budget.blur ? 'blur(24px)' : undefined,
              opacity: 0.22
            }}
            animate={still ? undefined : { scale: [0.8, 1.3, 0.9, 1.2, 0.8], opacity: [0.14, 0.34, 0.2, 0.3, 0.14], y: [0, -12, -4, -18, 0] }}
            transition={{ duration: vent.duration, delay: vent.delay, repeat: Infinity, ease: 'easeInOut' }}
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
    // CSS keyframes rather than twelve motion components: the drops fall forever and a background
    // thread should not cost a JS tick per drop.
    if (still) return null
    return (
      <span className="absolute inset-x-0 top-0 h-[70%]">
        {TOXIC_DRIPS.map((strand) => {
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
                  background: `linear-gradient(to bottom, ${skin.tokens.brandSoft}, ${skin.tokens.brand} 62%, ${skin.tokens.warn})`
                }}
              />
              <span
                className="toxic-drop"
                style={{ width: strand.width * 1.7, height: strand.width * 2.1, background: skin.tokens.warn }}
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
          style={{
            background: `radial-gradient(ellipse 62% 100% at 50% 100%, ${skin.glow[0]}, transparent 72%)`,
            filter: budget.blur ? 'blur(38px)' : undefined
          }}
        />
        {FLAME_TONGUES.map((tongue) => (
          <motion.span
            key={tongue.left}
            className="absolute bottom-0"
            style={{
              left: tongue.left,
              width: tongue.width,
              height: tongue.height,
              transformOrigin: '50% 100%',
              background: `radial-gradient(ellipse 52% 58% at 50% 94%, ${skin.tokens.warn} 0%, ${skin.tokens.brand} 46%, transparent 78%)`,
              borderRadius: '50% 50% 18% 18% / 72% 72% 28% 28%',
              filter: budget.blur ? 'blur(30px)' : undefined,
              mixBlendMode: 'screen',
              opacity: 0.42
            }}
            animate={
              still
                ? undefined
                : {
                    scaleY: [0.9, 1.08, 0.95, 1.05, 0.9],
                    scaleX: [1, 0.94, 1.04, 0.97, 1],
                    opacity: [0.3, 0.55, 0.38, 0.5, 0.3],
                    skewX: [-2, 2, -1, 1.5, -2]
                  }
            }
            transition={{ duration: tongue.duration, delay: tongue.delay, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
        <span
          className="absolute inset-x-0 bottom-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent, ${skin.tokens.brand}, ${skin.tokens.warn}, ${skin.tokens.brand}, transparent)`,
            opacity: 0.6
          }}
        />
      </span>
    )
  }

  if (name === 'mesh') {
    return (
      <>
        <motion.span
          className="absolute -left-40 -top-48 size-[38rem] rounded-full"
          style={{
            background: `radial-gradient(circle at 30% 30%, ${skin.glow[0]}, transparent 65%)`,
            filter: budget.blur ? 'blur(96px)' : undefined
          }}
          animate={still || !animation ? undefined : animation.animate}
          transition={animation?.transition}
        />
        <motion.span
          className="absolute -right-40 top-1/3 size-[34rem] rounded-full"
          style={{
            background: `radial-gradient(circle at 70% 30%, ${skin.glow[1]}, transparent 65%)`,
            filter: budget.blur ? 'blur(110px)' : undefined
          }}
          animate={still || !animation ? { x: [0, -20, 0] } : animation.animate}
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
    return (
      <>
        {[0, 1, 2].map((index) => (
          <motion.span
            key={index}
            className="absolute inset-x-[-20%] h-56"
            style={{
              top: `${String(12 + index * 26)}%`,
              background: `linear-gradient(100deg, transparent, ${index % 2 === 0 ? skin.glow[0] : skin.glow[1]}, transparent)`,
              filter: budget.blur ? 'blur(48px)' : undefined,
              opacity: 0.5
            }}
            animate={still ? undefined : { x: ['-8%', '8%', '-8%'], rotate: [-2 - index, 2 + index, -2 - index] }}
            transition={{ duration: skin.motion.cycleSeconds * (1 + index * 0.25), repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
      </>
    )
  }

  if (name === 'grain') {
    return <span className="absolute inset-0 opacity-[0.05] mix-blend-soft-light" style={{ backgroundImage: NOISE }} />
  }

  if (name === 'smoke') {
    if (still) return null
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
                background:
                  'radial-gradient(circle at 50% 58%, rgba(82, 48, 34, 0.32), rgba(36, 22, 17, 0.16) 55%, transparent 74%)',
                filter: budget.blur ? 'blur(28px)' : undefined
              }}
              animate={{
                y: [0, -((compact ? 46 : 190) + index * 16)],
                x: [0, index % 2 === 0 ? 26 : -22, 0],
                scale: [0.95, 1.12, 1.04, 1.18],
                opacity: [0, 0.55, 0.4, 0]
              }}
              transition={{
                duration: compact ? plume.duration * 0.5 : plume.duration,
                delay: compact ? plume.delay * 0.4 : plume.delay,
                repeat: Infinity,
                ease: 'easeInOut'
              }}
            />
          )
        })}
      </span>
    )
  }

  if (name === 'bubbles') {
    // A still frame made of seven bubbles at the bottom would read as a bug, so reduced motion skips
    // the layer entirely instead of freezing it mid-rise.
    if (still) return null
    return (
      <span className="absolute inset-0">
        {TOXIC_BUBBLES.map((bubble, index) => (
          <motion.span
            key={bubble.left}
            className="absolute rounded-full"
            style={{
              left: bubble.left,
              bottom: '-8%',
              width: bubble.size,
              height: bubble.size,
              border: '1px solid rgba(190, 242, 100, 0.22)',
              background:
                'radial-gradient(circle at 34% 28%, rgba(217, 249, 157, 0.45), rgba(126, 217, 87, 0.14) 55%, transparent 72%)',
              filter: budget.blur ? 'blur(0.5px)' : undefined
            }}
            animate={{
              y: [0, -((compact ? 70 : 160) + bubble.size * 5)],
              x: [0, index % 2 === 0 ? 14 : -14, 0],
              // The bubble swells and bursts at the top of its rise instead of fading out.
              opacity: [0, 0.5, 0.58, 0.8, 0],
              scale: [0.8, 1, 1.08, 1.34, 1.55]
            }}
            transition={{
              duration: compact ? bubble.duration * 0.55 : bubble.duration,
              delay: compact ? bubble.delay * 0.4 : bubble.delay,
              repeat: Infinity,
              ease: 'easeInOut'
            }}
          />
        ))}
      </span>
    )
  }

  if (name === 'hazard') {
    // Two tapes in two corners, crawling opposite ways: a live cordon instead of a wallpaper stripe.
    return (
      <>
        <motion.span
          className="absolute inset-0"
          style={{
            backgroundImage: `repeating-linear-gradient(45deg, ${skin.tokens.brand} 0 2px, transparent 2px 34px)`,
            maskImage: 'radial-gradient(ellipse 70% 60% at 100% 0%, #000, transparent 68%)',
            opacity: 0.08
          }}
          animate={still ? undefined : { backgroundPosition: ['0px 0px', '0px 68px'] }}
          transition={{ duration: skin.motion.cycleSeconds * 1.6, repeat: Infinity, ease: 'linear' }}
        />
        <motion.span
          className="absolute inset-0"
          style={{
            backgroundImage: `repeating-linear-gradient(-45deg, ${skin.tokens.warn} 0 2px, transparent 2px 44px)`,
            maskImage: 'radial-gradient(ellipse 62% 52% at 0% 100%, #000, transparent 66%)',
            opacity: 0.05
          }}
          animate={still ? undefined : { backgroundPosition: ['0px 0px', '0px -88px'] }}
          transition={{ duration: skin.motion.cycleSeconds * 2.2, repeat: Infinity, ease: 'linear' }}
        />
      </>
    )
  }

  if (name === 'scanline') {
    // One band is a screensaver; two bands crossing each other are an instrument.
    return (
      <>
        <motion.span
          className="absolute inset-x-0 h-40"
          style={{ background: `linear-gradient(to bottom, transparent, ${skin.glow[0]}, transparent)`, opacity: 0.3 }}
          animate={still ? { top: '28%' } : { top: ['-12%', '112%'] }}
          transition={{ duration: still ? 0.01 : skin.motion.cycleSeconds * 1.6, repeat: still ? 0 : Infinity, ease: 'linear' }}
        />
        <motion.span
          className="absolute inset-x-0 h-1"
          style={{ background: `linear-gradient(90deg, transparent, ${skin.tokens.warn}, transparent)`, opacity: 0.34 }}
          animate={still ? { top: '62%' } : { top: ['108%', '-6%'] }}
          transition={{ duration: still ? 0.01 : skin.motion.cycleSeconds * 2.4, repeat: still ? 0 : Infinity, ease: 'linear' }}
        />
      </>
    )
  }

  return <span className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 40%, transparent 45%, rgba(0,0,0,0.55) 100%)' }} />
}

/**
 * The skin's layers on their own, so a preview inside a card can show the same thing the window
 * background does. The caller owns the positioned container.
 */
export function SkinLayers({ skin, cap }: { skin: ThemeSkin; cap?: number }): ReactNode {
  const reduced = useReducedMotion()
  const still = reduced === true
  const { budget } = useMotion()
  const layers = skin.layers.slice(0, Math.max(1, cap ?? budget.ambientLayers))
  const scenes = [skin.scene, skin.sceneAlt].filter((entry): entry is ParticleScene => entry !== null)

  return (
    <>
      {layers.map((layer) => (
        <Layer key={layer} skin={skin} name={layer} still={still} compact={cap !== undefined} />
      ))}
      <ParticleField scenes={scenes} countCap={cap === undefined ? undefined : Math.max(6, cap * 4)} />
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
