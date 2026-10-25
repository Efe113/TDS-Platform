import type { ReactNode } from 'react'
import { BadgeCheck } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * The staff mark. It is deliberately separate from TitleBadge: the tick answers "is this account
 * who it says it is" and has to stay readable next to any title, in a row or on a card.
 *
 * `tier` only changes the colour. A corporate account is verified, so it gets the same tick — in gold,
 * which is the one place the two tiers are distinguishable without reading the title.
 */
export function VerifiedBadge({
  show = true,
  label,
  size = 'md',
  tier = 'verified',
  className
}: {
  show?: boolean
  label?: string
  size?: 'sm' | 'md'
  tier?: 'verified' | 'corporate'
  className?: string
}): ReactNode {
  if (!show) return null
  return (
    <span
      className={cn('verified-badge', tier === 'corporate' && 'verified-badge--corporate', className)}
      data-size={size}
      title={label}
    >
      <BadgeCheck aria-hidden className="verified-badge__icon" size={size === 'sm' ? 12 : 15} />
      {label ? <span className="verified-badge__label">{label}</span> : null}
      <span className="sr-only">{label ?? 'Verified'}</span>
    </span>
  )
}
