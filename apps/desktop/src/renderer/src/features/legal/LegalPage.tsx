import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Reveal, RevealItem, RevealList } from '../../motion/primitives/Reveal'
import { CalendarClock, FileText, Scale, ShieldCheck, Trash2 } from 'lucide-react'
import {
  DEFAULT_POLICY_DOCUMENT,
  IPC_CHANNELS,
  POLICY_DOCUMENTS,
  POLICY_VERSION,
  SUPPORT_EMAIL,
  type AppMeta,
  type PolicyKind
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { call } from '../../lib/ipc'
import { navigate, routeSegments, useRoutePath } from '../../lib/router'
import { renderMarkdown } from '../../lib/markdown'
import { dropTitle, splitSections } from '../../lib/legal-docs'
import { cn } from '../../lib/utils'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs'

const KINDS: string[] = POLICY_DOCUMENTS.map((document) => document.kind)

function isPolicyKind(value: string | undefined): value is PolicyKind {
  return value !== undefined && KINDS.includes(value)
}

/** Three facts a reader actually scans for, instead of making them find them in the prose. */
interface KeyFact {
  icon: typeof ShieldCheck
  labelKey: MessageKey
  bodyKey: MessageKey
}

const PRIVACY_FACTS: KeyFact[] = [
  { icon: ShieldCheck, labelKey: 'legal.factCollectTitle', bodyKey: 'legal.factCollectBody' },
  { icon: CalendarClock, labelKey: 'legal.factKeepTitle', bodyKey: 'legal.factKeepBody' },
  { icon: Trash2, labelKey: 'legal.factDeleteTitle', bodyKey: 'legal.factDeleteBody' }
]

const TERMS_FACTS: KeyFact[] = [
  { icon: FileText, labelKey: 'legal.factContentTitle', bodyKey: 'legal.factContentBody' },
  { icon: Scale, labelKey: 'legal.factRiskTitle', bodyKey: 'legal.factRiskBody' },
  { icon: ShieldCheck, labelKey: 'legal.factEconomyTitle', bodyKey: 'legal.factEconomyBody' }
]

function openLink(url: string): void {
  if (!/^https?:\/\//i.test(url)) return
  void call(IPC_CHANNELS.appOpenExternal, { url }).catch(() => undefined)
}

function scrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function LegalPage(): ReactNode {
  const t = useT()
  const path = useRoutePath()
  const selected = routeSegments(path)[1]
  const activeKind: PolicyKind = isPolicyKind(selected) ? selected : DEFAULT_POLICY_DOCUMENT.kind
  const active = POLICY_DOCUMENTS.find((document) => document.kind === activeKind) ?? DEFAULT_POLICY_DOCUMENT
  const activeTitle = active.kind === 'privacy' ? t('legal.tabPrivacy') : t('legal.tabTerms')
  const facts = active.kind === 'privacy' ? PRIVACY_FACTS : TERMS_FACTS
  const { intro, sections } = splitSections(dropTitle(active.body))

  const metaQuery = useQuery({
    queryKey: ['app', 'meta'],
    queryFn: () => call<AppMeta>(IPC_CHANNELS.appGetMeta),
    retry: false
  })

  const version = metaQuery.data?.policyVersion ?? POLICY_VERSION

  return (
    <div className="space-y-5">
      <Reveal>
        <header className="relative overflow-hidden rounded-2xl border border-line bg-panel px-6 py-7">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
            maskImage: 'radial-gradient(ellipse 60% 70% at 85% 0%, #000 25%, transparent 70%)'
          }}
        />
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-brand/20 blur-3xl" />

        <div className="relative flex flex-wrap items-start gap-4">
          <span className="flex size-12 items-center justify-center rounded-2xl border border-brand/30 bg-base text-brand">
            <Scale size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight text-ink">{t('legal.title')}</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-mute">{t('legal.intro')}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant="secondary" className="font-mono text-[10px]">
              {t('legal.versionShort')} {version}
            </Badge>
            <span className="select-text text-[11px] text-mute">{SUPPORT_EMAIL}</span>
          </div>
        </div>
        </header>
      </Reveal>

      <Tabs value={activeKind} onValueChange={(value) => navigate(`/legal/${value}`)}>
        <TabsList className="w-full justify-start">
          {POLICY_DOCUMENTS.map((document) => (
            <TabsTrigger key={document.kind} value={document.kind}>
              {document.kind === 'privacy' ? t('legal.tabPrivacy') : t('legal.tabTerms')}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <RevealList className="grid gap-3 sm:grid-cols-3" count={facts.length}>
        {facts.map((fact) => {
          const Icon = fact.icon
          return (
            <RevealItem key={fact.labelKey} className="h-full">
              <Card className="h-full">
                <CardContent className="space-y-1.5">
                  <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-brand">
                    <Icon size={13} />
                    {t(fact.labelKey)}
                  </span>
                  <p className="text-xs leading-relaxed text-mute">{t(fact.bodyKey)}</p>
                </CardContent>
              </Card>
            </RevealItem>
          )
        })}
      </RevealList>

      <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav className="hidden lg:block">
          <div className="sticky top-4 space-y-1">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-mute/60">{t('legal.indexTitle')}</p>
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => scrollToSection(`${activeKind}-${section.id}`)}
                className="no-drag block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs text-mute transition-colors hover:bg-panel-soft hover:text-ink"
              >
                {section.title}
              </button>
            ))}
          </div>
        </nav>

        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold tracking-tight text-ink">{activeTitle}</h2>
            <span className="text-[11px] text-mute">{t('legal.reading', { count: sections.length })}</span>
          </div>

          {intro.length > 0 ? (
            <Card className="border-brand/25 bg-gradient-to-br from-brand/[0.07] to-transparent">
              <CardContent>
                <p className="text-sm font-medium leading-relaxed text-ink/90">{t('legal.summaryLead')}</p>
                <article className="mt-2 max-w-3xl space-y-2 text-sm leading-relaxed text-mute">
                  {renderMarkdown(intro, { onLink: openLink })}
                </article>
              </CardContent>
            </Card>
          ) : null}

          {sections.map((section, index) => (
            <Card key={section.id} id={`${activeKind}-${section.id}`} className={cn('scroll-mt-4', index === 0 && 'border-t-2 border-t-brand/40')}>
              <CardHeader>
                <CardTitle className="flex items-baseline gap-2 text-sm">
                  <span className="font-mono text-[11px] text-brand/70">{String(index + 1).padStart(2, '0')}</span>
                  {section.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <article className="max-w-3xl space-y-2 text-sm leading-relaxed text-mute">
                  {renderMarkdown(section.body, { onLink: openLink })}
                </article>
              </CardContent>
            </Card>
          ))}

          <p className="border-t border-line pt-4 text-[11px] leading-relaxed text-mute">
            {t('legal.openExternal')} {t('legal.reconsentNote', { version })}
          </p>
        </div>
      </div>
    </div>
  )
}
