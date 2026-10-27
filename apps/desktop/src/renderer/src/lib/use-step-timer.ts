import { useCallback, useEffect, useState } from 'react'

/** `90` reads as "1:30"; under a minute keeps the bare seconds the document asked for. */
export function formatClock(total: number): string {
  const safe = Math.max(0, Math.round(total))
  if (safe < 60) return `${String(safe)}s`
  const minutes = Math.floor(safe / 60)
  return `${String(minutes)}:${String(safe % 60).padStart(2, '0')}`
}

export interface StepTimer {
  /** `null` when the step carries no duration, so the caller renders nothing instead of a zero. */
  remaining: number | null
  running: boolean
  done: boolean
  /** 0..1 of what is left — for a bar drawn with `scaleX`, never with an animated width. */
  ratio: number
  toggle: () => void
  reset: () => void
}

/**
 * A step that says "hold 45s" is the only place the document tells the player how long they have, and
 * until now both surfaces printed the number and left the counting to the head.
 *
 * The clock restarts when the step changes — not when the app started — because a mid-run step is still
 * a fresh instruction. One interval per surface, torn down when the step has no duration or the timer
 * reaches zero, so an idle card costs nothing.
 */
export function useStepTimer(stepKey: number | undefined, seconds: number | undefined): StepTimer {
  const [left, setLeft] = useState(seconds ?? 0)
  const [running, setRunning] = useState(true)

  useEffect(() => {
    setLeft(seconds ?? 0)
    setRunning(seconds !== undefined)
  }, [stepKey, seconds])

  useEffect(() => {
    if (seconds === undefined || !running || left <= 0) return
    const timer = window.setInterval(() => setLeft((current) => Math.max(0, current - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [seconds, running, left])

  const toggle = useCallback(() => {
    setRunning((current) => !current)
  }, [])

  const reset = useCallback(() => {
    setLeft(seconds ?? 0)
    setRunning(seconds !== undefined)
  }, [seconds])

  if (seconds === undefined) return { remaining: null, running: false, done: false, ratio: 0, toggle, reset }

  return {
    remaining: left,
    running,
    done: left <= 0,
    ratio: seconds > 0 ? Math.max(0, Math.min(1, left / seconds)) : 0,
    toggle,
    reset
  }
}
