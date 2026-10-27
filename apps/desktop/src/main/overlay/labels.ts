import type { StrategyIr, StrategyStep } from '@tds/shared'

const HUMAN_LABELS: Record<string, string> = {
  'dj-booth': 'DJ Booth',
  'merc-base': 'Merc Base',
  'field-medic': 'Field Medic'
}

export function prettifyTowerKey(key: string | undefined): string | undefined {
  if (!key) return undefined
  const known = HUMAN_LABELS[key]
  if (known) return known
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function waveLabel(step: StrategyStep): string | undefined {
  if (step.waveFrom === undefined) return undefined
  if (step.waveTo === undefined || step.waveTo === step.waveFrom) return `Wave ${step.waveFrom}`
  return `Wave ${step.waveFrom}-${step.waveTo}`
}

export interface TrackedStepHealth {
  stepNo: number
  worked: number
  stuck: number
  marked: boolean
  verdict?: 'worked' | 'stuck'
}

export interface TrackedStrategy {
  id: string
  name: string
  isEventStrategy: boolean
  mapName?: string
  difficulty?: string
  bestTime?: string
  modifierNotes: string[]
  placementImageRef?: string
  steps: StrategyStep[]
  /** Catalog keys to the member's language, filled by the renderer that owns the catalog. */
  towerNamesTr: Record<string, string>
  /** Step number to what the community and this account said about it. */
  health: Record<number, TrackedStepHealth>
}

export function strategyFromIr(
  ir: StrategyIr,
  id = `local:${ir.meta.name}`,
  towerNamesTr: Record<string, string> = {},
  stepHealth: TrackedStepHealth[] = []
): TrackedStrategy {
  return {
    id,
    name: ir.meta.name,
    isEventStrategy: ir.meta.event.isEvent,
    mapName: ir.meta.map.key,
    difficulty: ir.meta.difficulty,
    bestTime: ir.proofs[0]?.bestTime,
    modifierNotes: ir.mutators.map((mutator) => mutator.note ?? mutator.raw).filter(Boolean),
    placementImageRef: ir.placement.imageRef,
    steps: ir.steps,
    towerNamesTr,
    health: Object.fromEntries(stepHealth.map((entry) => [entry.stepNo, entry]))
  }
}
