import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/**
 * Whether an element is on screen, so a decoration can stop when nobody can see it.
 *
 * `true` for the first paint: a miniature that only wakes up after an observer callback would flash
 * still and then start, which reads as a bug on a shelf the user is already scrolling through.
 */
export function useAmbientActive<T extends HTMLElement>(rootMargin = '140px'): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [active, setActive] = useState(true)

  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry) setActive(entry.isIntersecting)
      },
      { rootMargin, threshold: 0.01 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [rootMargin])

  return [ref, active]
}
