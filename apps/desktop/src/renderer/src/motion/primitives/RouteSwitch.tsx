import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { useMotion } from '../context'
import { routeSwap } from '../presets'

/**
 * Screen-level transition. `mode="wait"` keeps the outgoing page mounted until it has left, which is
 * what stops the scroll container from jumping mid-animation.
 */
export function RouteSwitch({ routeKey, children }: { routeKey: string; children: ReactNode }): ReactNode {
  const { budget } = useMotion()
  const variants = routeSwap(budget)

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={routeKey}
        initial={variants.initial}
        animate={variants.animate}
        exit={variants.exit}
        className="min-h-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
