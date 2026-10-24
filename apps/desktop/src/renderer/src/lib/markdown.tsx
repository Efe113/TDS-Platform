import type { ReactNode } from 'react'

const HEADING_RE = /^(#{1,4})\s+(.+)$/
const UNORDERED_RE = /^\s*[-*]\s+(.+)$/
const ORDERED_RE = /^\s*(\d+)[.)]\s+(.+)$/
const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g

interface LinkTarget {
  onLink?: (url: string) => void
}

function renderInline(text: string, keyBase: string, options: LinkTarget): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  let index = 0
  let match: RegExpExecArray | null

  INLINE_RE.lastIndex = 0
  while ((match = INLINE_RE.exec(text)) !== null) {
    const plain = text.slice(cursor, match.index)
    if (plain) nodes.push(plain)
    const full = match[0] ?? ''
    const code = match[1]
    const bold = match[2]
    const link = match[3]
    const linkLabel = match[4]
    const linkHref = match[5]
    const key = `${keyBase}-${String(index++)}`
    if (code) nodes.push(<code key={key} className="rounded bg-panel-soft px-1 py-0.5 text-[0.9em] text-brand">{code.slice(1, -1)}</code>)
    else if (bold) nodes.push(<strong key={key}>{bold.slice(2, -2)}</strong>)
    else if (link && full) {
      const href = linkHref ?? ''
      nodes.push(
        <a
          key={key}
          href={href}
          className="text-brand underline decoration-dotted underline-offset-2"
          onClick={(event) => {
            event.preventDefault()
            options.onLink?.(href)
          }}
        >
          {linkLabel ?? href}
        </a>
      )
    }
    cursor = match.index + full.length
  }

  const tail = text.slice(cursor)
  if (tail) nodes.push(tail)
  return nodes
}

export function renderMarkdown(source: string, options: LinkTarget = {}): ReactNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let orderedList: { marker: string; text: string }[] = []

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    const text = paragraph.join(' ')
    blocks.push(<p key={`p-${String(blocks.length)}`}>{renderInline(text, `p-${String(blocks.length)}`, options)}</p>)
    paragraph = []
  }

  const flushList = (): void => {
    if (list.length === 0 && orderedList.length === 0) return
    if (list.length > 0) {
      blocks.push(
        <ul key={`ul-${String(blocks.length)}`} className="list-disc space-y-1 pl-5">
          {list.map((item, itemIndex) => (
            <li key={`li-${String(itemIndex)}`}>{renderInline(item, `li-${String(itemIndex)}`, options)}</li>
          ))}
        </ul>
      )
    } else {
      blocks.push(
        <ol key={`ol-${String(blocks.length)}`} className="list-decimal space-y-1 pl-5">
          {orderedList.map((item, itemIndex) => (
            <li key={`li-${String(itemIndex)}`}>{renderInline(item.text, `li-${String(itemIndex)}`, options)}</li>
          ))}
        </ol>
      )
    }
    list = []
    orderedList = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const heading = HEADING_RE.exec(trimmed)
    const unordered = UNORDERED_RE.exec(line)
    const ordered = ORDERED_RE.exec(line)

    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    if (heading?.[1] && heading[2]) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      const content = renderInline(heading[2], `h-${String(blocks.length)}`, options)
      const key = `h-${String(blocks.length)}`
      if (level === 1) blocks.push(<h1 key={key} className="text-2xl font-semibold">{content}</h1>)
      else if (level === 2) blocks.push(<h2 key={key} className="mt-6 text-lg font-semibold text-ink">{content}</h2>)
      else blocks.push(<h3 key={key} className="mt-4 text-base font-semibold text-brand">{content}</h3>)
      continue
    }

    if (unordered?.[1]) {
      flushParagraph()
      list.push(unordered[1])
      continue
    }

    if (ordered?.[2]) {
      flushParagraph()
      orderedList.push({ marker: ordered[1] ?? '', text: ordered[2] })
      continue
    }

    flushList()
    paragraph.push(trimmed)
  }

  flushParagraph()
  flushList()
  return blocks
}
