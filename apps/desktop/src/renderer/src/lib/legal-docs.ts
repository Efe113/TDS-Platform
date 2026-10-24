/**
 * The three long documents are the single source of truth for both the About page and the consent
 * screens, so the UI slices them instead of copying the text into translation keys. Everything here
 * is presentation-only parsing: headings become cards, `### ` blocks become the FAQ.
 */

export interface DocSection {
  id: string
  title: string
  body: string
}

export interface FaqItem {
  q: string
  a: string
}

const SLUG_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }

export function slugify(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşü]/g, (char) => SLUG_MAP[char] ?? char)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Drops the document's own `# Title` (and a leading `Sürüm:` line) that the page header already shows. */
export function dropTitle(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line, index) => !(index < 3 && (/^#\s/.test(line) || /^Sürüm:/i.test(line))))
    .join('\n')
    .trim()
}

export function splitSections(markdown: string): { intro: string; sections: DocSection[] } {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const intro: string[] = []
  const sections: DocSection[] = []
  let current: DocSection | null = null

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current)
      const title = line.slice(3).trim()
      current = { id: slugify(title), title, body: '' }
      continue
    }
    if (line.startsWith('# ')) continue
    if (current) current.body += `${current.body.length > 0 ? '\n' : ''}${line}`
    else if (line.trim().length > 0) intro.push(line)
  }

  if (current) sections.push(current)

  return {
    intro: intro.join('\n').trim(),
    sections: sections.map((section) => ({ ...section, body: section.body.trim() }))
  }
}

/** The FAQ section is written as `### question` blocks; the accordion needs them as pairs. */
export function parseFaq(body: string): FaqItem[] {
  const items: FaqItem[] = []
  let current: FaqItem | null = null

  for (const line of body.split('\n')) {
    if (line.startsWith('### ')) {
      if (current) items.push(current)
      current = { q: line.slice(4).trim(), a: '' }
      continue
    }
    if (current) current.a += `${current.a.length > 0 ? '\n' : ''}${line}`
  }

  if (current) items.push(current)

  return items.map((item) => ({ q: item.q, a: item.a.trim() })).filter((item) => item.q.length > 0 && item.a.length > 0)
}

/** True when the section is the FAQ, so the page can render it as an accordion instead of prose. */
export function isFaqSection(section: DocSection): boolean {
  return section.body.includes('### ')
}
