import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  budgetFor,
  resolveTier,
  type HardwareHints,
  type MotionBudget,
  type MotionSetting,
  type MotionTier
} from '@tds/shared'
import { measureFps } from './sampler'

interface MotionValue {
  tier: MotionTier
  budget: MotionBudget
  reduced: boolean
  /** Why this tier - shown next to the setting so the choice is a measurement, not a guess. */
  reason: string
  averageFps: number | null
  downgraded: boolean
  resample: () => void
}

const MotionContext = createContext<MotionValue | null>(null)

function readHints(reduced: boolean): HardwareHints {
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number }
  return {
    cores: navigator.hardwareConcurrency ?? 4,
    memoryGb: typeof navigatorWithMemory.deviceMemory === 'number' ? navigatorWithMemory.deviceMemory : null,
    reducedMotion: reduced
  }
}

function prefersReduced(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function MotionProvider({ setting, children }: { setting: MotionSetting; children: ReactNode }): ReactNode {
  const [reduced, setReduced] = useState(prefersReduced)
  const [sample, setSample] = useState<{ averageFps: number | null; frames: number }>({ averageFps: null, frames: 0 })

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const resample = useCallback((): void => {
    void measureFps().then((result) => {
      if (result) setSample({ averageFps: result.averageFps, frames: result.frames })
    })
  }, [])

  // Sampled once after the first paint: the frame rate during startup is the number that matters,
  // and re-sampling on every setting change would compare the app to itself.
  useEffect(() => {
    const timer = window.setTimeout(resample, 400)
    return () => window.clearTimeout(timer)
  }, [resample])

  const value = useMemo<MotionValue>(() => {
    const hints = readHints(reduced)
    const decision = resolveTier({ setting, hints, averageFps: sample.averageFps })
    return {
      tier: decision.tier,
      budget: budgetFor(decision.tier, reduced),
      reduced,
      reason: decision.reason,
      averageFps: sample.averageFps,
      downgraded: decision.downgraded,
      resample
    }
  }, [setting, reduced, sample.averageFps, resample])

  // The tier also drives pure-CSS cascades (menu rows, button press), which cannot read this context.
  // Publishing the numbers as custom properties keeps both systems on the same budget - and a low tier
  // turns press feedback into scale(1) without a single component having to know about tiers.
  useEffect(() => {
    document.documentElement.style.setProperty('--stagger-ms', `${String(value.budget.staggerMs)}ms`)
    document.documentElement.style.setProperty('--enter-ms', `${String(value.budget.enterMs)}ms`)
    document.documentElement.style.setProperty('--press-scale', String(value.budget.pressScale))
    // The ring rotations live in the stylesheet, and they are the one decoration whose cost scales
    // with painted area, so the tier has to reach them without every component importing the budget.
    document.documentElement.dataset.motion = value.tier
  }, [value.budget, value.tier])

  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>
}

export function useMotion(): MotionValue {
  const value = useContext(MotionContext)
  if (!value) throw new Error('useMotion must be used inside <MotionProvider>')
  return value
}
