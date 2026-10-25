import type { ReactNode } from 'react'
import { BadgeCheck, Crown } from 'lucide-react'
import { titleEffect } from '@tds/shared'
import { cn } from '../../lib/utils'

/**
 * One title shape everywhere: the profile hero, leaderboard rows and the shop preview.
 * VIP uses the same shell but swaps the static rule for the animated rainbow treatment.
 */
export function TitleBadge({
  label,
  refCode,
  size = 'md',
  className
}: {
  label: string | null | undefined
  refCode?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}): ReactNode {
  if (!label || label.trim().length === 0) return null
  const effect = titleEffect(refCode)
  const Icon = effect === 'vip-rainbow' ? Crown : BadgeCheck
  return (
    <span
      className={cn('title-badge', className)}
      data-effect={effect ?? undefined}
      data-size={size}
    >
      <span aria-hidden className="title-badge__flare" />
      <Icon
        aria-hidden
        className="title-badge__icon"
        size={size === 'lg' ? 14 : size === 'sm' ? 9 : 11}
      />
      <span className="title-badge__text">{label}</span>
    </span>
  )
}
