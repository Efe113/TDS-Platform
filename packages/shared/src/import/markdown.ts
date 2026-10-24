const ESCAPED_PUNCTUATION = '\\`*_{}[]()#+-.!>~|"$\'/:'

const escapeClass = `[${ESCAPED_PUNCTUATION.replace(/[-\\^\]]/g, '\\$&')}]`
const UNESCAPE_RE = new RegExp(`\\\\(${escapeClass})`, 'g')

export function unescapeMarkdown(input: string): string {
  return input.replace(UNESCAPE_RE, '$1')
}

const IMAGE_REF_RE = /!\[[^\]]*\]\[([^\]]+)\]/g
const INLINE_IMAGE_RE = /!\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g
const LINK_RE = /\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g
const EMPHASIS_BOLD_RE = /\*\*([^*]+)\*\*/g
const EMPHASIS_BOLD_US_RE = /__([^_]+)__/g
const EMPHASIS_ITALIC_RE = /(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!)]|$)/g

/** Unicode punctuation from Google Docs must fold to ASCII or word tests miss `doesn’t`. */
export function normalizePunctuation(input: string): string {
  return input
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u00A0\u2009\u202F]/g, ' ')
}

export interface InlineResult {
  text: string
  imageIds: string[]
  links: { label: string; url: string }[]
}

export function inlineToText(input: string): InlineResult {
  const imageIds: string[] = []
  const links: { label: string; url: string }[] = []

  let work = normalizePunctuation(unescapeMarkdown(input))

  work = work.replace(IMAGE_REF_RE, (_match, id: string) => {
    imageIds.push(id.trim())
    return ''
  })

  work = work.replace(INLINE_IMAGE_RE, (_match, target: string) => {
    imageIds.push(stripAngle(target))
    return ''
  })

  work = work.replace(LINK_RE, (_match, label: string, url: string) => {
    const cleanUrl = stripAngle(url)
    links.push({ label: label.trim(), url: cleanUrl })
    return label.trim()
  })

  // Paired markers only — a lone `_` belongs to a handle like `@myuuuu_`.
  work = work.replace(EMPHASIS_BOLD_RE, '$1').replace(EMPHASIS_BOLD_US_RE, '$1').replace(EMPHASIS_ITALIC_RE, '$1$2')

  return {
    text: work.replace(/[ \t\u00a0]+/g, ' ').trim(),
    imageIds,
    links
  }
}

function stripAngle(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed
}

const IMAGE_DEF_RE = /^\[([^\]]+)\]:\s*(<[^>]*>|\S+)\s*$/gm

export interface ImageDefinition {
  id: string
  target: string
  isDataUrl: boolean
  mime?: string
  byteLength: number
  offset: number
}

export interface MarkdownSource {
  body: string
  imageDefs: Map<string, ImageDefinition>
  /** Slices the original document so large base64 payloads are only materialised on demand. */
  readImage(id: string): string | undefined
}

export function splitImageDefinitions(markdown: string): MarkdownSource {
  const imageDefs = new Map<string, ImageDefinition>()
  let body = ''
  let cursor = 0

  IMAGE_DEF_RE.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = IMAGE_DEF_RE.exec(markdown)) !== null) {
    const id = match[1]
    const target = match[2]
    if (!id || !target) continue
    body += markdown.slice(cursor, match.index)
    cursor = match.index + match[0].length

    const isDataUrl = target.startsWith('data:') || target.startsWith('<data:')
    const mimeMatch = /^<?data:([^;,]+)[;,]/.exec(target)
    imageDefs.set(id.trim(), {
      id: id.trim(),
      target,
      isDataUrl,
      mime: mimeMatch?.[1],
      byteLength: target.length,
      offset: match.index
    })
  }

  body += markdown.slice(cursor)

  return {
    body,
    imageDefs,
    readImage(id) {
      const definition = imageDefs.get(id)
      if (!definition) return undefined
      const raw = markdown.slice(definition.offset, definition.offset + definition.target.length + 4)
      const found = /^\[([^\]]+)\]:\s*(<[^>]*>|\S+)/m.exec(raw)
      return found?.[2] ? stripAngle(found[2]) : undefined
    }
  }
}

export function decodeDataUrl(dataUrl: string): { mime: string; base64: string } | undefined {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl)
  if (!match) return undefined
  return { mime: match[1] ?? 'application/octet-stream', base64: match[2] ?? '' }
}
