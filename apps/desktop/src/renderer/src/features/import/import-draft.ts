import {
  BUNDLED_TOWERS,
  strategyIrSchema,
  type StepAction,
  type StrategyIr,
  type StrategyStep,
  type ValidationReport
} from '@tds/shared'

export type ImportOrigin = 'link' | 'file' | 'paste'
export type EventAnswer = 'yes' | 'no' | null
export type ImportTab = 'overview' | 'content' | 'steps' | 'publish'

export interface StoredImport {
  id: string
  savedAt: number
  origin: ImportOrigin
  sourceLabel: string
  ir: StrategyIr
  report: ValidationReport | null
  eventAnswer: EventAnswer
}

const HISTORY_KEY = 'tds.import.history.v1'
const WORKING_KEY = 'tds.import.working.v1'
const HISTORY_LIMIT = 8

function idFor(ir: StrategyIr): string {
  const sha = ir.format.rawSha256?.slice(0, 20)
  return sha && sha.length > 0 ? sha : `${ir.meta.name}:${String(ir.steps.length)}`
}

function isReport(value: unknown): value is ValidationReport {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { issues?: unknown; stats?: unknown }
  return Array.isArray(candidate.issues) && Boolean(candidate.stats) && typeof candidate.stats === 'object'
}

function parseStored(value: unknown): StoredImport | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const parsed = strategyIrSchema.safeParse(candidate.ir)
  if (!parsed.success) return null
  const ir = parsed.data
  const savedAt = typeof candidate.savedAt === 'number' && Number.isFinite(candidate.savedAt) ? candidate.savedAt : Date.now()
  const origin: ImportOrigin =
    candidate.origin === 'link' || candidate.origin === 'file' || candidate.origin === 'paste' ? candidate.origin : 'paste'
  const eventAnswer: EventAnswer =
    candidate.eventAnswer === 'yes' || candidate.eventAnswer === 'no' ? candidate.eventAnswer : null
  return {
    id: typeof candidate.id === 'string' && candidate.id.length > 0 ? candidate.id : idFor(ir),
    savedAt,
    origin,
    sourceLabel: typeof candidate.sourceLabel === 'string' ? candidate.sourceLabel : '',
    ir,
    report: isReport(candidate.report) ? candidate.report : null,
    eventAnswer
  }
}

function readList(): StoredImport[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(parseStored)
      .filter((entry): entry is StoredImport => entry !== null)
      .slice(0, HISTORY_LIMIT)
  } catch {
    return []
  }
}

function writeList(entries: StoredImport[]): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)))
  } catch {
    // History is a convenience; a full quota must never block an import.
  }
}

export function readImportHistory(): StoredImport[] {
  return readList()
}

/** Newest first, one entry per source checksum so re-importing a doc refreshes its row. */
export function rememberImport(entry: StoredImport): StoredImport[] {
  const rest = readList().filter((candidate) => candidate.id !== entry.id)
  const next = [entry, ...rest].slice(0, HISTORY_LIMIT)
  writeList(next)
  return next
}

export function forgetImport(id: string): StoredImport[] {
  const next = readList().filter((entry) => entry.id !== id)
  writeList(next)
  return next
}

export function clearImportHistory(): StoredImport[] {
  try {
    window.localStorage.removeItem(HISTORY_KEY)
  } catch {
    // ignore
  }
  return []
}

