/**
 * A short frame-rate sample, used as an input to the tier decision.
 *
 * It measures the worst case rather than the average of a quiet moment: the loop runs while the
 * interface is being painted after startup, and the reported number is the mean of frame intervals
 * with the longest quarter dropped, so a single 200 ms stall (a window appearing) does not decide the
 * tier for the whole session.
 */

const SAMPLE_MS = 900

export interface FpsSample {
  averageFps: number
  worstFrameMs: number
  frames: number
}

export function measureFps(windowMs: number = SAMPLE_MS): Promise<FpsSample | null> {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    const deltas: number[] = []
    let last = performance.now()
    const start = last
    let raf = 0

    const step = (now: number): void => {
      const delta = now - last
      last = now
      if (delta > 0 && delta < 1000) deltas.push(delta)

      if (now - start < windowMs) {
        raf = window.requestAnimationFrame(step)
        return
      }

      window.cancelAnimationFrame(raf)
      if (deltas.length < 5) {
        resolve(null)
        return
      }

      const sorted = [...deltas].sort((a, b) => a - b)
      const kept = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.75)))
      const mean = kept.reduce((total, value) => total + value, 0) / kept.length
      resolve({
        averageFps: 1000 / mean,
        worstFrameMs: Math.round(sorted[sorted.length - 1] ?? 0),
        frames: deltas.length
      })
    }

    raf = window.requestAnimationFrame(step)
  })
}
