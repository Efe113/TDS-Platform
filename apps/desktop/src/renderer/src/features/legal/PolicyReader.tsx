import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, ClipboardList, Download, Scale, ShieldCheck, type LucideIcon } from 'lucide-react'
import {
  IPC_CHANNELS,
  POLICY_EFFECTIVE_DATE,
  POLICY_VERSION,
  SUPPORT_EMAIL,
  policyToMarkdown,
  text,
  type PolicyDocument,
  type PolicyLanguage,
  type PolicySection
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { call } from '../../lib/ipc'
import { cn } from '../../lib/utils'
import { renderMarkdown } from '../../lib/markdown'
import { exportFileName } from '../../lib/export-strategy'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Chip, Segmented } from '../../components/ui/system'
import { RevealItem, RevealList } from '../../motion/primitives/Reveal'

/**
 * The reading surface for the three long documents. A contract page is judged by whether a person can
 * find the clause they need, so the layout is a numbered register: a sticky clause index that follows
 * the scroll, one card per clause, and a copy handle on each clause instead of "select all and hunt".
 */

export function openLink(url: string): void {
  if (!/^https?:\/\//i.test(url)) return
  void call(IPC_CHANNELS.appOpenExternal, { url }).catch(() => undefined)
}

export function PolicyLanguageSwitch({
  language,
  explicit,
  onChoose
}: {
  language: PolicyLanguage
  explicit: boolean
  onChoose: (next: PolicyLanguage | null) => void
}): ReactNode {
  const t = useT()
  return (
    <Segmented
      size="sm"
      label={t('legal.language')}
      value={explicit ? language : 'auto'}
      onChange={(next) => onChoose(next === 'auto' ? null : (next as PolicyLanguage))}
      options={[
        { value: 'auto', label: t('legal.langAuto') },
        { value: 'tr', label: t('legal.langTr') },
        { value: 'en', label: t('legal.langEn') }
      ]}
    />
  )
}

export function PolicyDocumentHeader({
  document,
  language,
  version,
  kicker,
  actions
}: {
  document: PolicyDocument
  language: PolicyLanguage
  version?: string
  kicker?: ReactNode
  actions?: ReactNode
}): ReactNode {
  const t = useT()
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-panel px-6 py-6">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse 60% 70% at 88% 0%, #000 25%, transparent 72%)'
        }}
      />
      <div className="relative flex flex-wrap items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-brand/30 bg-base text-brand">
          {document.kind === 'privacy' ? <ShieldCheck size={22} /> : <Scale size={22} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-ink">{text(document.title, language)}</h1>
            {kicker}
          </div>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-mute">{text(document.summary, language)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge variant="secondary" className="font-mono text-[10px]">
            {`${t('legal.versionShort')} ${version ?? POLICY_VERSION}`}
          </Badge>
          <Chip tone="neutral">{t('legal.effectiveOn', { date: text(POLICY_EFFECTIVE_DATE, language) })}</Chip>
          <span className="select-text text-[11px] text-mute">{SUPPORT_EMAIL}</span>
        </div>
      </div>
      {actions ? <div className="relative mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">{actions}</div> : null}
    </div>
  )
}

