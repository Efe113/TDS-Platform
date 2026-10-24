import type { TargetAndTransition, Transition, Variants } from 'framer-motion'
import type { MotionBudget } from '@tds/shared'

/**
 * Every animation in the app comes from here, so "the engine" is a real thing rather than a folder
 * name: only transform and opacity are animated, durations and distances are budget-derived, and a
 * reduced-motion or low-tier machine gets the same components with the motion taken out.
 */

const seconds = (ms: number): number => ms / 1000

export function springFor(budget: MotionBudget): Transition {
  return { type: 'spring', stiffness: budget.enterMs <= 150 ? 420 : 260, damping: 30, mass: 0.7 }
}

export function enter(budget: MotionBudget): Variants {
  const travel = budget.enterMs <= 150 ? 0 : 10
  return {
    hidden: { opacity: 0, y: travel },
    visible: { opacity: 1, y: 0, transition: { duration: seconds(budget.enterMs), ease: [0.16, 1, 0.3, 1] } },
    exit: { opacity: 0, y: -travel * 0.6, transition: { duration: seconds(budget.enterMs * 0.6) } }
  }
}

export function container(budget: MotionBudget, children: number): Variants {
  return {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: seconds(budget.staggerMs),
        // A long list should not take half a second to finish appearing.
        delayChildren: seconds(Math.min(budget.staggerMs * children, 260))
      }
    }
  }
}

export function item(budget: MotionBudget): Variants {
  const travel = budget.staggerMs === 0 ? 0 : 8
  return {
    hidden: { opacity: 0, y: travel },
    visible: { opacity: 1, y: 0, transition: { duration: seconds(budget.enterMs * 0.8), ease: [0.16, 1, 0.3, 1] } }
  }
}

export function lift(budget: MotionBudget): { whileHover: { y: number }; transition: Transition } {
  return {
    whileHover: { y: budget.enterMs <= 150 ? 0 : -3 },
    transition: springFor(budget)
  }
}

export function press(budget: MotionBudget): { whileTap: { scale: number } } {
  return { whileTap: { scale: budget.pressScale } }
}

/** Route-level swap: the outgoing screen leaves upward, the incoming one arrives from below. */
export interface RouteSwap {
  initial: TargetAndTransition
  animate: TargetAndTransition
  exit: TargetAndTransition
}

export function routeSwap(budget: MotionBudget): RouteSwap {
  const travel = budget.enterMs <= 150 ? 0 : 12
  // No blur here on purpose: a full-page filter animation is the most expensive thing this file could
  // do, and every navigation would pay for it.
  return {
    initial: { opacity: 0, y: travel },
    animate: { opacity: 1, y: 0, transition: { duration: seconds(budget.enterMs), ease: [0.16, 1, 0.3, 1] } },
    exit: { opacity: 0, y: -travel * 0.5, transition: { duration: seconds(budget.enterMs * 0.5) } }
  }
}

/** Ambient drift for a skin layer; returns `null` when the budget says stand still. */
export function drift(budget: MotionBudget, distance: number): { animate: Record<string, number[]>; transition: Transition } | null {
  if (budget.parallax === 0 && budget.ambientLayers <= 1) return null
  const scale = budget.parallax / 14
  return {
    animate: { x: [0, distance * scale, -distance * 0.4 * scale, 0], y: [0, -distance * 0.6 * scale, distance * 0.3 * scale, 0] },
    transition: { duration: 26, repeat: Infinity, ease: 'easeInOut' }
  }
}

export function shimmer(budget: MotionBudget): { animate: { backgroundPosition: string[] }; transition: Transition } {
  return {
    animate: { backgroundPosition: ['200% 0', '-200% 0'] },
    transition: { duration: budget.enterMs <= 150 ? 3 : 1.8, repeat: Infinity, ease: 'linear' }
  }
}