export function readWorkingDraft(): StoredImport | null {
  try {
    const raw = window.localStorage.getItem(WORKING_KEY)
    if (!raw) return null
    return parseStored(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export function writeWorkingDraft(entry: StoredImport): void {
  try {
    window.localStorage.setItem(WORKING_KEY, JSON.stringify(entry))
  } catch {
    // ignore
  }
}

export function clearWorkingDraft(): void {
  try {
    window.localStorage.removeItem(WORKING_KEY)
  } catch {
    // ignore
  }
}

/**
 * The editor intentionally allows a few transient states (a blank name while retyping, an empty
 * inventory key). Those fail strategyIrSchema, and a working copy that cannot be parsed would lose
 * every edit on the next visit. Snapshots therefore store a schema-safe copy; the live draft keeps
 * showing exactly what the user typed.
 */
function storableIr(ir: StrategyIr): StrategyIr {
  return {
    ...ir,
    meta: { ...ir.meta, name: ir.meta.name.trim().length > 0 ? ir.meta.name : 'Untitled strategy' },
    inventory: ir.inventory.filter((slot) => slot.towerKey.trim().length > 0),
    steps: ir.steps.length > 0 ? ir.steps : [newStep(1)]
  }
}

export function makeStoredImport(input: {
  ir: StrategyIr
  report: ValidationReport | null
  origin: ImportOrigin
  sourceLabel: string
  eventAnswer: EventAnswer
}): StoredImport {
  const ir = storableIr(input.ir)
  return {
    id: idFor(ir),
    savedAt: Date.now(),
    origin: input.origin,
    sourceLabel: input.sourceLabel,
    ir,
    report: input.report,
    eventAnswer: input.eventAnswer
  }
}

/* ---------------------------------------------------------------- readiness */

export type ReadinessId =
  | 'name'
  | 'creator'
  | 'event'
  | 'steps'
  | 'errors'
  | 'inventory'
  | 'inventoryKeys'
  | 'unresolved'
  | 'gameMode'
  | 'map'
  | 'waveRange'
  | 'signedIn'
  | 'duplicate'

export interface ReadinessCheck {
  id: ReadinessId
  level: 'blocker' | 'warning'
  done: boolean
  detail?: string
}

export interface Readiness {
  checks: ReadinessCheck[]
  blockers: ReadinessCheck[]
  warnings: ReadinessCheck[]
  score: number
}

function finalize(checks: ReadinessCheck[]): Readiness {
  const blockers = checks.filter((check) => !check.done && check.level === 'blocker')
  const warnings = checks.filter((check) => !check.done && check.level === 'warning')
  const score = Math.max(0, Math.min(100, 100 - blockers.length * 20 - warnings.length * 4))
  return { checks, blockers, warnings, score }
}

/**
 * inventoryEmpty/noSteps are parser-level errors, not schema errors: they are fixed in the editor
 * (add a tower, add a step) rather than in the source document. Keeping them in the live report
 * would leave a permanent red error after the user has already fixed the underlying data.
 */
const CONTENT_ERROR_CODES = new Set(['inventoryEmpty', 'inventoryTooLarge', 'noSteps'])

export function withLiveContentIssues(report: ValidationReport | null): ValidationReport | null {
  if (!report) return null
  const issues = report.issues.filter(
    (issue) => !(issue.level === 'error' && CONTENT_ERROR_CODES.has(issue.code))
  )
  const errors = issues.filter((issue) => issue.level === 'error')
  return {
    issues,
    errors,
    warnings: issues.filter((issue) => issue.level === 'warning'),
    stats: report.stats,
    ok: errors.length === 0
  }
}

export function baseReadiness(ir: StrategyIr, report: ValidationReport | null, eventAnswer: EventAnswer): Readiness {
  const unresolved = ir.steps.filter((step) => step.unresolved).length
  return finalize([
    { id: 'name', level: 'blocker', done: ir.meta.name.trim().length > 0 },
    { id: 'creator', level: 'blocker', done: ir.meta.credit.creator.trim().length > 0 },
    { id: 'event', level: 'blocker', done: eventAnswer !== null },
    { id: 'steps', level: 'blocker', done: ir.steps.length > 0 },
    { id: 'errors', level: 'blocker', done: (report?.errors.length ?? 0) === 0 },
    { id: 'inventory', level: 'blocker', done: ir.inventory.length > 0 },
    {
      id: 'inventoryKeys',
      level: 'blocker',
      done: ir.inventory.every((slot) => slot.towerKey.trim().length > 0)
    },
    { id: 'unresolved', level: 'warning', done: unresolved === 0, detail: unresolved > 0 ? String(unresolved) : undefined },
    { id: 'gameMode', level: 'warning', done: ir.meta.gameMode.resolved },
    { id: 'map', level: 'warning', done: Boolean(ir.meta.map.key ?? ir.meta.map.raw) },
    { id: 'waveRange', level: 'warning', done: Boolean(ir.meta.waveRange) }
  ])
}

export function publishReadiness(
  base: Readiness,
  input: { signedIn: boolean; duplicate: { name: string; status: string } | null }
): Readiness {
  return finalize([
    ...base.checks,
    { id: 'signedIn', level: 'blocker', done: input.signedIn },
    {
      id: 'duplicate',
      level: 'blocker',
      done: input.duplicate === null,
      detail: input.duplicate ? `${input.duplicate.name} · ${input.duplicate.status}` : undefined
    }
  ])
}

export function findOwnDuplicate(
  ir: StrategyIr,
  own: Array<{ name: string; status: string }> | undefined
): { name: string; status: string } | null {
  if (!own) return null
  const needle = ir.meta.name.trim().toLocaleLowerCase()
  if (!needle) return null
  const match = own.find((entry) => entry.name.trim().toLocaleLowerCase() === needle)
  return match ? { name: match.name, status: match.status } : null
}

/* ---------------------------------------------------------------- step quality */

export type StepFlagId = 'unresolved' | 'noWave' | 'placementNoTower' | 'upgradeNoLevel' | 'emptyRaw'

export function stepFlags(step: StrategyStep): StepFlagId[] {
  const flags: StepFlagId[] = []
  if (step.unresolved) flags.push('unresolved')
  if (step.waveFrom === undefined) flags.push('noWave')
  if (step.action === 'place' && !step.towerKey) flags.push('placementNoTower')
  if ((step.action === 'upgrade' || step.action === 'max') && step.level === undefined) flags.push('upgradeNoLevel')
  if (step.raw.trim().length === 0) flags.push('emptyRaw')
  return flags
}

export interface StepInsights {
  total: number
  unresolved: number
  flagged: number
  withWave: number
  span: [number, number] | null
  actions: Array<{ action: StepAction; count: number }>
  towers: Array<{ key: string; count: number }>
}

export function stepInsights(steps: StrategyStep[]): StepInsights {
  const actions = new Map<StepAction, number>()
  const towers = new Map<string, number>()
  let unresolved = 0
  let flagged = 0
  let withWave = 0
  let min: number | null = null
  let max: number | null = null

  for (const step of steps) {
    actions.set(step.action, (actions.get(step.action) ?? 0) + 1)
    if (step.towerKey) towers.set(step.towerKey, (towers.get(step.towerKey) ?? 0) + 1)
    if (step.unresolved) unresolved += 1
    if (stepFlags(step).length > 0) flagged += 1
    if (step.waveFrom !== undefined) {
      withWave += 1
      const high = step.waveTo ?? step.waveFrom
      min = min === null ? step.waveFrom : Math.min(min, step.waveFrom)
      max = max === null ? high : Math.max(max, high)
    }
  }

  return {
    total: steps.length,
    unresolved,
    flagged,
    withWave,
    span: min !== null && max !== null ? [min, max] : null,
    actions: [...actions.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
    towers: [...towers.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
  }
}

export function towerSuggestions(ir: StrategyIr, steps: StrategyStep[]): string[] {
  const keys = new Set<string>()
  for (const entry of BUNDLED_TOWERS) keys.add(entry.key)
  for (const slot of ir.inventory) keys.add(slot.towerKey)
  for (const step of steps) if (step.towerKey) keys.add(step.towerKey)
  return [...keys].sort((a, b) => a.localeCompare(b))
}

export function newStep(stepNo: number): StrategyStep {
  return { stepNo, action: 'note', alternatives: [], raw: '', unresolved: false }
}

export const PASTE_SAMPLE = `**Örnek Kule Stratejisi**
**Solo · Medium · 1 - 20 dalga**

# Credits

Creator: @senin-adin
Contributor: @arkadasin

# Notes

* Group üyeliği gerekli.
* Skill tree gerekli değil.
* Operator maksimum XP seviyesinde olmalı.

# Strategy

| Difficulty: Medium |  |  |
| :---: | :---: | :---: |
| **Operator** | **DJ Booth** | **Commander** |
| **Placement Map** | Haritanın arka tarafı |  |
| **Wave Skipping Tips** | İlk 10 dalgada atlama yok. |  |
| **Waves: 1 - 10** | Place 2 Lv 2 **Operators** > Place Lv 3 **DJ Booth** > Upgrade all **Operators** to Lv 3 |  |
| **Waves: 11 - 20** | Max **DJ Booth** > Place Lv 2 **Commander** > Max **Operators** |  |

# Common Issues

| Waves | Reasons |
| :---: | ----- |
| **1 - 10** | Yavaş Operator yükseltmesi |
| **11 - 20** | DJ Booth track değişmemesi |

# Proofs

No Skill Tree
**Best Time - 9:43**
**[15.6K Coins Per Hour]**
`
