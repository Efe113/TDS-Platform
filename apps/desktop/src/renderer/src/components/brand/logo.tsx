import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * The mark is a turret: a plinth, a mast tapering upward, a deck, and a barrel that carries the brand
 * colour. Everything else is currentColor, so the mark inherits whatever surface it sits on, and only
 * the barrel follows a purchased theme through --color-brand.
 *
 * Same geometry as apps/desktop/build/logo.svg, divided by 16 (that file is the raster master for the
 * Windows icon, where colors have to be literals because the rasteriser has no cascade to read).
 */
export function Logo({ className, size = 28 }: { className?: string; size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="TDS Companion"
      className={cn('shrink-0', className)}
    >
      <rect x="1.75" y="1.75" width="28.5" height="28.5" rx="7" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      <rect x="14.25" y="6" width="3.5" height="4" rx="0.9" className="fill-brand" />
      <path d="M9.5 10.5H22.5" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
      <path d="M13.25 11.625 11.75 24.5h8.5L18.75 11.625Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M9.5 24.5H22.5" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
    </svg>
  )
}
