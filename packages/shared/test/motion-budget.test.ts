import { describe, expect, it } from 'vitest'
import {
  FPS_DOWNGRADE_BELOW,
  TIER_BUDGETS,
  applyFpsSample,
  budgetFor,
  clampParticles,
  resolveTier,
  tierFromHardware
} from '../src/domain/motion'

const strong = { cores: 16, memoryGb: 16, reducedMotion: false }
const weak = { cores: 4, memoryGb: 4, reducedMotion: false }

describe('motion tiers', () => {
  it('orders the budgets so a higher tier is always the heavier one', () => {
    expect(TIER_BUDGETS.low.particles).toBe(0)
    expect(TIER_BUDGETS.medium.particles).toBeLessThan(TIER_BUDGETS.high.particles)
    expect(TIER_BUDGETS.low.blur).toBe(false)
    expect(TIER_BUDGETS.low.enterMs).toBeLessThan(TIER_BUDGETS.high.enterMs)
  })

  it('reads weak hardware as low and does not guess when deviceMemory is missing', () => {
    expect(tierFromHardware(weak)).toBe('low')
    expect(tierFromHardware(strong)).toBe('high')
    expect(tierFromHardware({ cores: 24, memoryGb: null, reducedMotion: false })).toBe('high')
    expect(tierFromHardware({ cores: 8, memoryGb: null, reducedMotion: false })).toBe('medium')
  })

  it('lets a measured frame rate only lower the tier', () => {
    const downgraded = applyFpsSample('high', FPS_DOWNGRADE_BELOW - 5)
    expect(downgraded.tier).toBe('medium')
    expect(downgraded.downgraded).toBe(true)

    expect(applyFpsSample('high', 120).tier).toBe('high')
    expect(applyFpsSample('low', 12).tier).toBe('low')
    expect(applyFpsSample('high', 12).tier).toBe('low')
    // No sample yet: the hardware answer stands, and the reason says so.
    expect(applyFpsSample('medium', null).tier).toBe('medium')
  })

  it('honours a pinned setting over both hardware and measurement', () => {
    const pinned = resolveTier({ setting: 'high', hints: weak, averageFps: 8 })
    expect(pinned.tier).toBe('high')
    expect(pinned.reason).toBe('pinned in settings')

    const auto = resolveTier({ setting: 'auto', hints: strong, averageFps: 30 })
    expect(auto.tier).toBe('medium')
    expect(auto.reason).toContain('hardware said high')
  })

  it('collapses to no travel under reduced motion, whatever the tier', () => {
    const reduced = budgetFor('high', true)
    expect(reduced.particles).toBe(0)
    expect(reduced.parallax).toBe(0)
    expect(reduced.staggerMs).toBe(0)
    expect(reduced.pressScale).toBe(1)
    expect(reduced.enterMs).toBe(1)
  })

  it('clamps a skin scene to the machine budget instead of letting it override', () => {
    expect(clampParticles(200, TIER_BUDGETS.low)).toBe(0)
    expect(clampParticles(200, TIER_BUDGETS.medium)).toBe(44)
    expect(clampParticles(20, TIER_BUDGETS.high)).toBe(20)
    expect(clampParticles(-5, TIER_BUDGETS.high)).toBe(0)
  })
})
