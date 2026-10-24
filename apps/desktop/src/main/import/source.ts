import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { GDOCS_NOT_PUBLIC_MESSAGE, extractDocId, gdocsExportUrl } from '@tds/shared'

export const MAX_DOC_BYTES = 64 * 1024 * 1024

export interface FetchedMarkdownDoc {
  markdown: string
  docId?: string
  sourceUrl?: string
  sha256: string
  byteLength: number
}

export type ImportFailureCode = 'invalid-link' | 'not-public' | 'too-large' | 'network' | 'read-failed'

export interface ImportFailure {
  ok: false
  code: ImportFailureCode
  message: string
  hint?: string
}

export type ImportSourceResult = { ok: true; doc: FetchedMarkdownDoc } | ImportFailure

const hash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

function contentTypeOf(response: Response): string {
  return response.headers.get('content-type') ?? ''
}

/**
 * Only ever reads publicly link-shared documents through Google's own export endpoint.
 * The user's Google cookies are never attached — an authed request would be an account risk.
 */
export async function fetchGoogleDocsMarkdown(link: string, signal?: AbortSignal): Promise<ImportSourceResult> {
  const info = extractDocId(link)
  if (!info) {
    return { ok: false, code: 'invalid-link', message: 'Bu bir Google Docs belge bağlantısı değil.' }
  }

  try {
    const response = await fetch(gdocsExportUrl(info.docId, 'md'), {
      redirect: 'follow',
      signal,
      headers: { 'user-agent': 'TDS-Companion/0.1 (+desktop app; user-initiated export)' }
    })

    if (response.status === 404 || response.status === 401 || response.status === 403 || /text\/html/i.test(contentTypeOf(response))) {
      return { ok: false, code: 'not-public', message: GDOCS_NOT_PUBLIC_MESSAGE }
    }

    if (!response.ok) {
      return { ok: false, code: 'network', message: `Belge indirilemedi (HTTP ${response.status}).` }
    }

    const lengthHeader = Number.parseInt(response.headers.get('content-length') ?? '0', 10)
    if (lengthHeader > MAX_DOC_BYTES) {
      return { ok: false, code: 'too-large', message: 'Belge çok büyük (64 MB üstü). Görselleri küçültüp tekrar dene.' }
    }

    const markdown = await response.text()
    if (markdown.length > MAX_DOC_BYTES) {
      return { ok: false, code: 'too-large', message: 'Belge çok büyük (64 MB üstü). Görselleri küçültüp tekrar dene.' }
    }

    return {
      ok: true,
      doc: { markdown, docId: info.docId, sourceUrl: info.url, sha256: hash(markdown), byteLength: markdown.length }
    }
  } catch (error) {
    return { ok: false, code: 'network', message: 'Belge indirilemedi: ağ hatası.', hint: String(error) }
  }
}

export async function readMarkdownFile(path: string): Promise<ImportSourceResult> {
  try {
    const buffer = await readFile(path)
    if (buffer.byteLength > MAX_DOC_BYTES) {
      return { ok: false, code: 'too-large', message: 'Dosya 64 MB üstünde.' }
    }
    const markdown = buffer.toString('utf8')
    return { ok: true, doc: { markdown, sourceUrl: path, sha256: hash(markdown), byteLength: buffer.byteLength } }
  } catch (error) {
    return { ok: false, code: 'read-failed', message: 'Dosya okunamadı.', hint: String(error) }
  }
}
