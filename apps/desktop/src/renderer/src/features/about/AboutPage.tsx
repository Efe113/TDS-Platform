import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Boxes,
  Cpu,
  Coins,
  Database,
  FileText,
  Gamepad2,
  Info,
  Keyboard,
  Mail,
  ShieldCheck,
  Sparkles,
  type LucideIcon
} from 'lucide-react'
import { ABOUT_MD, IPC_CHANNELS, SUPPORT_EMAIL, type AppMeta } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { call } from '../../lib/ipc'
import { navigate } from '../../lib/router'
import { renderMarkdown } from '../../lib/markdown'
import { parseFaq, splitSections, type DocSection } from '../../lib/legal-docs'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion'
import { Logo } from '../../components/brand/logo'
import { Reveal, RevealItem, RevealList } from '../../motion/primitives/Reveal'

/** The stack, as chips. The prose in the document explains what each piece is for. */
const STACK: string[] = ['Electron', 'React 19', 'TypeScript', 'Tailwind v4', 'Supabase / RLS', 'koffi', 'i18next', 'Sentry', 'GitHub Releases']

function sectionIcon(title: string): LucideIcon {
  const head = title.toLocaleLowerCase('tr')
  if (head.includes('yapmaz')) return ShieldCheck
  if (head.includes('tuş') || head.includes('overlay')) return Keyboard
  if (head.includes('ekonomi') || head.includes('rozet')) return Coins
  if (head.includes('teknoloji')) return Cpu
  if (head.includes('marka')) return Gamepad2
  if (head.includes('destek') || head.includes('telif')) return Mail
  if (head.includes('sürüm')) return Boxes
  if (head.includes('yapar')) return Sparkles
  return FileText
}

function isTrust(title: string): boolean {
  return title.toLocaleLowerCase('tr').includes('yapmaz')
}

function openLink(url: string): void {
  if (!/^https?:\/\//i.test(url)) return
  void call(IPC_CHANNELS.appOpenExternal, { url }).catch(() => undefined)
}

function SectionCard({ section }: { section: DocSection }): ReactNode {
  const Icon = sectionIcon(section.title)
  const trust = isTrust(section.title)

  return (
    <RevealItem className="h-full">
      <Card className={trust ? 'h-full border-good/30 bg-good/[0.03]' : 'h-full'}>
        <CardHeader>
            <CardTitle className="flex items-center gap-2.5 text-sm">
              <span
                className={
                  trust
                    ? 'flex size-8 items-center justify-center rounded-xl bg-good/15 text-good'
                    : 'flex size-8 items-center justify-center rounded-xl bg-brand/15 text-brand'
                }
              >
                <Icon size={16} />
              </span>
              {section.title}
            </CardTitle>
        </CardHeader>
        <CardContent>
          <article className="space-y-2 text-sm leading-relaxed text-mute">{renderMarkdown(section.body, { onLink: openLink })}</article>
        </CardContent>
      </Card>
    </RevealItem>
  )
}

export function AboutPage(): ReactNode {
  const t = useT()
  const { intro, sections } = splitSections(ABOUT_MD)
  const faq = sections.find((section) => section.title.toLocaleLowerCase('tr').includes('sorulan'))
  const prose = sections.filter((section) => section !== faq)

  const metaQuery = useQuery({
    queryKey: ['app', 'meta'],
    queryFn: () => call<AppMeta>(IPC_CHANNELS.appGetMeta),
    retry: false
  })

  return (
    <div className="space-y-6">
      <Reveal>
        <section className="relative overflow-hidden rounded-2xl border border-line bg-panel px-6 py-8">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage: 'linear-gradient(to right, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)',
            backgroundSize: '36px 36px',
            maskImage: 'radial-gradient(ellipse 70% 60% at 20% 0%, #000 30%, transparent 75%)'
          }}
        />
        <span aria-hidden className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-brand/20 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -right-10 bottom-0 text-ink opacity-[0.05]">
          <Logo size={210} />
        </span>

        <div className="relative flex flex-wrap items-start gap-5">
          <span className="relative flex size-16 items-center justify-center rounded-2xl border border-brand/30 bg-base text-ink">
            <span aria-hidden className="absolute inset-0 rounded-2xl bg-gradient-to-br from-brand/30 to-transparent" />
            <Logo size={38} className="relative" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('app.name')}</h1>
              <Badge variant="outline" className="border-brand/50 text-[10px] font-bold tracking-widest text-brand">
                {t('app.alpha')}
              </Badge>
            </div>
            <p className="mt-1 text-xs uppercase tracking-widest text-mute/70">{t('about.kicker')}</p>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink/85">{t('about.pitch')}</p>
          </div>
        </div>

        {intro.length > 0 ? (
          <p className="relative mt-6 max-w-3xl text-sm leading-relaxed text-mute">{renderMarkdown(intro, { onLink: openLink })}</p>
        ) : null}

        <div className="relative mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {metaQuery.data ? (
            <>
              <Badge variant="secondary" className="font-mono text-[10px]">v{metaQuery.data.version}</Badge>
              <Badge variant="secondary" className="font-mono text-[10px]">Electron {metaQuery.data.electron}</Badge>
              <Badge variant="secondary" className="font-mono text-[10px]">{metaQuery.data.platform}</Badge>
            </>
          ) : null}
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-mute">
            <Mail size={12} />
            <span className="select-text">{SUPPORT_EMAIL}</span>
          </span>
        </div>
        </section>
      </Reveal>

      <RevealList className="grid gap-4 lg:grid-cols-2" count={Math.min(prose.length, 8)}>
        {prose.map((section) => (
          <SectionCard key={section.id} section={section} />
        ))}
      </RevealList>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5 text-sm">
            <span className="flex size-8 items-center justify-center rounded-xl bg-brand/15 text-brand">
              <Database size={16} />
            </span>
            {t('about.stackTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {STACK.map((item) => (
              <span key={item} className="rounded-lg border border-line bg-base/60 px-2.5 py-1 font-mono text-[11px] text-mute">
                {item}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {faq ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5 text-sm">
              <span className="flex size-8 items-center justify-center rounded-xl bg-brand/15 text-brand">
                <Info size={16} />
              </span>
              {faq.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="space-y-1">
              {parseFaq(faq.body).map((item, index) => (
                <AccordionItem key={item.q} value={`faq-${String(index)}`} className="border-b border-line/70 last:border-b-0">
                  <AccordionTrigger className="text-sm font-medium text-ink hover:text-brand">{item.q}</AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-mute">
                    {renderMarkdown(item.a, { onLink: openLink })}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-brand/25 bg-gradient-to-br from-brand/[0.07] to-transparent">
        <CardHeader>
          <CardTitle className="text-sm">{t('about.policyTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="max-w-3xl text-sm leading-relaxed text-mute">{t('about.policyBody')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate('/legal/privacy')}>
              {t('legal.tabPrivacy')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/legal/terms')}>
              {t('legal.tabTerms')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