/** The clause index: it tracks the scroll, because a long document is read by jumping, not in order. */
export function PolicyToc({ sections, language, anchorPrefix }: { sections: PolicySection[]; language: PolicyLanguage; anchorPrefix: string }): ReactNode {
  const t = useT()
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null)

  useEffect(() => {
    const observed = sections
      .map((section) => document.getElementById(`${anchorPrefix}-${section.id}`))
      .filter((node): node is HTMLElement => node !== null)
    if (observed.length === 0) return

    // One observer for the whole list, rootMargin biased to the top third: the clause you are reading is
    // the one whose heading has just passed under the header, not the one filling the viewport.
    const watcher = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        const id = visible?.target.getAttribute('data-clause')
        if (typeof id === 'string') setActive(id)
      },
      { rootMargin: '-15% 0px -65% 0px', threshold: 0 }
    )
    for (const node of observed) watcher.observe(node)
    return () => watcher.disconnect()
  }, [sections, anchorPrefix])

  return (
    <nav aria-label={t('legal.indexTitle')} className="hidden lg:block">
      <div className="sticky top-4 max-h-[calc(100vh-2rem)] space-y-1 overflow-y-auto pr-1">
        <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-mute/60">{t('legal.indexTitle')}</p>
        {sections.map((section, index) => {
          const on = section.id === active
          return (
            <button
              key={section.id}
              type="button"
              aria-current={on ? 'true' : undefined}
              onClick={() => document.getElementById(`${anchorPrefix}-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={cn(
                'no-drag flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                on ? 'bg-brand/12 text-ink' : 'text-mute hover:bg-panel-soft hover:text-ink'
              )}
            >
              <span className={cn('hud-num shrink-0 text-[10px]', on ? 'text-brand' : 'text-mute/60')}>{String(index + 1).padStart(2, '0')}</span>
              <span className="min-w-0 flex-1 truncate">{text(section.title, language)}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export function PolicySectionCard({
  section,
  language,
  anchorPrefix,
  index,
  icon: Icon,
  tone = 'default'
}: {
  section: PolicySection
  language: PolicyLanguage
  anchorPrefix: string
  index: number
  /** Id-keyed by the caller: two languages mean a title can never be the lookup. */
  icon?: LucideIcon
  /** `trust` is the "what we never do" register — the section that reads as a promise, not a clause. */
  tone?: 'default' | 'trust'
}): ReactNode {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const body = useMemo(() => text(section.body, language), [section, language])

  const copy = (): void => {
    void navigator.clipboard.writeText(`## ${text(section.title, language)}\n\n${body}`).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    })
  }

  return (
    <RevealItem>
      <Card
        id={`${anchorPrefix}-${section.id}`}
        data-clause={section.id}
        className={cn('scroll-mt-4 h-full', tone === 'trust' ? 'border-good/30 bg-good/[0.03]' : index === 0 && 'border-t-2 border-t-brand/40')}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            {Icon ? (
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-xl',
                  tone === 'trust' ? 'bg-good/15 text-good' : 'bg-brand/15 text-brand'
                )}
              >
                <Icon size={16} />
              </span>
            ) : (
              <span className="hud-num shrink-0 font-mono text-[11px] text-brand/70">{String(index + 1).padStart(2, '0')}</span>
            )}
            <span className="min-w-0">{text(section.title, language)}</span>
            <button
              type="button"
              title={t('legal.copyClause')}
              onClick={copy}
              className="no-drag ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-mute transition-colors hover:bg-panel-soft hover:text-ink"
            >
              {copied ? <Check size={11} /> : <ClipboardList size={11} />}
              {copied ? t('legal.copiedClause') : ''}
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <article className="max-w-3xl space-y-2 text-sm leading-relaxed text-mute">{renderMarkdown(body, { onLink: openLink })}</article>
        </CardContent>
      </Card>
    </RevealItem>
  )
}

export function PolicySectionList({ sections, language, anchorPrefix }: { sections: PolicySection[]; language: PolicyLanguage; anchorPrefix: string }): ReactNode {
  return (
    <RevealList className="space-y-4" count={Math.min(sections.length, 10)}>
      {sections.map((section, index) => (
        <PolicySectionCard key={section.id} section={section} language={language} anchorPrefix={anchorPrefix} index={index} />
      ))}
    </RevealList>
  )
}

/** Writes the document out as one markdown file, through the same save channel the strategy export uses. */
export function PolicyDownloadButton({ document, language }: { document: PolicyDocument; language: PolicyLanguage }): ReactNode {
  const t = useT()
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const download = (): void => {
    setBusy(true)
    void call<{ saved: boolean }>(IPC_CHANNELS.appSaveFile, {
      fileName: exportFileName(text(document.title, language), 'md'),
      content: policyToMarkdown(document, language)
    })
      .then((result) => {
        if (!result.saved) return
        setDone(true)
        window.setTimeout(() => setDone(false), 1800)
      })
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }

  return (
    <Button size="sm" variant="ghost" busy={busy} onClick={download}>
      <Download size={13} />
      {done ? t('legal.downloaded') : t('legal.download')}
    </Button>
  )
}
