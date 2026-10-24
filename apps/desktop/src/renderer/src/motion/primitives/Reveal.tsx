import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { useMotion } from '../context'
import { container, enter, item } from '../presets'

/** A block that fades and settles up on mount. The workhorse behind every section header. */
export function Reveal({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  const { budget } = useMotion()
  const variants = enter(budget)
  return (
    <motion.div className={className} initial="hidden" animate="visible" exit="exit" variants={variants}>
      {children}
    </motion.div>
  )
}

interface RevealListProps {
  className?: string
  children: ReactNode
  /** Only used to bound the total stagger; the list itself is rendered by the caller. */
  count: number
}

/**
 * Wraps a grid/list so its children arrive in sequence instead of all at once. The caller's className
 * lands on the animated element itself, so `grid`, `space-y-*` and `divide-y` keep working on the items.
 */
export function RevealList({ className, children, count }: RevealListProps): ReactNode {
  const { budget } = useMotion()
  return (
    <motion.div className={className} initial="hidden" animate="visible" variants={container(budget, count)}>
      {children}
    </motion.div>
  )
}

/** A child of RevealList. `className` carries the grid cell styling. */
export function RevealItem({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  const { budget } = useMotion()
  return (
    <motion.div className={className} variants={item(budget)}>
      {children}
    </motion.div>
  )
}
