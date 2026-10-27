import { describe, expect, it } from 'vitest'
import { detectWaveRange, parseStepLines, splitBulletHeuristic, splitChains } from '../src/import/step-grammar'
import { TowerDictionary, findTowers, matchTowerLabel, BUNDLED_TOWERS } from '../src/import/tower-dict'

const dict = new TowerDictionary(BUNDLED_TOWERS)

describe('step grammar', () => {
  it('creates one step per arrow in a chain', () => {
    const { steps } = parseStepLines(
      ['Place 3 Lv 2 Operators > 11 Lv 2 Operators > Max DJ Booth'],
      { startStepNo: 1, waveFrom: 1, waveTo: 20 },
      dict
    )

    expect(steps.map((step) => step.action)).toEqual(['place', 'place', 'max'])
    expect(steps.map((step) => step.stepNo)).toEqual([1, 2, 3])
    expect(steps[0]?.towerKey).toBe('operator')
    expect(steps[0]?.count).toBe(3)
    expect(steps[0]?.level).toBe(2)
    expect(steps[2]?.towerKey).toBe('dj-booth')
    for (const step of steps) expect(step.waveFrom).toBe(1)
  })

  it('reads level, spec and alternatives from a complex clause', () => {
    const { steps } = parseStepLines(
      ['Place 1 Lv 2 Commander or 1 Lv 3 Merc Base [3 Rifleman, 1 Field Medic]'],
      { startStepNo: 7 },
      dict
    )

    const step = steps[0]
    expect(step?.action).toBe('place')
    expect(step?.towerKey).toBe('commander')
    expect(step?.spec).toBe('3 Rifleman, 1 Field Medic')
    expect(step?.alternatives).toContain('merc-base')
    expect(steps.length).toBe(1)
  })

  it('upgrades to an explicit level and drops filler words', () => {
    const { steps } = parseStepLines(['Upgrade all Operators to Lv 4'], { startStepNo: 1 }, dict)
    expect(steps[0]?.action).toBe('upgrade')
    expect(steps[0]?.towerKey).toBe('operator')
    expect(steps[0]?.level).toBe(4)
  })

  it('keeps unparseable instructions as raw text instead of dropping them', () => {
    const { steps, unresolvedCount } = parseStepLines(['Do the thing with the mystery unit'], { startStepNo: 1 }, dict)
    expect(steps[0]?.raw).toBe('Do the thing with the mystery unit')
    expect(['raw', 'note']).toContain(steps[0]?.action)
    expect(unresolvedCount).toBe(1)
  })

  it('splits flattened markdown cells on verb boundaries', () => {
    const lines = splitBulletHeuristic(
      'Place 3 Lv 2 Operators > 11 Lv 2 Operators Place Lv 3 DJ Booth [Green Track] > Upgrade all Operators to Lv 4 > Max DJ Booth'
    )
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.some((line) => line.startsWith('Place Lv 3 DJ Booth'))).toBe(true)
  })

  it('splits chains on arrows only', () => {
    expect(splitChains('Max Shotgunners > Max Operators > Max 3 Commanders')).toHaveLength(3)
  })

  it('detects wave ranges from row labels', () => {
    expect(detectWaveRange('Waves: 1 - 20')).toEqual({ waveFrom: 1, waveTo: 20 })
    expect(detectWaveRange('21-40')).toEqual({})
    expect(detectWaveRange('Waves: 21-40')).toEqual({ waveFrom: 21, waveTo: 40 })
  })

  it('reads a duration as a duration, not as a number of towers', () => {
    const { steps } = parseStepLines(['Wait 45s before the next wave'], { startStepNo: 1 }, dict)
    expect(steps[0]?.action).toBe('wait')
    expect(steps[0]?.seconds).toBe(45)
    expect(steps[0]?.count).toBeUndefined()

    const minutes = parseStepLines(['Hold 2 dk'], { startStepNo: 1 }, dict).steps[0]
    expect(minutes?.seconds).toBe(120)
  })

  it('reads how many times an instruction runs', () => {
    const { steps } = parseStepLines(['Place 3 Lv 2 Operators ×3'], { startStepNo: 1 }, dict)
    expect(steps[0]?.repeat).toBe(3)
    expect(steps[0]?.count).toBe(3)

    const single = parseStepLines(['Place Sniper ×1'], { startStepNo: 1 }, dict)
    expect(single.steps[0]?.repeat).toBeUndefined()
  })

  it('keeps the branch a step sits behind', () => {
    const { steps } = parseStepLines(['If the boss walks left: place 1 Lv 3 Sniper'], { startStepNo: 1 }, dict)
    expect(steps[0]?.condition).toBe('the boss walks left')
    expect(steps[0]?.towerKey).toBe('sniper')
    expect(steps[0]?.raw).toBe('If the boss walks left: place 1 Lv 3 Sniper')

    const turkish = parseStepLines(['Eğer para buffu aldıysan upgrade all Operators to Lv 4'], { startStepNo: 1 }, dict)
    expect(turkish.steps[0]?.condition).toBe('para buffu aldıysan')
    expect(turkish.steps[0]?.action).toBe('upgrade')
    expect(turkish.steps[0]?.towerKey).toBe('operator')

    const noteOnly = parseStepLines(['When the money buff is up'], { startStepNo: 1 }, dict)
    expect(noteOnly.steps[0]?.action).toBe('note')
    expect(noteOnly.steps[0]?.condition).toBeDefined()
  })
})

describe('tower dictionary', () => {
  it('resolves plural, spaced and mixed-token labels', () => {
    expect(dict.lookup('Operators')).toBe('operator')
    expect(dict.lookup('Merc Bases')).toBe('merc-base')
    expect(matchTowerLabel('Commander/Merc Base', dict).keys).toEqual(['commander', 'merc-base'])
  })

  it('scans sentences for towers', () => {
    expect(findTowers('It is needed to have Juggernaut at level 16 XP', dict)).toEqual(['juggernaut'])
    expect(findTowers('Nothing catalogued here', dict)).toEqual([])
  })

  it('accepts injected catalog entries over the bundled subset', () => {
    const custom = new TowerDictionary([{ key: 'mystery-tower', aliases: ['mystery unit'] }])
    expect(custom.lookup('mystery units')).toBe('mystery-tower')
  })
})
