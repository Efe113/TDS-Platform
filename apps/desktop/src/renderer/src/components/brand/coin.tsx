import type { ReactNode } from 'react'
import { formatCoin } from '@tds/shared'
import { cn } from '../../lib/utils'

/**
 * The currency mark. It has to survive 12 px next to a number, so it is a ring with a solid turret
 * bar rather than the full logo - the logo loses its shape below ~20 px. `currentColor` everywhere so
 * a single class controls it: brand for prices, ink for balances, mute for historical ledger rows.
 */
export function CoinIcon({ size = 14, className }: { size?: number; className?: string }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={cn('shrink-0', className)}
    >
      <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
      <circle cx="8" cy="8" r="3.1" fill="currentColor" opacity="0.18" />
      <path d="M5.4 5.9h5.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 5.9v4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Amount + mark, always together. A bare number reads as a statistic; the mark is what tells the user
 * this is money they can spend. `count` animates the value on mount and whenever it changes.
 */
export function CoinAmount({
  value,
  size = 'md',
  tone = 'brand',
  signed,
  className
}: {
  value: number
  size?: 'sm' | 'md' | 'lg'
  tone?: 'brand' | 'ink' | 'mute' | 'good' | 'danger'
  signed?: boolean
  className?: string
}): ReactNode {
  const glyph = size === 'lg' ? 18 : size === 'sm' ? 11 : 13
  const text = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-xs' : 'text-sm'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 tabular-nums',
        text,
        tone === 'brand' && 'text-brand',
        tone === 'ink' && 'text-ink',
        tone === 'mute' && 'text-mute',
        tone === 'good' && 'text-good',
        tone === 'danger' && 'text-danger',
        className
      )}
    >
      <CoinIcon size={glyph} />
      <span>{signed && value > 0 ? `+${formatCoin(value)}` : formatCoin(value)}</span>
    </span>
  )
}
