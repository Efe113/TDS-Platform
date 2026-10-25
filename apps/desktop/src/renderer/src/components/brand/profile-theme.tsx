import type { CSSProperties, ReactNode } from 'react'
import type { ProfileThemeSkin } from '@tds/shared'
import { cn } from '../../lib/utils'

/**
 * The painter for a profile theme (0043). Every colour comes from the shared registry, so the row in
 * `spend_catalog`, the unlock question in SQL and the pixels on screen are the same definition — the
 * failure mode this avoids is the frame registry's, where a skin existed in the client with no row
 * behind it and could never be equipped.
 *
 * Layers, not one gradient: ground wash, engraved rays, a spark or cloud field, a horizon rule, and
 * for the tiers a specular sweep that only VIP, verification or a corporate account can switch on.
 */
export function ProfileThemeSky({
  skin,
  over = false,
  className
}: {
  skin: ProfileThemeSkin | null
  /** Paint above a banner with screen blending instead of below it. */
  over?: boolean
  className?: string
}): ReactNode {
  if (skin === null) return null
  const style = {
    '--pt-a': skin.accent,
    '--pt-r': skin.ring,
    '--pt-1': skin.stops[0],
    '--pt-2': skin.stops[1],
    '--pt-3': skin.stops[2]
  } as CSSProperties

  return (
    <span
      aria-hidden
      className={cn('profile-theme', over && 'profile-theme--over', className)}
      data-theme={skin.key}
      style={style}
    >
      <span className="profile-theme__rays" />
      {skin.key === 'nebula' ? <span className="profile-theme__cloud" /> : null}
      <span className="profile-theme__field" />
      <span className="profile-theme__rule" />
    </span>
  )
}
