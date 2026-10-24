import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useMotion } from '../context'

/**
 * A pointer-following light. Mounted only on the high tier: it is the single most expensive
 * decoration in the app (a full-screen composited layer that repaints on every move), and on a
 * machine already sharing the GPU with a game it is the first thing worth losing.
 */
export function CursorGlow({ color }: { color: string }): ReactNode {
  const { budget, reduced } = useMotion()
  const ref = useRef<HTMLSpanElement | null>(null)
  const enabled = budget.parallax >= 10 && !reduced

  useEffect(() => {
    if (!enabled) return

    let frame = 0
    let targetX = window.innerWidth / 2
    let targetY = window.innerHeight / 2
    let currentX = targetX
    let currentY = targetY

    const onMove = (event: PointerEvent): void => {
      targetX = event.clientX
      targetY = event.clientY
    }

    const tick = (): void => {
      // Eased follow rather than direct binding: the lag is what makes it read as light, not a cursor.
      currentX += (targetX - currentX) * 0.08
      currentY += (targetY - currentY) * 0.08
      if (ref.current) {
        ref.current.style.transform = `translate3d(${Math.round(currentX - 260)}px, ${Math.round(currentY - 260)}px, 0)`
      }
      frame = window.requestAnimationFrame(tick)
    }

    const onVisibility = (): void => {
      if (document.hidden) {
        window.cancelAnimationFrame(frame)
        frame = 0
      } else if (frame === 0) {
        frame = window.requestAnimationFrame(tick)
      }
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    frame = window.requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('visibilitychange', onVisibility)
      window.cancelAnimationFrame(frame)
    }
  }, [enabled])

  if (!enabled) return null

  return (
    <span
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-0 size-[520px] rounded-full opacity-[0.16] blur-[90px]"
      style={{ background: `radial-gradient(circle, ${color}, transparent 62%)` }}
    />
  )
}
