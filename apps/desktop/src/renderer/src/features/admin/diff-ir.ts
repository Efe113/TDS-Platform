import { strategyIrSchema, type InventorySlot, type StrategyIr, type StrategyStep } from '@tds/shared'

export type DiffKind = 'added' | 'removed' | 'changed'

export interface StepChange {
  kind: DiffKind
  stepNo: number
  before: StrategyStep | null
  after: StrategyStep | null
  fields: string[]
}

export interface InventoryChange {
  kind: DiffKind
  towerKey: string
  before: InventorySlot | null
  after: InventorySlot | null
}

export interface MetaChange {
  field: string
  before: string
  after: string
}

export interface IrDiff {
  steps: StepChange[]
  inventory: InventoryChange[]
  meta: MetaChange[]
}

/**
 * `content` is untrusted jsonb and strategyIrSchema strips unknown keys, so retired concepts can
 * never reach the screen through the diff.
 */
export function loadIr(content: unknown): StrategyIr | null {
  const parsed = strategyIrSchema.safeParse(content)
  return parsed.success ? parsed.data : null
}

function numText(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

const STEP_FIELDS: readonly { name: string; read: (step: StrategyStep) => string }[] = [
  { name: 'waveFrom', read: (step) => numText(step.waveFrom) },
  { name: 'waveTo', read: (step) => numText(step.waveTo) },
  { name: 'phase', read: (step) => step.phase ?? '' },
  { name: 'action', read: (step) => step.action },
  { name: 'towerKey', read: (step) => step.towerKey ?? '' },
  { name: 'level', read: (step) => numText(step.level) },
  { name: 'count', read: (step) => numText(step.count) },
  { name: 'alternatives', read: (step) => step.alternatives.join(', ') },
  { name: 'spec', read: (step) => step.spec ?? '' },
  { name: 'note', read: (step) => step.note ?? '' },
  { name: 'raw', read: (step) => step.raw },
  { name: 'unresolved', read: (step) => (step.unresolved ? '1' : '') }
]

const META_FIELDS: readonly { name: string; read: (ir: StrategyIr) => string }[] = [
  { name: 'name', read: (ir) => ir.meta.name },
  { name: 'subtitle', read: (ir) => ir.meta.subtitle ?? '' },
  { name: 'description', read: (ir) => ir.meta.description ?? '' },
  { name: 'difficulty', read: (ir) => ir.meta.difficulty },
  { name: 'gameMode', read: (ir) => ir.meta.gameMode.key },
  { name: 'playerCount', read: (ir) => ir.meta.playerCount },
  { name: 'map', read: (ir) => ir.meta.map.key ?? ir.meta.map.raw ?? '' },
  { name: 'isEvent', read: (ir) => (ir.meta.event.isEvent ? '1' : '') },
  { name: 'eventKey', read: (ir) => ir.meta.event.eventKey ?? '' },
  { name: 'waveRange', read: (ir) => (ir.meta.waveRange ? `${String(ir.meta.waveRange[0])}-${String(ir.meta.waveRange[1])}` : '') },
  { name: 'durationMinutes', read: (ir) => numText(ir.meta.durationMinutes) },
  { name: 'creditCreator', read: (ir) => ir.meta.credit.creator },
  { name: 'creditContributors', read: (ir) => ir.meta.credit.contributors.join(', ') },
  { name: 'creditSourceUrl', read: (ir) => ir.meta.credit.sourceUrl ?? '' },
  { name: 'isAuthorOwn', read: (ir) => (ir.meta.credit.isAuthorOwn ? '1' : '') },
  { name: 'versionLabel', read: (ir) => ir.meta.versionLabel ?? '' },
  { name: 'povVideoUrl', read: (ir) => ir.meta.povVideoUrl ?? '' },
  { name: 'tags', read: (ir) => ir.meta.tags.join(', ') }
]

function stepMap(steps: readonly StrategyStep[]): Map<number, StrategyStep> {
  const map = new Map<number, StrategyStep>()
  for (const step of steps) map.set(step.stepNo, step)
  return map
}

function changedStepFields(before: StrategyStep, after: StrategyStep): string[] {
  const fields: string[] = []
  for (const field of STEP_FIELDS) {
    if (field.read(before) !== field.read(after)) fields.push(field.name)
  }
  return fields
}

function describeSlot(slot: InventorySlot | null): string {
  if (!slot) return ''
  const parts: string[] = []
  if (slot.count !== undefined) parts.push(`x${String(slot.count)}`)
  if (slot.alternatives.length > 0) parts.push(`alt: ${slot.alternatives.join(', ')}`)
  if (slot.notes) parts.push(slot.notes)
  if (slot.unresolved) parts.push('unresolved')
  return parts.join(' · ')
}

function diffSteps(before: readonly StrategyStep[], after: readonly StrategyStep[]): StepChange[] {
  const beforeMap = stepMap(before)
  const afterMap = stepMap(after)
  const stepNos = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort((a, b) => a - b)
  const changes: StepChange[] = []

  for (const stepNo of stepNos) {
    const oldStep = beforeMap.get(stepNo) ?? null
    const newStep = afterMap.get(stepNo) ?? null
    if (!oldStep && newStep) {
      changes.push({ kind: 'added', stepNo, before: null, after: newStep, fields: [] })
    } else if (oldStep && !newStep) {
      changes.push({ kind: 'removed', stepNo, before: oldStep, after: null, fields: [] })
    } else if (oldStep && newStep) {
      const fields = changedStepFields(oldStep, newStep)
      if (fields.length > 0) changes.push({ kind: 'changed', stepNo, before: oldStep, after: newStep, fields })
    }
  }
  return changes
}

function diffInventory(before: readonly InventorySlot[], after: readonly InventorySlot[]): InventoryChange[] {
  const beforeMap = new Map(before.map((slot) => [slot.towerKey, slot]))
  const afterMap = new Map(after.map((slot) => [slot.towerKey, slot]))
  const keys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort()
  const changes: InventoryChange[] = []

  for (const towerKey of keys) {
    const oldSlot = beforeMap.get(towerKey) ?? null
    const newSlot = afterMap.get(towerKey) ?? null
    if (!oldSlot && newSlot) changes.push({ kind: 'added', towerKey, before: null, after: newSlot })
    else if (oldSlot && !newSlot) changes.push({ kind: 'removed', towerKey, before: oldSlot, after: null })
    else if (oldSlot && newSlot && describeSlot(oldSlot) !== describeSlot(newSlot)) {
      changes.push({ kind: 'changed', towerKey, before: oldSlot, after: newSlot })
    }
  }
  return changes
}

function diffMeta(before: StrategyIr, after: StrategyIr): MetaChange[] {
  const changes: MetaChange[] = []
  for (const field of META_FIELDS) {
    const oldValue = field.read(before)
    const newValue = field.read(after)
    if (oldValue !== newValue) changes.push({ field: field.name, before: oldValue, after: newValue })
  }
  return changes
}

export function diffIr(before: StrategyIr, after: StrategyIr): IrDiff {
  return {
    steps: diffSteps(before.steps, after.steps),
    inventory: diffInventory(before.inventory, after.inventory),
    meta: diffMeta(before, after)
  }
}

export function isDiffEmpty(diff: IrDiff): boolean {
  return diff.steps.length === 0 && diff.inventory.length === 0 && diff.meta.length === 0
}

export function diffTotals(diff: IrDiff): { added: number; removed: number; changed: number } {
  const rows = [...diff.steps, ...diff.inventory]
  return {
    added: rows.filter((row) => row.kind === 'added').length,
    removed: rows.filter((row) => row.kind === 'removed').length,
    changed: rows.filter((row) => row.kind === 'changed').length + diff.meta.length
  }
}

export function stepLine(step: StrategyStep | null): string {
  if (!step) return ''
  const wave = step.waveFrom === undefined ? '' : `${numText(step.waveFrom)}${step.waveTo === undefined ? '' : `-${numText(step.waveTo)}`}`
  const head = [step.action, step.towerKey ?? '', step.level === undefined ? '' : `L${String(step.level)}`]
    .filter((part) => part.length > 0)
    .join(' ')
  const detail = step.raw.trim()
  return [wave.length > 0 ? `w${wave}` : '', head, detail].filter((part) => part.length > 0).join(' · ')
}

export function inventoryLine(slot: InventorySlot | null): string {
  if (!slot) return ''
  return `${slot.towerKey}${slot.count === undefined ? '' : ` x${String(slot.count)}`}${describeSlot(slot).length > 0 ? ` · ${describeSlot(slot)}` : ''}`
}
