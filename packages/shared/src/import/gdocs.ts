export type GdocsExportFormat = 'md' | 'docx' | 'html' | 'txt' | 'pdf'

const DOC_ID_RE = /\/document\/d\/([A-Za-z0-9-_]{20,})/

export interface GdocsLinkInfo {
  docId: string
  url: string
}

export function extractDocId(input: string): GdocsLinkInfo | undefined {
  const trimmed = input.trim()
  const match = DOC_ID_RE.exec(trimmed)
  if (match?.[1]) return { docId: match[1], url: trimmed }

  if (/^[A-Za-z0-9-_]{20,}$/.test(trimmed)) return { docId: trimmed, url: trimmed }
  return undefined
}

export function gdocsExportUrl(docId: string, format: GdocsExportFormat): string {
  return `https://docs.google.com/document/d/${encodeURIComponent(docId)}/export?format=${format}`
}

export function isBlockedExportResponse(status: number, contentType: string): boolean {
  if (status === 401 || status === 403 || status === 404) return true
  return /text\/html/i.test(contentType)
}

export const GDOCS_NOT_PUBLIC_MESSAGE =
  'Belge herkese açık değil ya da bağlantı geçersiz. Bağlantı paylaşımını "Bağlantıya sahip herkes" yap ya da .docx / .md dosyasını yükle.'
