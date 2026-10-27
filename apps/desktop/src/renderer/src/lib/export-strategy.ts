import type { StrategyIr, StrategyStep } from '@tds/shared'
import { actionKey } from './actions'
import type { Translate } from '../i18n/use-t'
import { humanTowerLabel } from './text'

/**
 * Exporting a strategy (0.3.8). The IR is the only faithful copy of what the author wrote — the typed
 * tables cannot carry a step's duration, repetition or branch — so the document is rendered from the IR
 * and the raw line of every step is kept underneath, which is what a person pasting into Discord or
 * printing for a guild actually wants.
 */

const towerLabel = (key: string | undefined): string => (key ? humanTowerLabel(key) ?? key : '')

function waveOf(step: StrategyStep): string {
  if (step.waveFrom === undefined) return ''
  return step.waveTo === undefined || step.waveTo === step.waveFrom ? `W${String(step.waveFrom)}` : `W${String(step.waveFrom)}-${String(step.waveTo)}`
}

function stepLine(step: StrategyStep, t: Translate): string {
  const parts = [
    waveOf(step),
    t(actionKey(step.action)),
    towerLabel(step.towerKey),
    step.level !== undefined ? `Sv.${String(step.level)}` : '',
    step.count !== undefined ? `×${String(step.count)}` : '',
    step.seconds !== undefined ? t('overlay.seconds', { count: step.seconds }) : '',
    step.repeat !== undefined ? t('overlay.times', { count: step.repeat }) : '',
    step.spec ?? ''
  ].filter((part) => part.length > 0)

  const branch = step.condition ? ` — ${t('overlay.condition', { condition: step.condition })}` : ''
  return `${String(step.stepNo)}. ${parts.join(' · ')}${branch}\n    ${step.raw}`
}

export function irToMarkdown(ir: StrategyIr, t: Translate): string {
  const meta = ir.meta
  const lines: string[] = [`# ${meta.name}`]
  if (meta.subtitle) lines.push(`_${meta.subtitle}_`)
  lines.push('')

  const facts = [
    `${t('discover.difficulty')}: ${meta.difficulty}`,
    `${t('discover.mode')}: ${meta.gameMode.key}`,
    `${t('detail.players')}: ${meta.playerCount}`,
    meta.map.key ?? meta.map.raw ? `${t('detail.map')}: ${meta.map.key ?? meta.map.raw}` : '',
    meta.waveRange ? `${t('detail.waves')}: ${String(meta.waveRange[0])}-${String(meta.waveRange[1])}` : '',
    meta.durationMinutes ? `${t('detail.duration')}: ${String(Math.round(meta.durationMinutes))}` : '',
    `${t('detail.steps')}: ${String(ir.steps.length)}`,
    meta.event.isEvent ? t('overlay.eventRibbon') : ''
  ].filter((line) => line.length > 0)
  lines.push(...facts.map((fact) => `- ${fact}`))

  if (meta.credit.creator || meta.credit.sourceUrl) {
    const credit = [meta.credit.creator, meta.credit.contributors.join(', ')]
      .filter((part) => part.length > 0)
      .join(' · ')
    lines.push(`- ${t('detail.author')}: ${credit}${meta.credit.sourceUrl ? ` — ${meta.credit.sourceUrl}` : ''}`)
  }

  if (ir.mutators.length > 0) {
    lines.push('', `## ${t('detail.modifiers')}`)
    lines.push(...ir.mutators.map((mutator) => `- ${mutator.note ?? mutator.raw}`))
  }

  if (ir.inventory.length > 0) {
    lines.push('', `## ${t('detail.inventory')}`)
    lines.push(
      ...ir.inventory.map(
        (slot, index) =>
          `- ${String(index + 1)}. ${towerLabel(slot.towerKey)}${slot.count !== undefined ? ` ×${String(slot.count)}` : ''}${
            slot.alternatives.length > 0 ? ` (${slot.alternatives.map(towerLabel).join(', ')})` : ''
          }${slot.notes ? ` — ${slot.notes}` : ''}`
      )
    )
  }

  if (ir.requirements.length > 0) {
    lines.push('', `## ${t('detail.requirements')}`)
    lines.push(...ir.requirements.map((row) => `- ${row.kind}: ${row.value}${row.detail ? ` — ${row.detail}` : ''}`))
  }

  lines.push('', `## ${t('import.stepsTitle')}`)
  lines.push(...ir.steps.map((step) => stepLine(step, t)))

  if (ir.troubleshooting.length > 0) {
    lines.push('', `## ${t('detail.troubleshooting')}`)
    for (const entry of ir.troubleshooting) lines.push(`- ${entry.waves}: ${entry.reasons.join(', ')}`)
  }

  if (ir.proofs.length > 0) {
    lines.push('', `## ${t('detail.proofs')}`)
    for (const proof of ir.proofs) {
      lines.push(`- ${proof.label || t('common.none')}${proof.bestTime ? ` · ${t('overlay.bestTime', { value: proof.bestTime })}` : ''}`)
    }
  }

  return `${lines.join('\n').trim()}\n`
}

export function irToJson(ir: StrategyIr): string {
  return `${JSON.stringify(ir, null, 2)}\n`
}

/** A file name is a slug, never a path: main re-sanitises it, and this keeps the suggestion readable. */
export function exportFileName(name: string, extension: 'md' | 'json'): string {
  const slug = name
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug.length > 0 ? slug : 'strateji'}.${extension}`
}

/** The link this app opens itself with; only a published row has an id to share. */
export function strategyDeepLink(strategyId: string): string {
  return `tdsapp://strategy/${strategyId}`
}
