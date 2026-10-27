import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useMotion } from '../context'
import { subscribeToTicker } from '../ticker'

/**
 * A pointer-following light. Mounted only on the high tier: it is the single most expensive
 * decoration in the app (a full-screen layer that moves on every pointer event), and on a machine
 * already sharing the GPU with a game it is the first thing worth losing.
 *
 * It borrows the shared ticker instead of owning a frame loop, and it fades on gradient stops rather
 * than `filter: blur()` — a blurred surface that follows the pointer re-rasterizes on every move.
 */
export function CursorGlow({ color }: { color: string }): ReactNode {
  const { budget, reduced } = useMotion()
  const ref = useRef<HTMLSpanElement | null>(null)
  const enabled = budget.parallax >= 10 && !reduced

  useEffect(() => {
    if (!enabled) return
    const node = ref.current
    if (!node) return

    let targetX = window.innerWidth / 2
    let targetY = window.innerHeight / 2
    let currentX = targetX
    let currentY = targetY

    const onMove = (event: PointerEvent): void => {
      targetX = event.clientX
      targetY = event.clientY
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    // Eased follow rather than direct binding: the lag is what makes it read as light, not a cursor.
    const unsubscribe = subscribeToTicker(() => {
      currentX += (targetX - currentX) * 0.08
      currentY += (targetY - currentY) * 0.08
      node.style.transform = `translate3d(${Math.round(currentX - 260)}px, ${Math.round(currentY - 260)}px, 0)`
    }, budget.frameRate)

    return () => {
      unsubscribe()
      window.removeEventListener('pointermove', onMove)
    }
  }, [enabled, budget.frameRate])

  if (!enabled) return null

  return (
    <span
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-0 size-[520px] rounded-full will-change-transform"
      // The falloff is in the stops, not in a filter: an alpha that starts below 1 and reaches zero
      // over half the radius is already as soft as a 90px blur, and it costs nothing to move.
      style={{ background: `radial-gradient(circle, ${color} 0%, ${color} 24%, transparent 68%)`, opacity: 0.9 }}
    />
  )
}
