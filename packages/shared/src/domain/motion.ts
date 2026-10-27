/**
 * Motion budgets.
 *
 * The same build has to feel luxurious on a desktop machine and stay out of the way of a game on a
 * weak laptop, so the difference is a number set, not a code path. Everything that decides those
 * numbers lives here - pure, testable, and free of the renderer - because "we guessed a tier" is the
 * failure mode this exists to avoid: the fps sample is an input to the decision, not a decoration.
 */

export const MOTION_TIERS = ['low', 'medium', 'high'] as const
export type MotionTier = (typeof MOTION_TIERS)[number]

/** What the user can pin in Settings. `auto` lets hardware + measured frame rate decide. */
export const MOTION_SETTINGS = ['auto', 'low', 'medium', 'high'] as const
export type MotionSetting = (typeof MOTION_SETTINGS)[number]

export interface MotionBudget {
  /** Particles in the skin's canvas field. 0 means the canvas is never mounted. */
  particles: number
  /**
   * How many *moving* ambient layers the machine affords. Layers that only paint - the vignette, the
   * grain, the grid - are not counted anywhere: they cost nothing per frame and cutting them would
   * take legibility away from exactly the machines that need it most.
   */
  ambientLayers: number
  /** Pixels of pointer parallax travel; 0 disables the pointer listener entirely. */
  parallax: number
  /** Delay between list items, in ms. */
  staggerMs: number
  /** Standard entrance duration, in ms. */
  enterMs: number
  /** Press feedback scale. */
  pressScale: number
  /** Glow shadows on active/hover surfaces. */
  glow: boolean
  /**
   * Ceiling on the canvas field, in frames per second. The window runs at whatever the display gives;
   * a preview inside a grid does not need 60 and costs the rest of the page for it.
   */
  frameRate: number
  /** Whether anything may turn. Off on the low tier, where a rotating ring is the most expensive
   *  decoration available and the app is already sharing the GPU with a game. */
  spin: boolean
}

/**
 * Layer headroom, not layer count: a skin declares the stack it wants and the tier cuts the tail -
 * and only the *moving* tail, since a still gradient costs nothing per frame. A renewed skin names six
 * moving layers, so the ladder has room for them or the flagship renders the same two as the free skin.
 *
 * Every tier number buys back frames somewhere: the frame-rate ceiling stops a miniature from running
 * at the display's rate, and `spin` lets the stylesheet park the ring rotations, which are the only
 * decorations whose cost scales with the size of the surface they paint.
 *
 * There is deliberately no blur budget any more. A `filter: blur()` on an animating surface re-rasterizes
 * on the GPU every frame it moves, and that is the frame the game next door wanted. Every soft edge in
 * the skin engine is now a gradient stop, which costs the same moving or still.
 */
export const TIER_BUDGETS: Record<MotionTier, MotionBudget> = {
  low: { particles: 0, ambientLayers: 2, parallax: 0, staggerMs: 0, enterMs: 140, pressScale: 1, glow: false, frameRate: 24, spin: false },
  medium: { particles: 44, ambientLayers: 4, parallax: 6, staggerMs: 26, enterMs: 240, pressScale: 0.985, glow: false, frameRate: 30, spin: true },
  high: { particles: 130, ambientLayers: 6, parallax: 14, staggerMs: 40, enterMs: 320, pressScale: 0.97, glow: true, frameRate: 60, spin: true }
}

export interface HardwareHints {
  cores: number
  /** navigator.deviceMemory, in GiB; undefined where Chromium does not expose it. */
  memoryGb: number | null
  reducedMotion: boolean
}

export const FPS_DOWNGRADE_BELOW = 45
export const FPS_TO_LOW_BELOW = 26

function nextTierDown(tier: MotionTier): MotionTier {
  const index = MOTION_TIERS.indexOf(tier)
  return MOTION_TIERS[Math.max(0, index - 1)] ?? 'low'
}

/** Cores are the reliable half; deviceMemory is missing on some platforms, so null must not guess. */
export function tierFromHardware(hints: HardwareHints): MotionTier {
  if (hints.reducedMotion) return 'low'
  const weakCores = hints.cores <= 4
  const weakMemory = hints.memoryGb !== null && hints.memoryGb <= 4
  if (weakCores || weakMemory) return 'low'
  if (hints.cores <= 8 || (hints.memoryGb !== null && hints.memoryGb <= 8)) return 'medium'
  return 'high'
}

export interface TierDecision {
  tier: MotionTier
  /** Why this tier, for the one-line proof shown next to the setting. */
  reason: string
  downgraded: boolean
}

/**
 * The measured frame rate can only ever lower the tier. Raising it on a good sample would make the
 * setting flap between states while the user is looking at it.
 */
export function applyFpsSample(base: MotionTier, averageFps: number | null): TierDecision {
  if (averageFps === null) {
    return { tier: base, reason: 'measured value pending', downgraded: false }
  }
  if (averageFps < FPS_TO_LOW_BELOW && base !== 'low') {
    return { tier: 'low', reason: `${String(Math.round(averageFps))} fps measured`, downgraded: true }
  }
  if (averageFps < FPS_DOWNGRADE_BELOW && base !== 'low') {
    return { tier: nextTierDown(base), reason: `${String(Math.round(averageFps))} fps measured`, downgraded: true }
  }
  return { tier: base, reason: `${String(Math.round(averageFps))} fps measured`, downgraded: false }
}

export function resolveTier(input: {
  setting: MotionSetting
  hints: HardwareHints
  averageFps: number | null
}): TierDecision {
  if (input.setting !== 'auto') {
    return { tier: input.setting, reason: 'pinned in settings', downgraded: false }
  }
  const hardware = tierFromHardware(input.hints)
  const measured = applyFpsSample(hardware, input.averageFps)
  return {
    tier: measured.tier,
    reason: measured.downgraded ? `hardware said ${hardware}, ${measured.reason}` : `hardware: ${String(input.hints.cores)} cores`,
    downgraded: measured.downgraded
  }
}

export function budgetFor(tier: MotionTier, reducedMotion: boolean): MotionBudget {
  if (!reducedMotion) return TIER_BUDGETS[tier]
  // Reduced motion is not "low tier": it is no travel, no particles, no glow, and an instant enter.
  const base = TIER_BUDGETS.low
  return { ...base, enterMs: 1, staggerMs: 0, pressScale: 1, ambientLayers: 1 }
}

/** Clamps a skin's wish to the machine's budget, so a heavy scene never overrides a weak device. */
export function clampParticles(requested: number, budget: MotionBudget): number {
  return Math.max(0, Math.min(requested, budget.particles))
}

export const PARTICLE_KINDS = ['ember', 'spore', 'star', 'dust', 'ribbon', 'ash', 'spark'] as const
export type ParticleKind = (typeof PARTICLE_KINDS)[number]

/**
 * What a skin wants its canvas field to look like. The renderer draws it; the tier decides how much
 * of it survives, which is why `density` is a request and not a count.
 */
export interface ParticleScene {
  kind: ParticleKind
  density: number
  palette: [string, string]
  /** Multiplier on the base speed; 1 is calm, 2 is urgent. */
  speed: number
  /** Base radius in CSS pixels. */
  size: number
  /** Positive rises, negative falls, 0 floats — `seed` negates it into the vertical velocity. */
  gravity: number
  twinkle: boolean
}
