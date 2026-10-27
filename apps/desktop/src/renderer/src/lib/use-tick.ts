import { useEffect, useState } from 'react'

/**
 * A coarse clock, so a countdown moves without anything re-rendering every second. The interval is the
 * caller's: a run rail that shows "4 dk" ticks at 30 s, a boost that expires within the hour ticks faster.
 */
export function useTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}
