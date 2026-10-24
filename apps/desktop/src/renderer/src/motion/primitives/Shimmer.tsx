import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { useMotion } from '../context'
import { shimmer } from '../presets'

/**
 * Skeleton placeholders. The app used to show a "Yükleniyor…" banner in place of content that was
 * about to appear, which forced a layout jump when the data arrived; these hold the shape instead.
 */
export function Skeleton({ className }: { className?: string }): ReactNode {
  const { budget } = useMotion()
  const animation = shimmer(budget)

  return (
    <motion.span
      aria-hidden
      className={className ?? 'block h-4 rounded-md'}
      style={{
        backgroundImage: `linear-gradient(90deg, var(--color-panel-soft) 0%, color-mix(in oklab, var(--color-panel-soft) 55%, var(--color-line)) 45%, var(--color-panel-soft) 90%)`,
        backgroundSize: '200% 100%'
      }}
      animate={animation.animate}
      transition={animation.transition}
    />
  )
}

export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }): ReactNode {
  return (
    <div className={`space-y-2 rounded-2xl border border-line bg-card p-4 ${className ?? ''}`}>
      <Skeleton className="h-5 w-2/5 rounded-md" />
      {Array.from({ length: lines }, (_unused, index) => (
        <Skeleton key={index} className={`h-3 rounded-md ${index % 2 === 0 ? 'w-11/12' : 'w-3/5'}`} />
      ))}
    </div>
  )
}

export function SkeletonRow(): ReactNode {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3">
      <Skeleton className="size-9 rounded-lg" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-1/3 rounded-md" />
        <Skeleton className="h-3 w-2/3 rounded-md" />
      </div>
    </div>
  )
}
