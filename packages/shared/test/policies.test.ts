import { describe, expect, it } from 'vitest'
import {
  ABOUT_DOCUMENT,
  ABOUT_FAQ,
  LEGAL_DOCUMENTS,
  POLICY_DOCUMENTS,
  POLICY_VERSION,
  SUPPORT_EMAIL,
  pickLanguage,
  policyDocument,
  policyToMarkdown,
  text,
  type LocalizedText,
  type PolicyDocument
} from '../src/index'

/**
 * The three long documents used to be one Turkish markdown string each, and the interface re-parsed the
 * headings to find an icon. That model could not fail loudly: an English interface silently kept showing
 * Turkish contracts, and a section translated in only one language still rendered as a card.
 *
 * Now the copy is structured data, so the guarantee has to be a test. These rules are the parity contract
 * between the two languages — the page layout reads the ids, so a missing id or a clause number that
 * drifts between `tr` and `en` is a layout bug, not a typo.
 */

const TURKISH_ONLY_LETTERS = /[çğıöşüÇĞİÖŞÜ]/

/** `### ` blocks are FAQ entries; the numbered clauses are the register itself. */
const CLAUSE_NUMBER = /^\s*(\d+)\.\s/

const documents: readonly PolicyDocument[] = LEGAL_DOCUMENTS

describe('policy registry language parity', () => {
  it('keeps every clause written in both languages', () => {
    for (const document of documents) {
      for (const section of document.sections) {
        for (const field of [section.title, section.body] as LocalizedText[]) {
          expect(field.tr.trim().length, `${document.kind}/${section.id} tr`).toBeGreaterThan(0)
          expect(field.en.trim().length, `${document.kind}/${section.id} en`).toBeGreaterThan(0)
        }
        expect(section.title.en, `${document.kind}/${section.id} title left in Turkish`).not.toBe(section.title.tr)
      }
    }
  })

  it('never leaves Turkish letters in the English text', () => {
    const offenders: string[] = []
    for (const document of documents) {
      const parts: LocalizedText[] = [document.title, document.summary, ...document.sections.map((s) => s.title), ...document.sections.map((s) => s.body)]
      for (const part of parts) if (TURKISH_ONLY_LETTERS.test(part.en)) offenders.push(`${document.kind}: ${part.en.slice(0, 60)}`)
    }
    for (const entry of ABOUT_FAQ) if (TURKISH_ONLY_LETTERS.test(entry.q.en) || TURKISH_ONLY_LETTERS.test(entry.a.en)) offenders.push(`faq: ${entry.q.en.slice(0, 60)}`)
    expect(offenders).toEqual([])
  })

  it('keys every clause on an anchor-safe id, unique inside its document', () => {
    for (const document of documents) {
      const seen = new Set<string>()
      for (const section of document.sections) {
        expect(section.id, `${document.kind} id is not anchor-safe`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        expect(seen.has(section.id), `${document.kind}/${section.id} duplicated`).toBe(false)
        seen.add(section.id)
      }
    }
  })

  it('numbers the same clause the same way in both languages', () => {
    for (const document of documents.filter((doc) => doc.kind !== 'about')) {
      for (const section of document.sections) {
        const tr = CLAUSE_NUMBER.exec(section.title.tr)?.[1]
        const en = CLAUSE_NUMBER.exec(section.title.en)?.[1]
        expect(tr, `${document.kind}/${section.id} tr title is not a numbered clause`).toBeTruthy()
        expect(en, `${document.kind}/${section.id} en clause number drifted`).toBe(tr)
      }
      // The register is read as a sequence: 1..n with no gap.
      expect(document.sections.map((section) => CLAUSE_NUMBER.exec(section.title.tr)?.[1])).toEqual(
        document.sections.map((_, index) => String(index + 1))
      )
    }
  })

  it('keeps the support address inside the documents that name a contact', () => {
    for (const kind of ['privacy', 'terms'] as const) {
      const document = policyDocument(kind)
      const joined = document.sections.map((section) => `${section.title.tr} ${section.body.tr} ${section.title.en} ${section.body.en}`).join(' ')
      expect(joined, `${kind} never tells the reader how to reach us`).toContain(SUPPORT_EMAIL)
    }
  })

  it('gates consent on the two contracts only, never on the product page', () => {
    expect(POLICY_DOCUMENTS.map((document) => document.kind)).toEqual(['privacy', 'terms'])
    expect(policyDocument('about').kind).toBe(ABOUT_DOCUMENT.kind)
  })

  it('defaults to Turkish and switches only on an English interface', () => {
    expect(pickLanguage(null)).toBe('tr')
    expect(pickLanguage('tr')).toBe('tr')
    expect(pickLanguage('en')).toBe('en')
    expect(pickLanguage('en-US')).toBe('en')
  })
})

describe('policy markdown export', () => {
  it('writes one heading per clause in the requested language', () => {
    for (const document of documents) {
      for (const language of ['tr', 'en'] as const) {
        const markdown = policyToMarkdown(document, language)
        expect(markdown.startsWith(`# ${text(document.title, language)}`)).toBe(true)
        expect(markdown).toContain(POLICY_VERSION)
        expect(markdown.match(/^## /gm)?.length).toBe(document.sections.length)
        for (const section of document.sections) expect(markdown).toContain(`## ${text(section.title, language)}`)
        // A Turkish export must not leak the English clause, and the other way round.
        const other = language === 'tr' ? 'en' : 'tr'
        const sample = document.sections[0]
        if (sample) expect(markdown).not.toContain(text(sample.body, other))
      }
    }
  })

  it('appends the FAQ only when one is passed', () => {
    const withFaq = policyToMarkdown(ABOUT_DOCUMENT, 'tr', ABOUT_FAQ)
    expect(withFaq.match(/^### /gm)?.length).toBe(ABOUT_FAQ.length)
    expect(policyToMarkdown(ABOUT_DOCUMENT, 'tr').match(/^### /gm)).toBeNull()
  })
})
