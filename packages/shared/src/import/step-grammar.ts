import type { StepAction, StrategyStep } from '../ir/strategy-ir'
import { TowerDictionary, matchTowerLabel } from './tower-dict'

export interface WaveRange {
  waveFrom?: number
  waveTo?: number
}

const VERB_PATTERNS: { action: StepAction; test: RegExp }[] = [
  { action: 'max', test: /\b(max|max out|maximize|full max)\b/i },
  { action: 'upgrade', test: /\b(upgrade|upg|lvl up|level up|yükselt)\b/i },
  { action: 'sell', test: /\b(sell|sat|kaldır)\b/i },
  { action: 'change', test: /\b(change|swap|convert|değiştir)\b/i },
  { action: 'skip', test: /\b(auto ?skip|skip|atl(a|ı))\b/i },
  { action: 'use', test: /\b(use|activate|chain|trigger|kullan)\b/i },
  { action: 'place', test: /\b(place|put|build|deploy|spawn|yerleştir|bas)\b/i },
  { action: 'wait', test: /\b(wait|hold|bekle)\b/i }
]

const VERB_KEYWORDS = ['place', 'put', 'build', 'deploy', 'spawn', 'upgrade', 'max', 'sell', 'change', 'swap', 'use', 'activate', 'chain', 'auto skip', 'skip', 'wait', 'hold'] as const

const LEVEL_RE = /\b(?:lv|lvl|level|seviye)\s*\.?\s*(\d{1,2})\b/i
const MAX_WORD_RE = /\b(max|maximum|full)\b/i
const BRACKET_RE = /\[([^\]]{1,120})\]/g
const STANDALONE_COUNT_RE = /\b(\d{1,3})\b(?!\s*(?:%|k\b|m\b|hp|coins?|xp|sec|min|th|st|nd|rd)\b)/gi
const WAVE_IN_TEXT_RE = /\bwaves?\s*:?\s*(\d{1,3})\s*(?:[-–—to+]+\s*(\d{1,3}))?/i
const ALTERNATIVE_SPLIT_RE = /\s+\bor\b\s+|\s+\+\s+/i

