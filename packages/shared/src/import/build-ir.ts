import type {
  MediaRef,
  MutatorEntry,
  PlayerCount,
  ProofEntry,
  RequirementEntry,
  StrategyIr,
  StrategyStep,
  WaveSkipRule
} from '../ir/strategy-ir'
import { strategyIrSchema } from '../ir/strategy-ir'
import { classifyRow, parseDocument, type DocumentSection, type MdBlock, type TableBlock } from './document'
import { splitImageDefinitions } from './markdown'
import { emptyStats, ValidationReporter, type ImportStats, type ValidationReport } from './report'
import { detectWaveRange, parseStepLines, splitBulletHeuristic } from './step-grammar'
import {
  BUNDLED_TOWERS,
  defaultTowerDictionary,
  findTowers,
  matchTowerLabel,
  TowerDictionary,
  type TowerAliasEntry
} from './tower-dict'

export type ImportSourceKind = 'gdocs-md' | 'gdocs-docx' | 'docx-upload' | 'paste' | 'manual'

export interface BuildIrInput {
  markdown: string
  source?: ImportSourceKind
  sourceUrl?: string
  docId?: string
  rawSha256?: string
  extraTowers?: TowerAliasEntry[]
  mapKeys?: string[]
  lineBoundaries?: Map<string, string[]>
}

export interface StrategyDraft {
  ir: StrategyIr
  media: MediaRef[]
}

export interface BuildIrResult {
  draft: StrategyDraft | null
  ir: StrategyIr | null
  report: ValidationReport
}

const GAME_MODE_KEYWORDS = ['classic', 'rush', 'underground', 'arena', 'mock', 'hardcore', 'aeonism', 'battle simulator']
const EVENT_KEYWORDS = ['event', 'halloween', 'winter event', 'christmas', 'limited time', 'gift box']
const PLAYER_COUNT_KEYWORDS: [PlayerCount, RegExp][] = [
  ['solo', /\bsolo\b|\btek\b/i],
  ['duo', /\bduo\b|\bibki\b/i],
  ['trio', /\btrio\b/i],
  ['quad', /\bquad\b/i]
]

const DIFFICULTY_RE = /\b(easy|medium|hard|nightmare)\b/i

const REQUIREMENT_TESTS: { kind: RequirementEntry['kind']; test: RegExp }[] = [
  { kind: 'skill-tree', test: /skill\s*tree/i },
  { kind: 'timescale', test: /time\s*scale/i },
  { kind: 'group', test: /\bgroup\b/i },
  { kind: 'consumable', test: /consumable/i },
  { kind: 'tower-xp', test: /\bxp\b|\bmax\s*xp\b|\blevel\s*\d+\s*xp\b/i }
]

function flattenTables(sections: DocumentSection[]): TableBlock[] {
  const tables: TableBlock[] = []
  for (const section of sections) {
    for (const block of section.blocks) if (block.type === 'table') tables.push(block)
  }
  return tables
}

function collectLines(blocks: MdBlock[]): string[] {
  const lines: string[] = []
  for (const block of blocks) {
    if (block.type === 'list') lines.push(...block.items.map((item) => item.text))
    if (block.type === 'paragraph') lines.push(...block.text.split('\n').map((line) => line.trim()).filter(Boolean))
  }
  return lines.filter(Boolean)
}

function inferDifficulty(text: string, reporter: ValidationReporter): StrategyIr['meta']['difficulty'] {
  const match = DIFFICULTY_RE.exec(text)
  if (match?.[1]) return match[1].toLowerCase() as StrategyIr['meta']['difficulty']
  reporter.warn('difficultyInferred', 'Belgede zorluk bulunamadı, "medium" varsayıldı — inceleme ekranında teyit et.')
  return 'medium'
}

function inferGameMode(haystack: string, reporter: ValidationReporter): StrategyIr['meta']['gameMode'] {
  const found = GAME_MODE_KEYWORDS.find((keyword) => haystack.includes(keyword))
  if (found) return { key: found, raw: found, resolved: true }
  reporter.warn('gameModeMissing', 'Oyun modu belgeden çıkarılamadı — inceleme ekranında seç.')
  return { key: 'unknown', raw: '', resolved: false }
}

