import { useEffect, useRef, useState } from 'react'
import { animate } from 'framer-motion'
import { useMotion } from '../context'

/**
 * Numbers that arrive instead of popping. Low tier and reduced motion render the final value
 * immediately - a counter that cannot be read at 20 fps is worse than no counter.
 */
export function CountUp({
  value,
  duration = 0.9,
  format = (input: number): string => String(Math.round(input))
}: {
  value: number
  duration?: number
  format?: (input: number) => string
}): React.ReactNode {
  const { budget, reduced } = useMotion()
  const [display, setDisplay] = useState(value)
  const from = useRef(value)

  useEffect(() => {
    if (reduced || budget.enterMs <= 150 || from.current === value) {
      from.current = value
      setDisplay(value)
      return
    }

    const controls = animate(from.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (next) => setDisplay(next)
    })
    from.current = value
    return () => controls.stop()
  }, [value, duration, reduced, budget.enterMs])

  return <>{format(display)}</>
}
