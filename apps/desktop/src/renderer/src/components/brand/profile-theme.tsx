import type { CSSProperties, ReactNode } from 'react'
import { useReducedMotion } from 'framer-motion'
import { isStillProfileLayer, type ProfileThemeLayer, type ProfileThemeSkin } from '@tds/shared'
import { useMotion } from '../../motion/context'
import { useAmbientActive } from '../../motion/useAmbientActive'
import { cn } from '../../lib/utils'

/**
 * The painter for a profile theme. Every colour and every surface comes from the shared registry, so
 * the row in `spend_catalog`, the unlock question in SQL and the pixels on screen are one definition —
 * the failure mode this avoids is the frame registry's, where a skin existed in the client with no row
 * behind it and could never be equipped.
 *
 * 0.3.6: the layers are no longer hard-coded here. Before, this file emitted four fixed spans and
 * switched on `key === 'nebula'` to add a fifth, which is why `slate` was a ground and a sweep and no
 * amount of new colours would have changed that. Now a theme declares its five surfaces in the
 * registry and the painter walks that list, so adding a layer to a theme is a registry edit, and a
 * theme that is short a layer does not compile.
 *
 * The cost rule, inherited from the skin engine: a moving surface may only animate `transform` or
 * `opacity`. No `filter: blur()`, no animated `background-position` — the profile card sits inside a
 * window that is already drawing an animated skin behind it, and a blurred or repainted card would
 * tax every machine, not only the ones that picked a theme.
 */

function skyStyle(skin: ProfileThemeSkin): CSSProperties {
  return {
    '--pt-a': skin.accent,
    '--pt-r': skin.ring,
    '--pt-1': skin.stops[0],
    '--pt-2': skin.stops[1],
    '--pt-3': skin.stops[2]
  } as CSSProperties
}

function layerStyle(layer: ProfileThemeLayer): CSSProperties {
  return {
    '--pt-dur': `${String(layer.seconds)}s`,
    '--pt-op': layer.opacity
  } as CSSProperties
}

export function ProfileThemeSky({
  skin,
  over = false,
  cap,
  active = true,
  className
}: {
  skin: ProfileThemeSkin | null
  /** Paint above a banner with screen blending instead of below it. */
  over?: boolean
  /** Cut the moving layers to this many: a miniature does not need the full stack. */
  cap?: number
  /** False for a preview nobody can see right now, which is how a scrolled-past shelf costs nothing. */
  active?: boolean
  className?: string
}): ReactNode {
  const reduced = useReducedMotion()
  const { budget } = useMotion()
  if (skin === null) return null

  // Three ways a surface stands still: the user asked for it, the machine cannot afford it, or nobody
  // can see it right now. Only the last one is temporary — a shelf tile scrolled out of view keeps its
  // layers mounted and painted, and gives back every frame it spent compositing them.
  const frozen = reduced === true || !budget.spin || !active
  const moving = skin.layers.filter((layer) => !isStillProfileLayer(layer.key))
  const limit = cap ?? budget.ambientLayers
  const kept = moving.slice(0, Math.max(1, limit))
  const layers = [...kept, ...skin.layers.filter((layer) => isStillProfileLayer(layer.key))]

  return (
    <span
      aria-hidden
      className={cn('profile-theme', over && 'profile-theme--over', frozen && 'is-frozen', className)}
      data-theme={skin.key}
      style={skyStyle(skin)}
    >
      {layers.map((layer) => (
        <span
          key={layer.key}
          className={`profile-theme__${layer.key}`}
          data-pt={layer.key}
          data-move={isStillProfileLayer(layer.key) ? undefined : ''}
          style={layerStyle(layer)}
        />
      ))}
    </span>
  )
}

/**
 * The shelf treatment for a profile theme: the card sample on the left, the five surfaces it stacks
 * listed by name on the right. Same shape as the frame vitrine, for the same reason — a buyer reading
 * "Yörüngedeki altın tozu" must be able to expect that exact surface on their own card, and the
 * catalogue row sells the same five words.
 */
export function ProfileThemeVitrine({
  skin,
  language,
  className
}: {
  skin: ProfileThemeSkin | null
  language: 'tr' | 'en'
  className?: string
}): ReactNode {
  const [sample, onScreen] = useAmbientActive<HTMLSpanElement>()
  if (skin === null) return null
  return (
    <div className={cn('profile-theme-vitrine relative flex items-center gap-3', className)}>
      <span
        aria-hidden
        ref={sample}
        className="relative block h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-line/70"
        style={skyStyle(skin)}
      >
        <ProfileThemeSky skin={skin} over cap={2} active={onScreen} className="absolute inset-0" />
        <span
          className="absolute bottom-1.5 left-1.5 size-6 rounded-full border"
          style={{ borderColor: skin.ring, background: `linear-gradient(140deg, ${skin.stops[0]}, ${skin.stops[2]})` }}
        />
      </span>
      <ol className="relative min-w-0 flex-1 space-y-0.5">
        {skin.layers.map((layer, index) => (
          <li key={layer.key} className="flex items-baseline gap-1.5 text-[10px] leading-tight">
            <span className="hud-num shrink-0 text-mute/70">{String(index + 1).padStart(2, '0')}</span>
            <span className="truncate text-ink/85">{language === 'tr' ? layer.labelTr : layer.labelEn}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
