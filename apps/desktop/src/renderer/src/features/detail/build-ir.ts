import type { ZodError } from 'zod'
import {
  formatBestTime,
  type InventorySlot,
  type MediaRef,
  type MutatorEntry,
  type ProofEntry,
  type RequirementEntry,
  type StepAction,
  type StrategyDetail,
  type StrategyStep,
  type TroubleshootingEntry,
  type VersionDetail,
  type WaveSkipRule
} from '@tds/shared'
import { STEP_ACTIONS } from '../../lib/actions'
import { humanTowerLabel } from '../../lib/text'

/** The IR contract caps inventory at five towers; the DB enforces the same limit. */
const INVENTORY_CAP = 5

const MEDIA_KINDS: readonly string[] = ['map', 'tower-icon', 'modifier', 'proof', 'unknown']

function text(value: string | null): string | undefined {
  return value ?? undefined
}

function actionOf(value: string): StepAction {
  const known: readonly string[] = STEP_ACTIONS
  return known.includes(value) ? (value as StepAction) : 'raw'
}

function mediaKindOf(kind: string): MediaRef['kind'] {
  return MEDIA_KINDS.includes(kind) ? (kind as MediaRef['kind']) : 'unknown'
}

export function toIrSteps(version: VersionDetail): StrategyStep[] {
  return [...version.strategy_steps]
    .sort((a, b) => a.step_no - b.step_no)
    .map((row) => ({
      stepNo: row.step_no,
      ...(row.wave_from !== null ? { waveFrom: row.wave_from } : {}),
      ...(row.wave_to !== null ? { waveTo: row.wave_to } : {}),
      ...(row.phase ? { phase: row.phase } : {}),
      action: actionOf(row.action),
      ...(row.tower_key ? { towerKey: row.tower_key } : {}),
      ...(row.level !== null && row.level > 0 ? { level: row.level } : {}),
      ...(row.count !== null && row.count > 0 ? { count: row.count } : {}),
      alternatives: [],
      ...(row.spec ? { spec: row.spec } : {}),
      ...(row.note ? { note: row.note } : {}),
      raw: row.raw_text,
      unresolved: row.unresolved
    }))
}

export function toIrInventory(version: VersionDetail): InventorySlot[] {
  return [...version.strategy_inventory]
    .sort((a, b) => a.slot - b.slot)
    .slice(0, INVENTORY_CAP)
    .map((row) => ({
      towerKey: row.tower_key,
      rawLabel: row.towers?.name_tr || row.towers?.name_en || humanTowerLabel(row.tower_key) || row.tower_key,
      alternatives: row.alternatives,
      ...(text(row.notes) ? { notes: text(row.notes) } : {}),
      // No catalog row means the key is not in the tower catalog yet.
      unresolved: row.towers === null
    }))
}

function toIrProofs(version: VersionDetail): ProofEntry[] {
  return version.strategy_proofs.map((row) => ({
    label: row.label,
    // The detail query does not read strategy_proofs.setup, so nothing is invented here.
    setup: [],
    bestTime: formatBestTime(row.best_time_sec),
    coinsPerHour: text(row.coins_per_hour),
    xpPerHour: text(row.xp_per_hour),
    mediaRefs: []
  }))
}

function toIrMedia(version: VersionDetail): MediaRef[] {
  return version.strategy_media.map((row, index) => ({
    id: `${row.kind}-${String(index)}`,
    kind: mediaKindOf(row.kind),
    storagePath: row.storage_path,
    ...(row.width !== null ? { width: row.width } : {}),
    ...(row.height !== null ? { height: row.height } : {})
  }))
}

/**
 * Builds the tracking record from published rows only. The caller still runs strategyIrSchema, so a
 * row that cannot be mapped faithfully fails loudly instead of being patched with invented values.
 */
export function buildIrInput(detail: StrategyDetail, version: VersionDetail): Record<string, unknown> {
  const waveRange =
    detail.wave_from !== null && detail.wave_to !== null ? ([detail.wave_from, detail.wave_to] as [number, number]) : undefined

  const requirements: RequirementEntry[] = version.strategy_requirements.map((row) => ({
    kind: row.kind as RequirementEntry['kind'],
    value: row.value,
    ...(text(row.detail) ? { detail: text(row.detail) } : {})
  }))

  const waveSkip: WaveSkipRule[] = version.strategy_wave_skip_rules.map((row) => ({
    kind: row.kind as WaveSkipRule['kind'],
    ...(text(row.waves) ? { waves: text(row.waves) } : {}),
    ...(text(row.condition) ? { condition: text(row.condition) } : {}),
    raw: row.raw_text ?? ''
  }))

  const mutators: MutatorEntry[] = version.strategy_modifiers.map((row) => ({
    key: text(row.mutator_key),
    matchedBy: row.matched_by as MutatorEntry['matchedBy'],
    ...(text(row.note) ? { note: text(row.note) } : {}),
    raw: ''
  }))

  const troubleshooting: TroubleshootingEntry[] = version.strategy_troubleshooting.map((row) => ({
    waves: row.waves,
    reasons: row.reasons
  }))

  return {
    formatVersion: 'tds.strategy.ir/v1',
    format: {
      source: 'gdocs-md',
      sourceUrl: text(detail.credit_url),
      rawSha256: undefined,
      unmapped: []
    },
    meta: {
      name: detail.name,
      subtitle: text(detail.subtitle),
      description: text(detail.description),
      difficulty: detail.difficulty,
      gameMode: { key: detail.game_mode, raw: detail.game_mode, resolved: detail.game_mode !== 'unknown' },
      playerCount: detail.player_count,
      map: { key: text(detail.map_key) },
      event: { isEvent: detail.is_event_strategy, eventKey: text(detail.event_key) },
      ...(waveRange ? { waveRange } : {}),
      durationMinutes: detail.duration_min ?? undefined,
      credit: {
        creator: detail.credit_creator ?? '',
        contributors: detail.credit_contributors,
        sourceUrl: text(detail.credit_url),
        isAuthorOwn: detail.is_author_own
      },
      versionLabel: String(version.version_no)
    },
    requirements,
    inventory: toIrInventory(version),
    mutators,
    waveSkip,
    steps: toIrSteps(version),
    troubleshooting,
    proofs: toIrProofs(version),
    hallOfFame: version.strategy_hof.map((row) => ({
      comp: row.comp,
      bestTime: formatBestTime(row.best_time_sec),
      notes: text(row.notes),
      mediaRefs: []
    })),
    notes: [],
    media: toIrMedia(version)
  }
}

/** Issue paths are the readable part of a failed IR validation; the raw message stays for debugging. */
export function describeIrIssues(error: ZodError): string[] {
  const lines = error.issues.map((issue) => {
    const path = issue.path.map(String).join('.')
    return `${path.length > 0 ? path : '(root)'} — ${issue.message}`
  })
  return [...new Set(lines)]
}
