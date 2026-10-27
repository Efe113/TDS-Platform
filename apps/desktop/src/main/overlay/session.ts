import { randomUUID } from 'node:crypto'
import type { OverlayState, OverlayStepCard, UsageEvent } from '@tds/shared'
import { prettifyTowerKey, waveLabel, type TrackedStrategy } from './labels'

const cardFrom = (
  step: TrackedStrategy['steps'][number] | undefined,
  total: number,
  strategy: TrackedStrategy
): OverlayStepCard | null => {
  if (!step) return null
  const localName = step.towerKey === undefined ? undefined : strategy.towerNamesTr[step.towerKey]
  const health = strategy.health[step.stepNo]
  return {
    stepNo: step.stepNo,
    totalSteps: total,
    waveFrom: step.waveFrom,
    waveTo: step.waveTo,
    waveLabel: waveLabel(step),
    action: step.action,
    towerLabel: prettifyTowerKey(step.towerKey),
    // The catalog's Turkish name when the renderer had one; the prettified key otherwise. The field
    // existed on the card for two releases with nobody producing it.
    towerLabelTr: localName,
    level: step.level,
    count: step.count,
    seconds: step.seconds,
    repeat: step.repeat,
    condition: step.condition,
    // Display labels, like every other field on the card: the overlay has no catalog to look keys up in.
    alternatives: step.alternatives
      .filter((key) => key.length > 0 && key !== step.towerKey)
      .map((key) => strategy.towerNamesTr[key] ?? prettifyTowerKey(key) ?? key),
    spec: step.spec,
    note: step.note,
    raw: step.raw,
    unresolved: step.unresolved,
    worked: health?.worked,
    stuck: health?.stuck,
    marked: health?.marked,
    verdict: health?.verdict
  }
}

export class OverlaySession {
  private strategy: TrackedStrategy | null = null
  private cursor = 0
  private sessionId: string | null = null
  private startedAt: number | null = null
  private seq = 0
  private events: UsageEvent[] = []
  private readonly listeners = new Set<(state: OverlayState | null) => void>()

  get hasStrategy(): boolean {
    return this.strategy !== null
  }

  get activeSessionId(): string | null {
    return this.sessionId
  }

  load(strategy: TrackedStrategy, startSession = true): void {
    this.strategy = strategy
    this.cursor = 0
    if (startSession) this.beginSession()
    this.emit()
  }

  unload(): void {
    this.endSession()
    this.strategy = null
    this.cursor = 0
    this.emit()
  }

  next(): void {
    if (!this.strategy) return
    const last = this.strategy.steps.length - 1
    if (this.cursor < last) {
      this.cursor += 1
      this.record('forward')
    }
    this.emit()
  }

  previous(): void {
    if (!this.strategy) return
    if (this.cursor > 0) {
      this.cursor -= 1
      this.record('back')
    }
    this.emit()
  }

  reset(): void {
    if (!this.strategy) return
    this.cursor = 0
    this.record('reset')
    this.emit()
  }

  jumpTo(index: number): void {
    if (!this.strategy) return
    const previous = this.cursor
    const bounded = Math.max(0, Math.min(index, this.strategy.steps.length - 1))
    if (bounded === previous) return
    this.cursor = bounded
    this.record(bounded > previous ? 'forward' : 'back')
    this.emit()
  }

  state(): OverlayState | null {
    if (!this.strategy) return null
    const steps = this.strategy.steps
    const total = steps.length
    const current = cardFrom(steps[this.cursor], total, this.strategy)
    const summary = this.sessionSummary()

    return {
      strategyId: this.strategy.id,
      strategyName: this.strategy.name,
      isEventStrategy: this.strategy.isEventStrategy,
      mapName: this.strategy.mapName,
      difficulty: this.strategy.difficulty,
      bestTime: this.strategy.bestTime,
      modifierNotes: this.strategy.modifierNotes,
      stepIndex: this.cursor,
      current,
      upcoming: [steps[this.cursor + 1], steps[this.cursor + 2]]
        .filter((step): step is TrackedStrategy['steps'][number] => Boolean(step))
        .map((step) => cardFrom(step, total, this.strategy as TrackedStrategy))
        .filter((card): card is OverlayStepCard => card !== null),
      placementImageRef: this.strategy.placementImageRef,
      totalSteps: total,
      visible: true,
      sessionId: summary.sessionId,
      sessionStartedAt: summary.startedAt,
      stepsAdvanced: summary.stepsAdvanced,
      maxStep: summary.maxStep,
      // Which is what tells the rail and the card to say "önbellekten" instead of passing a number
      // saved hours ago as if the database had just produced it.
      source: this.strategy.source,
      savedAt: this.strategy.savedAt
    }
  }

  drainEvents(): UsageEvent[] {
    const drained = this.events
    this.events = []
    return drained
  }

  sessionSummary(): { sessionId: string | null; startedAt: number | null; stepsAdvanced: number; maxStep: number } {
    const forward = this.events.filter((event) => event.direction === 'forward').length
    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      stepsAdvanced: forward,
      maxStep: this.cursor + 1
    }
  }

  onChange(listener: (state: OverlayState | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private beginSession(): void {
    this.sessionId = randomUUID()
    this.startedAt = Date.now()
    this.seq = 0
  }

  private endSession(): void {
    this.sessionId = null
    this.startedAt = null
  }

  private record(direction: UsageEvent['direction']): void {
    if (!this.sessionId) return
    this.seq += 1
    this.events.push({ seq: this.seq, stepNo: this.cursor + 1, direction, at: Date.now() })
  }

  private emit(): void {
    const state = this.state()
    for (const listener of this.listeners) listener(state)
  }
}

export const overlaySession = new OverlaySession()
