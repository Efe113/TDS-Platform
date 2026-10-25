import type { ReactNode } from 'react'
import { Award } from 'lucide-react'
import { isRuleIconName } from '@tds/shared'
import { badgeIconSrc } from '../../lib/badge-icon'
import { RULE_ICONS } from './rule-icon'
import { cn } from '../../lib/utils'

/**
 * `badge_definitions.icon_path` holds either an image (an https URL or a `strategy-media` object path)
 * or one of the registry names the admin picked in the badge editor. Resolving only the first turned
 * every named badge — including the staff ones 0037 and 0040 insert — into a request for an object that
 * was never uploaded, so the tile showed a broken image instead of its mark.
 */
export function BadgeGlyph({
  path,
  size = 14,
  className,
  fallback
}: {
  path: string | null | undefined
  size?: number
  className?: string
  /** What a badge with no mark of its own should show; most rails keep the first letter of its name. */
  fallback?: ReactNode
}): ReactNode {
  const value = (path ?? '').trim()
  const Icon = isRuleIconName(value) ? RULE_ICONS[value] : null
  if (Icon) return <Icon aria-hidden size={size} className={cn('shrink-0 text-mute', className)} />

  const src = badgeIconSrc(value.length > 0 ? value : null)
  if (!src) {
    if (fallback !== undefined) return fallback
    return <Award aria-hidden size={size} className={cn('shrink-0 text-mute', className)} />
  }

  // Sized inline rather than with a utility: the caller's `className` is a colour or a border, and a
  // `size-full` here would fight whatever box it is dropped into.
  return <img src={src} alt="" loading="lazy" style={{ width: size, height: size }} className={cn('shrink-0 rounded-sm object-cover', className)} />
}