export function detectWaveRange(label: string): WaveRange {
  const match = /\bwaves?\s*:?\s*(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?/i.exec(label)
  if (!match) return {}
  const from = Number.parseInt(match[1] ?? '', 10)
  const to = match[2] ? Number.parseInt(match[2], 10) : undefined
  if (Number.isNaN(from)) return {}
  return { waveFrom: from, waveTo: Number.isNaN(to as number) ? from : to }
}

export function splitChains(line: string): string[] {
  const parts = line.split(/\s*>\s*|\s*→\s*|\s*=>\s*/).map((part) => part.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [line.trim()].filter(Boolean)
}

/**
 * Google Docs markdown flattens bullet lists inside a table cell onto one line.
 * DOCX keeps paragraph boundaries; when only markdown is available we recover
 * boundaries where a known verb keyword starts a new instruction.
 */
export function splitBulletHeuristic(text: string): string[] {
  const bullets = text
    .split(/\s*(?:[•*▪◦]\s+)/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (bullets.length > 1) return bullets

  const verbPattern = new RegExp(`(?:^|(?<=\\s))(?:${VERB_KEYWORDS.map(escapeRegExp).join('|')})`, 'gi')
  const starts: number[] = []
  let match: RegExpExecArray | null
  let guard = 0

  while ((match = verbPattern.exec(text)) !== null) {
    if (match[0].length === 0) {
      // V8 does not advance lastIndex for zero-width matches; without this the loop never ends.
      verbPattern.lastIndex = match.index + 1
    }
    if (match.index > 0) starts.push(match.index)
    if (++guard > 512) break
  }

  if (starts.length === 0) return [text.trim()].filter(Boolean)

  const chunks: string[] = []
  let cursor = 0
  for (const start of starts) {
    const chunk = text.slice(cursor, start).trim()
    if (chunk) chunks.push(chunk)
    cursor = start
  }
  const tail = text.slice(cursor).trim()
  if (tail) chunks.push(tail)

  return chunks.length > 0 ? chunks : [text.trim()].filter(Boolean)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function detectVerb(clause: string): { action: StepAction | undefined; matched: RegExpExecArray | null } {
  for (const pattern of VERB_PATTERNS) {
    const matched = pattern.test.exec(clause)
    if (matched) return { action: pattern.action, matched }
  }
  return { action: undefined, matched: null }
}

function extractSpecs(clause: string): { specs: string[]; rest: string } {
  const specs: string[] = []
  const rest = clause.replace(BRACKET_RE, (_match, inner: string) => {
    const value = inner.trim()
    if (value) specs.push(value)
    return ' '
  })
  return { specs, rest: rest.replace(/\s+/g, ' ').trim() }
}

function extractLevel(text: string): { level?: number; rest: string } {
  const match = LEVEL_RE.exec(text)
  if (match?.[1]) {
    const level = Number.parseInt(match[1], 10)
    return { level: Number.isNaN(level) ? undefined : level, rest: text.replace(match[0], ' ').replace(/\s+/g, ' ').trim() }
  }
  return { rest: text }
}

function extractCount(text: string, level?: number): { count?: number; rest: string } {
  const leading = /^\s*(\d{1,3})\b\s*/.exec(text)
  if (leading?.[1]) {
    const value = Number.parseInt(leading[1], 10)
    if (!Number.isNaN(value) && value !== level) {
      return { count: value, rest: text.slice(leading[0].length).trim() }
    }
  }

  const candidates: number[] = []
  for (const match of text.matchAll(STANDALONE_COUNT_RE)) {
    const value = Number.parseInt(match[0], 10)
    if (!Number.isNaN(value) && value !== level && value > 0) candidates.push(value)
  }
  if (candidates.length === 0) return { rest: text }
  const rest = text.replace(STANDALONE_COUNT_RE, ' ').replace(/\s+/g, ' ').trim()
  return { count: candidates[0], rest }
}

export interface StepContext extends WaveRange {
  startStepNo: number
  phase?: string
}

export interface ParsedClause {
  step: StrategyStep
  unresolvedTower: boolean
  inheritedVerb: boolean
}

export function parseClause(
  clause: string,
  context: StepContext,
  dictionary: TowerDictionary,
  carry: { action?: StepAction }
): ParsedClause {
  const raw = clause.trim()
  const { specs, rest: withoutSpecs } = extractSpecs(raw)
  const { level, rest: withoutLevel } = extractLevel(withoutSpecs)
  const verbInfo = detectVerb(withoutLevel)
  const action: StepAction = verbInfo.action ?? carry.action ?? 'raw'
  const inheritedVerb = !verbInfo.action && Boolean(carry.action)
  if (verbInfo.action) carry.action = verbInfo.action

  const afterVerb = withoutLevel.replace(verbInfo.matched?.[0] ?? '', ' ').replace(/\s+/g, ' ').trim()
  const { count, rest: withoutCount } = extractCount(afterVerb, level)

  const cleaned = withoutCount
    .replace(/\ball\b/gi, ' ')
    .replace(/\bto\b\s*$/i, ' ')
    .replace(/\bin\b\s+waves?\s*\d+\s*(-\s*\d+)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const candidateLabels = cleaned
    .split(ALTERNATIVE_SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean)

  const matches = candidateLabels.map((label) => matchTowerLabel(label, dictionary))
  const resolved = matches.filter((match) => match.resolved)
  const primary = resolved[0]
  const unresolvedTower = cleaned.length > 0 && resolved.length === 0

  if (action === 'skip') {
    const waveMatch = WAVE_IN_TEXT_RE.exec(raw)
    return {
      unresolvedTower: false,
      inheritedVerb,
      step: {
        stepNo: context.startStepNo,
        waveFrom: waveMatch?.[1] ? Number.parseInt(waveMatch[1], 10) : context.waveFrom,
        waveTo: waveMatch?.[2] ? Number.parseInt(waveMatch[2], 10) : context.waveTo,
        phase: context.phase,
        action: 'skip',
        note: specs[0],
        raw,
        alternatives: [],
        unresolved: false
      }
    }
  }

  if (!primary) {
    return {
      unresolvedTower,
      inheritedVerb,
      step: {
        stepNo: context.startStepNo,
        waveFrom: context.waveFrom,
        waveTo: context.waveTo,
        phase: context.phase,
        action: unresolvedTower || cleaned.length === 0 ? 'note' : 'raw',
        level,
        count,
        spec: specs.join(', ') || undefined,
        note: cleaned || undefined,
        raw,
        alternatives: [],
        unresolved: unresolvedTower
      }
    }
  }

  return {
    unresolvedTower: false,
    inheritedVerb,
    step: {
      stepNo: context.startStepNo,
      waveFrom: context.waveFrom,
      waveTo: context.waveTo,
      phase: context.phase,
      action: action === 'raw' ? 'place' : action,
      towerKey: primary.key,
      level: level ?? (MAX_WORD_RE.test(raw) && action === 'max' ? undefined : level),
      count,
      spec: specs.join(', ') || undefined,
      note: resolved.length > 1 ? `alternatives: ${resolved.map((match) => match.key).join(', ')}` : undefined,
      alternatives: resolved.slice(1).map((match) => match.key ?? ''),
      raw,
      unresolved: false
    }
  }
}

export function parseStepLines(
  lines: string[],
  context: StepContext,
  dictionary: TowerDictionary
): { steps: StrategyStep[]; unresolvedCount: number } {
  const carry: { action?: StepAction } = {}
  const steps: StrategyStep[] = []
  let stepNo = context.startStepNo
  let unresolvedCount = 0

  for (const line of lines) {
    for (const clause of splitChains(line)) {
      const parsed = parseClause(clause, { ...context, startStepNo: stepNo }, dictionary, carry)
      steps.push({ ...parsed.step, stepNo })
      if (parsed.unresolvedTower || parsed.step.unresolved) unresolvedCount += 1
      stepNo += 1
    }
    carry.action = undefined
  }

  return { steps, unresolvedCount }
}
