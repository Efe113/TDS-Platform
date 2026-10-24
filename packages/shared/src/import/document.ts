import { inlineToText } from './markdown'

export type SectionKey =
  | 'credits'
  | 'notes'
  | 'strategy'
  | 'troubleshooting'
  | 'proofs'
  | 'hallOfFame'
  | 'modifiers'
  | 'unknown'

export type RowKey = 'placementMap' | 'waveSkip' | 'steps' | 'difficulty' | 'modifiers' | 'unlabeled' | 'header'

export interface HeadingBlock {
  type: 'heading'
  depth: number
  text: string
}

export interface ListBlock {
  type: 'list'
  items: { indent: number; text: string }[]
}

export interface ParagraphBlock {
  type: 'paragraph'
  text: string
}

export interface TableBlock {
  type: 'table'
  rows: { cells: string[]; imageIds: string[]; links: { label: string; url: string }[] }[]
}

export type MdBlock = HeadingBlock | ListBlock | ParagraphBlock | TableBlock

const SECTION_ALIASES: Record<Exclude<SectionKey, 'unknown'>, string[]> = {
  credits: ['credits', 'kredi', 'krediler', 'created by', 'yapan'],
  notes: ['notes', 'note', 'notlar', 'notice', 'important notes'],
  strategy: ['strategy', 'strat', 'strateji'],
  troubleshooting: ['common issues', 'issues', 'problems', 'sorunlar', 'hatalar'],
  proofs: ['proofs', 'proof', 'kanıtlar', 'kanitlar'],
  hallOfFame: ['hall of fame', 'hof', 'şöhretler', 'sohretler'],
  modifiers: ['modifiers', 'modifier', 'mutators', 'mutator', 'değiştiriciler', 'degistiriciler']
}

const ROW_ALIASES: Record<Exclude<RowKey, 'unlabeled' | 'header' | 'steps' | 'difficulty'>, string[]> = {
  placementMap: ['placement map', 'placement', 'map', 'harita', 'yerleşim', 'yerlesim'],
  waveSkip: ['wave skipping tips', 'wave skip', 'skipping tips', 'skip tips', 'dalga atlama'],
  modifiers: ['modifiers', 'modifier', 'mutators', 'mutator']
}

const HEADER_ROW_TEXT = ['important', 'strategy', 'önemli', 'oneri', 'strateji', 'strat']
const SEPARATOR_CELL_RE = /^:?-{2,}:?$/

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\u00a0]/g, ' ')
    .replace(/[🏆⭐]/g, '')
    .replace(/[^a-z0-9çğıöşü\s.:_-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export function classifyHeading(text: string): SectionKey {
  const normalized = normalize(text)
  for (const [key, aliases] of Object.entries(SECTION_ALIASES) as [Exclude<SectionKey, 'unknown'>, string[]][]) {
    if (aliases.some((alias) => normalized === alias || normalized.startsWith(`${alias} `) || normalized.includes(alias))) {
      return key
    }
  }
  return 'unknown'
}

export function classifyRow(label: string): RowKey {
  const normalized = normalize(label)
  if (!normalized) return 'unlabeled'
  if (HEADER_ROW_TEXT.some((text) => normalized === text || normalized.startsWith(`${text}:`))) return 'header'
  if (/^waves?\s*:?\s*\d/.test(normalized) || /^waves?\s+\d/.test(normalized)) return 'steps'
  if (/^difficulty/.test(normalized) || /^zorluk/.test(normalized)) return 'difficulty'
  if (ROW_ALIASES.placementMap.some((alias) => normalized.startsWith(alias))) return 'placementMap'
  if (ROW_ALIASES.waveSkip.some((alias) => normalized.startsWith(alias))) return 'waveSkip'
  if (ROW_ALIASES.modifiers.some((alias) => normalized.startsWith(alias))) return 'modifiers'
  return 'unlabeled'
}

function parseTableRow(line: string): string[] | undefined {
  if (!line.trimStart().startsWith('|')) return undefined
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

export function parseMarkdownBlocks(markdownBody: string): MdBlock[] {
  const lines = markdownBody.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (!line.trim()) {
      index += 1
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', depth: heading[1]?.length ?? 1, text: inlineToText(heading[2] ?? '').text })
      index += 1
      continue
    }

    if (parseTableRow(line)) {
      const rows: TableBlock['rows'] = []
      while (index < lines.length) {
        const rawRow = lines[index] ?? ''
        const cells = parseTableRow(rawRow)
        if (!cells) break
        const isSeparator = cells.every((cell) => !cell || SEPARATOR_CELL_RE.test(cell))
        if (!isSeparator) {
          const parsedCells = cells.map((cell) => inlineToText(cell))
          rows.push({
            cells: parsedCells.map((cell) => cell.text),
            imageIds: parsedCells.flatMap((cell) => cell.imageIds),
            links: parsedCells.flatMap((cell) => cell.links)
          })
        }
        index += 1
      }
      if (rows.length > 0) blocks.push({ type: 'table', rows })
      continue
    }

    const listMatch = /^(\s*)[•*\-+]\s+(.*)$/.exec(line)
    if (listMatch) {
      const items: ListBlock['items'] = []
      while (index < lines.length) {
        const current = lines[index] ?? ''
        const item = /^(\s*)[•*\-+]\s+(.*)$/.exec(current)
        if (!item) break
        const indent = Math.floor((item[1] ?? '').replace(/\t/g, '    ').length / 2)
        items.push({ indent, text: inlineToText(item[2] ?? '').text })
        index += 1
      }
      blocks.push({ type: 'list', items })
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ''
      if (!current.trim() || /^(#{1,6})\s+/.test(current) || parseTableRow(current) || /^(\s*)[•*\-+]\s+/.test(current)) break
      paragraph.push(inlineToText(current).text)
      index += 1
    }
    const text = paragraph.filter(Boolean).join('\n').trim()
    if (text) blocks.push({ type: 'paragraph', text })
  }

  return blocks
}

export interface DocumentSection {
  key: SectionKey
  heading: string
  blocks: MdBlock[]
}

export interface ParsedDocument {
  title?: string
  subtitle?: string
  sections: DocumentSection[]
  blockCount: number
}

export function parseDocument(markdownBody: string): ParsedDocument {
  const blocks = parseMarkdownBlocks(markdownBody)
  const sections: DocumentSection[] = []
  let title: string | undefined
  let subtitle: string | undefined
  let seenHeading = false

  const push = (key: SectionKey, heading: string): DocumentSection => {
    const section: DocumentSection = { key, heading, blocks: [] }
    sections.push(section)
    return section
  }

  let current = push('unknown', '')

  for (const block of blocks) {
    if (block.type === 'heading') {
      seenHeading = true
      const key = classifyHeading(block.text)
      if (key === 'unknown' && !block.text) continue
      current = push(key, block.text)
      continue
    }

    if (block.type === 'paragraph' && !seenHeading && (!title || !subtitle)) {
      const lines = block.text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      if (!title) title = lines[0]
      if (!subtitle && lines.length > 1) subtitle = lines.slice(1).join(' ')
      else if (!subtitle && lines.length === 1 && title && lines[0] !== title) subtitle = lines[0]
      if (!subtitle && lines.length === 1 && title === lines[0]) {
        // single-line paragraph before any heading: keep as title, wait for subtitle
      }
      continue
    }

    current.blocks.push(block)
  }

  return {
    title,
    subtitle,
    sections: sections.filter((section) => section.blocks.length > 0 || section.key !== 'unknown'),
    blockCount: blocks.length
  }
}