function inferPlayerCount(haystack: string): PlayerCount {
  for (const [value, test] of PLAYER_COUNT_KEYWORDS) if (test.test(haystack)) return value
  return 'unknown'
}

function detectEvent(haystack: string, reporter: ValidationReporter): StrategyIr['meta']['event'] {
  const evidence = EVENT_KEYWORDS.find((keyword) => haystack.includes(keyword))
  if (evidence) reporter.info('eventCandidate', `Etkinlik ipucu bulundu ("${evidence}") — etkinlik stratejisi mi, teyit et.`)
  reporter.info('eventConfirmationNeeded', 'Bu strateji bir etkinliğe mi ait? Inceleme ekranında onayla.')
  return { isEvent: false, evidence, eventKey: undefined }
}

function parseRequirements(notes: string[], dictionary: TowerDictionary, reporter: ValidationReporter): RequirementEntry[] {
  const out: RequirementEntry[] = []

  for (const note of notes) {
    for (const test of REQUIREMENT_TESTS) {
      if (!test.test.test(note)) continue

      if (test.kind === 'tower-xp') {
        const levelMatch = /\b(?:max|level|lvl)\s*(\d+|max)\b/i.exec(note)
        const towerKeys = findTowers(note, dictionary)
        out.push({
          kind: 'tower-xp',
          value: towerKeys[0] ?? 'unknown',
          detail: `${levelMatch?.[1]?.toLowerCase() ?? 'xp'} — ${note}`
        })
        if (!towerKeys[0]) reporter.warn('towerXpRequirementUnresolved', 'Kule XP gereksiniminde kule adı çözülemedi.', { sample: note })
        break
      }

      if (test.kind === 'skill-tree') {
        const negative = /(doesn'?t|does not|don'?t|no|not required|gerekmez|gerekli değil)/i.test(note)
        out.push({ kind: 'skill-tree', value: negative ? 'not-needed' : 'needed', detail: note })
        break
      }

      if (test.kind === 'group') {
        const nameMatch = /\b(?:in|for)\s+(?:the\s+)?([A-Z][\w-]+(?:\s+[A-Z][\w-]+)?)\s*(?:group)?/i.exec(note)
        const urlMatch = /https?:\/\/\S+/i.exec(note)
        out.push({ kind: 'group', value: nameMatch?.[1] ?? 'group', detail: urlMatch ? `${note} ${urlMatch[0]}` : note })
        break
      }

      // The detail page prints `value` and `detail` side by side, so `value` has to stay a compact
      // token: putting the sentence there shows it twice.
      const negative = /(doesn'?t|does not|don'?t|\bno\b|not\s+(needed|required|recommended)|gerekli değil|gerekmez)/i.test(note)

      if (test.kind === 'consumable') {
        out.push({ kind: 'consumable', value: negative ? 'not-needed' : 'needed', detail: note })
        break
      }

      if (test.kind === 'timescale') {
        out.push({ kind: 'timescale', value: negative ? 'not-recommended' : 'recommended', detail: note })
        break
      }

      out.push({ kind: test.kind, value: note.slice(0, 160), detail: note })
      break
    }
  }

  const singles = new Map<string, RequirementEntry>()
  for (const entry of out.filter((item) => item.kind !== 'tower-xp')) {
    const existing = singles.get(entry.kind)
    if (!existing) {
      singles.set(entry.kind, entry)
      continue
    }
    // A "skill tree not needed" note must win over a passing mention in another bullet.
    if (entry.kind === 'skill-tree' && existing.value === 'needed' && entry.value === 'not-needed') singles.set(entry.kind, entry)
  }

  return [...singles.values(), ...out.filter((item) => item.kind === 'tower-xp')]
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|[\n•]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function parseWaveSkipRules(text: string, reporter: ValidationReporter): WaveSkipRule[] {
  const rules: WaveSkipRule[] = []
  const capped = text.slice(0, 4000)

  for (const sentence of splitSentences(capped)) {
    const skipUntil = /\bauto ?skip until (?:wave )?(\d{1,3})\b/i.exec(sentence)
    if (skipUntil?.[1]) {
      rules.push({ kind: 'skip-until', waves: skipUntil[1], raw: sentence })
      continue
    }

    const neverMatch = /\b(?:do not|don't|never)\b[^.]{0,40}\bskip\b/i.exec(sentence)
    if (neverMatch) {
      const digits = (sentence.slice(neverMatch.index).match(/\d{1,3}/g) ?? []).join(', ')
      rules.push({ kind: 'never', waves: digits, raw: sentence })
      continue
    }

    const conditionStart = /\b(?:only if|if)\b/i.exec(sentence)
    if (/\bskip\b/i.test(sentence) && conditionStart) {
      const digits = (sentence.slice(0, conditionStart.index).match(/\d{1,3}/g) ?? []).join(', ')
      const condition = sentence.slice(conditionStart.index).replace(/^\s*(?:only if|if)\b\s*/i, '').trim()
      rules.push({ kind: 'conditional', waves: digits, condition, raw: sentence })
      continue
    }

    if (/\bskip\b/i.test(sentence)) rules.push({ kind: 'conditional', raw: sentence })
  }

  if (rules.length === 0 && /\bskip\b/i.test(capped)) {
    rules.push({ kind: 'conditional', raw: capped })
    reporter.warn('waveSkipUnparsed', 'Atlama tavsiyesi yapılandırılamadı, ham metin not olarak taşındı.', { sample: capped })
  }

  return rules
}

function parseProofText(lines: string[], mediaIds: string[]): ProofEntry[] {
  const proofs: ProofEntry[] = []
  let current: ProofEntry | null = null

  for (const line of lines) {
    if (/best time|coins? per hour|xp per hour|\d{1,2}:\d{2}/i.test(line) && current) {
      const time = /\b(\d{1,2}:\d{2})\b/.exec(line)?.[1]
      if (time) current.bestTime = time
      const coins = /([\d.]+K?)\s*coins?\s*per\s*hour/i.exec(line)?.[1]
      if (coins) current.coinsPerHour = `${coins}/h`
      const xp = /([\d.]+K?)\s*xp\s*per\s*hour/i.exec(line)?.[1]
      if (xp) current.xpPerHour = `${xp}/h`
      continue
    }
    if (/\b(no skill tree|skill tree|timescale)\b/i.test(line) || /\bmodifiers?\b/i.test(line)) {
      if (current) proofs.push(current)
      current = { label: line, setup: [line], bestTime: undefined, mediaRefs: [], coinsPerHour: undefined, xpPerHour: undefined }
      continue
    }
    if (!line.trim()) continue
    if (current) current.setup.push(line)
  }

  if (current) proofs.push(current)
  for (const proof of proofs) proof.mediaRefs = mediaIds
  return proofs
}

export function buildStrategyIr(input: BuildIrInput): BuildIrResult {
  const reporter = new ValidationReporter()
  const stats: ImportStats = emptyStats()
  // The database catalog wins on alias collisions; the bundled subset fills keys the operator has
  // not seeded yet, so an empty or partial catalog never regresses the starter resolution.
  const dictionary = input.extraTowers?.length
    ? new TowerDictionary([...input.extraTowers, ...BUNDLED_TOWERS])
    : defaultTowerDictionary

  const source = splitImageDefinitions(input.markdown)
  const document = parseDocument(source.body)

  stats.blocks = document.blockCount
  stats.sections = document.sections.length
  stats.images = source.imageDefs.size
  stats.imageBytes = [...source.imageDefs.values()].reduce((total, definition) => total + definition.byteLength, 0)

  const media: MediaRef[] = [...source.imageDefs.values()].map((definition) => ({
    id: definition.id,
    kind: 'unknown' as MediaRef['kind'],
    byteLength: definition.byteLength
  }))

  const notesSection = document.sections.find((section) => section.key === 'notes')
  const creditSection = document.sections.find((section) => section.key === 'credits')
  const strategySection = document.sections.find((section) => section.key === 'strategy')
  const modifierSections = document.sections.filter((section) => section.key === 'modifiers')
  const troubleshootingSection = document.sections.find((section) => section.key === 'troubleshooting')
  const proofsSection = document.sections.find((section) => section.key === 'proofs')
  const hallOfFameSection = document.sections.find((section) => section.key === 'hallOfFame')

  const notes = notesSection ? collectLines(notesSection.blocks) : []
  const creditLines = creditSection ? collectLines(creditSection.blocks) : []

  const creator = /creator:?\s*(.+)/i.exec(creditLines.join('\n'))?.[1]?.trim() ?? ''
  const contributors = [...creditLines.join('\n').matchAll(/contributor:?\s*([^\n]+)/gi)].map((match) => (match[1] ?? '').trim())

  if (!creator) reporter.warn('creditMissing', 'Belgede creator bilgisi bulunamadı — künye zorunlu.')

  const haystack = [document.title, document.subtitle, ...notes, ...collectLines(strategySection?.blocks ?? [])]
    .join(' ')
    .toLowerCase()

  const tables = flattenTables(document.sections)
  const difficultyText = tables
    .flatMap((table) => table.rows.map((row) => row.cells.join(' ')))
    .find((text) => /difficulty|zorluk/i.test(text))

  const difficulty = inferDifficulty(difficultyText ?? '', reporter)
  const povUrl = tables
    .flatMap((table) => table.rows)
    .find((row) => /difficulty|zorluk/i.test(row.cells.join(' ')))
    ?.links.find((link) => /youtu\.?be/i.test(link.url))?.url

  const inventory: StrategyIr['inventory'] = []
  const stepRows: { waveFrom?: number; waveTo?: number; text: string }[] = []
  const placementImageIds: string[] = []
  const waveSkipText: string[] = []
  const modifierMediaIds: string[] = []
  const mutatorNotes: string[] = []

  for (const table of tables) {
    // Modifier tables keep icons and notes in label-less rows; treat the whole table as modifiers.
    if (table.rows.some((row) => classifyRow(row.cells[0] ?? '') === 'modifiers')) {
      for (const row of table.rows) {
        modifierMediaIds.push(...row.imageIds)
        mutatorNotes.push(...row.cells.filter((cell) => cell && !/^modifiers?\b/i.test(cell)))
      }
      continue
    }

    for (const row of table.rows) {
      const label = row.cells[0] ?? ''
      const key = classifyRow(label)

      if (key === 'header') continue

      if (key === 'placementMap') {
        placementImageIds.push(...row.imageIds)
        for (const cell of row.cells.slice(1)) if (cell) waveSkipText.push(cell)
        continue
      }

      if (key === 'waveSkip') {
        waveSkipText.push(...row.cells.slice(1).filter(Boolean))
        continue
      }

      if (key === 'steps') {
        const wave = detectWaveRange(label)
        const cell = row.cells.slice(1).find(Boolean) ?? ''
        if (cell) stepRows.push({ ...wave, text: cell })
        else reporter.warn('emptyWaveBlock', 'Dalga bloku boş.', { sample: label })
        continue
      }

      if (key === 'modifiers') {
        modifierMediaIds.push(...row.imageIds)
        continue
      }

      const nonEmptyCells = row.cells.filter(Boolean)
      const looksLikeIconRow = row.cells.every((cell, index) => !cell || index === 0) && row.imageIds.length > 0
      if (looksLikeIconRow) continue

      const towerCandidates = nonEmptyCells.filter((cell) => /[A-Za-z]/.test(cell) && cell.length <= 40)
      if (towerCandidates.length >= 2 && inventory.length === 0) {
        const matched = towerCandidates.map((cell) => ({ cell, match: matchTowerLabel(cell, dictionary) }))
        const resolvedCount = matched.filter((entry) => entry.match.resolved).length
        if (resolvedCount < 2) continue

        for (const { cell, match } of matched) {
          inventory.push({
            towerKey: match.key ?? cell.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, ''),
            rawLabel: cell,
            alternatives: match.alternatives,
            unresolved: !match.resolved
          })
          if (!match.resolved) reporter.warn('towerUnresolved', 'Kule adı katalogda bulunamadı, elle seç.', { sample: cell })
        }
      }
    }
  }

  for (const section of modifierSections) {
    for (const block of section.blocks) {
      if (block.type !== 'table') continue
      for (const row of block.rows) {
        modifierMediaIds.push(...row.imageIds)
        mutatorNotes.push(...row.cells.filter(Boolean))
      }
    }
    mutatorNotes.push(...collectLines(section.blocks))
  }

  // Icon-only modifier rows leave the cell's markdown emphasis markers behind ("****"), which is
  // noise rather than a label: the catalog match is what identifies a modifier.
  const cleanModifierNote = (value: string | undefined): string | undefined => {
    const trimmed = (value ?? '').replace(/^[*\s_]+|[*\s_]+$/g, '')
    return trimmed.length > 0 ? trimmed : undefined
  }

  const mutators: MutatorEntry[] = modifierMediaIds.map((id, index) => ({
    key: undefined,
    matchedBy: 'none',
    raw: '',
    mediaRef: id,
    note: cleanModifierNote(mutatorNotes[index])
  }))

  if (modifierMediaIds.length === 0 && mutatorNotes.length > 0) {
    for (const note of mutatorNotes) {
      const cleaned = cleanModifierNote(note)
      if (cleaned) mutators.push({ matchedBy: 'text', raw: cleaned, note: cleaned })
    }
  }

  if (mutators.length === 0) reporter.info('noModifiers', 'Belgede modifier bulunamadı (yazılı stratejilerde normal).')
  else reporter.info('modifiersUnmatched', `${mutators.length} modifier ikonu katalog eşlemesi bekliyor (pHash/elle).`)

  const minModifier = /at least (\d{1,2}) modif/i.exec(document.sections.map((section) => section.heading).join(' '))
  const mutatorRule = minModifier?.[1] ? { minCount: Number.parseInt(minModifier[1], 10) } : undefined

  if (inventory.length === 0) reporter.error('inventoryEmpty', 'Kule envanteri çıkarılamadı — inceleme ekranında en az 1 kule seç.')
  if (inventory.length > 5) reporter.error('inventoryTooLarge', `Envanterde ${inventory.length} kule var, en fazla 5 olabilir.`)

  const steps: StrategyStep[] = []
  let stepNo = 1
  for (const row of stepRows) {
    const lines = input.lineBoundaries?.get(row.text) ?? splitBulletHeuristic(row.text)
    const parsed = parseStepLines(lines, { startStepNo: stepNo, waveFrom: row.waveFrom, waveTo: row.waveTo }, dictionary)
    steps.push(...parsed.steps)
    stepNo += parsed.steps.length
    stats.unresolvedClauses += parsed.unresolvedCount
  }

  if (steps.length === 0) reporter.error('noSteps', 'Hiçbir adım çıkarılamadı — belge yapısı tanınmadı, elle gir veya yapıyı bildir.')
  if (stats.unresolvedClauses > 0) {
    reporter.warn('unresolvedClauses', `${stats.unresolvedClauses} adet talimat tam çözümlenemedi, ham metin overlay'de gösterilecek.`)
  }

  const waveNumbers = steps.flatMap((step) => [step.waveFrom, step.waveTo]).filter((value): value is number => typeof value === 'number')
  const waveRange = waveNumbers.length > 0 ? ([Math.min(...waveNumbers), Math.max(...waveNumbers)] as [number, number]) : undefined

  const troubleshooting = troubleshootingSection
    ? flattenTables([troubleshootingSection])
        .flatMap((table) => table.rows)
        .map((row) => ({
          waves: row.cells[0] ?? '',
          reasons: (row.cells[1] ?? '').split(/(?<=[.!?])\s+|\n/).map((part) => part.trim()).filter(Boolean)
        }))
        .filter((entry) => entry.waves && entry.reasons.length > 0)
    : []

  // Hall of Fame is usually a bold paragraph inside the Proofs section, not a real heading.
  const proofAndHallLines = [
    ...(proofsSection ? collectLines(proofsSection.blocks) : []),
    ...(hallOfFameSection ? collectLines(hallOfFameSection.blocks) : [])
  ]
  const hallStart = proofAndHallLines.findIndex((line) => /hall of fame|şöhretler|sohretler/i.test(line))
  const proofLines = hallStart === -1 ? proofAndHallLines : proofAndHallLines.slice(0, hallStart)
  const hallLines = hallStart === -1 ? [] : proofAndHallLines.slice(hallStart + 1)

  const proofs = parseProofText(proofLines, [])
  const hallOfFame = hallLines
    .map((line) => {
      const bestTime = /\b(\d{1,2}:\d{2})\b/.exec(line)?.[1]
      const comp = findTowers(line.replace(/\bBest Time\b.*$/i, ''), dictionary)
      return { comp, bestTime, notes: undefined, mediaRefs: [] }
    })
    .filter((entry) => entry.comp.length > 0)

  const placement = {
    imageRef: placementImageIds[0],
    items: [] as StrategyIr['placement']['items']
  }
  // Longest match first: with a full map catalog, "Winter" must not steal "Winter Abyss" and
  // "Castle" must not steal "Retro Castle Outskirts".
  const draftMapKey = (input.mapKeys ?? [])
    .map((key) => ({ key, needle: key.replace(/[-_]+/g, ' ').trim().toLowerCase() }))
    .filter((entry) => entry.needle.length > 3 && haystack.includes(entry.needle))
    .sort((a, b) => b.needle.length - a.needle.length)[0]?.key
  if (!placementImageIds[0]) reporter.warn('placementMapMissing', 'Yerleşim haritası görseli bulunamadı.')
  if (!draftMapKey) reporter.warn('mapKeyMissing', 'Harita adı metinde geçmiyor — görselden katalog eşlemesi yapılacak, teyit et.')

  for (const id of [...placementImageIds, ...modifierMediaIds]) {
    const ref = media.find((entry) => entry.id === id)
    if (!ref) continue
    ref.kind = placementImageIds.includes(id) ? 'map' : 'modifier'
  }

  for (const section of document.sections) {
    if (section.key === 'unknown') {
      reporter.warn('unmappedSection', 'Tanınmayan bölüm atlandı, inceleme raporunda listeleniyor.', {
        path: section.heading || 'unlabeled',
        sample: collectLines(section.blocks)[0]
      })
    }
  }

  const draftIr: StrategyIr = {
    formatVersion: 'tds.strategy.ir/v1',
    format: {
      source: input.source ?? 'gdocs-md',
      sourceUrl: input.sourceUrl,
      docId: input.docId,
      rawSha256: input.rawSha256,
      unmapped: document.sections
        .filter((section) => section.key === 'unknown')
        .map((section) => ({ path: section.heading || 'unlabeled', sample: collectLines(section.blocks)[0] ?? '' }))
    },
    meta: {
      name: document.title ?? 'Untitled strategy',
      subtitle: document.subtitle,
      description: document.subtitle,
      difficulty,
      gameMode: inferGameMode(haystack, reporter),
      playerCount: inferPlayerCount(haystack),
      map: { key: draftMapKey, imageRef: placement.imageRef },
      event: detectEvent(haystack, reporter),
      waveRange,
      credit: { creator, contributors, sourceUrl: input.sourceUrl, isAuthorOwn: false },
      povVideoUrl: povUrl,
      tags: []
    },
    requirements: parseRequirements(notes, dictionary, reporter),
    inventory: inventory.slice(0, 5),
    mutators,
    mutatorRule,
    placement,
    waveSkip: parseWaveSkipRules(waveSkipText.join(' '), reporter),
    steps,
    troubleshooting,
    proofs,
    hallOfFame,
    notes,
    media
  }

  if (inventory.length > 5) draftIr.inventory = inventory.slice(0, 5)

  stats.steps = steps.length
  stats.inventory = draftIr.inventory.length
  stats.mediaSaved = media.filter((entry) => entry.kind !== 'unknown').length

  const parsed = strategyIrSchema.safeParse(draftIr)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      reporter.error('irValidationFailed', `${issue.path.join('.')}: ${issue.message}`)
    }
    return {
      draft: { ir: draftIr, media },
      ir: null,
      report: { issues: reporter.issues, errors: reporter.errors, warnings: reporter.warnings, stats, ok: false }
    }
  }

  return {
    draft: { ir: parsed.data, media },
    ir: parsed.data,
    report: {
      issues: reporter.issues,
      errors: reporter.errors,
      warnings: reporter.warnings,
      stats,
      ok: reporter.errors.length === 0
    }
  }
}
