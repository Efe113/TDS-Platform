import { useState } from 'react'
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
import {
  ABOUT_DOCUMENT,
  ABOUT_FAQ,
  IPC_CHANNELS,
  SUPPORT_EMAIL,
  text,
  type AppMeta
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { call } from '../../lib/ipc'
import { navigate } from '../../lib/router'
import { renderMarkdown } from '../../lib/markdown'
import { usePolicyLanguage } from '../../lib/policy-language'
import { openLink, PolicyDownloadButton, PolicyLanguageSwitch, PolicySectionCard, PolicyToc } from '../legal/PolicyReader'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion'
import { Chip } from '../../components/ui/system'
import { Logo } from '../../components/brand/logo'
import { Reveal, RevealItem, RevealList } from '../../motion/primitives/Reveal'

/** The stack, as chips. The prose in the document explains what each piece is for. */
const STACK: string[] = ['Electron', 'React 19', 'TypeScript', 'Tailwind v4', 'Supabase / RLS', 'koffi', 'i18next', 'Sentry', 'GitHub Releases']

/**
 * Icons are keyed by the section's machine id, not by a word in its title: the same page renders in two
 * languages now, and matching on "yapmaz" would have silently dropped the icon for English readers.
 */
const SECTION_ICONS: Record<string, LucideIcon> = {
  'what-it-does': FileText,
  capabilities: Sparkles,
  'what-it-never-does': ShieldCheck,
  'overlay-and-keys': Keyboard,
  economy: Coins,
  technology: Cpu,
  roadmap: Boxes,
  brands: Gamepad2,
  support: Mail
}

const TRUST_SECTIONS = new Set(['what-it-never-does'])

export function AboutPage(): ReactNode {
  const t = useT()
  const { language, explicit, choose } = usePolicyLanguage()
  const [openFaq, setOpenFaq] = useState<string | null>(null)

  const metaQuery = useQuery({
    queryKey: ['app', 'meta'],
    queryFn: () => call<AppMeta>(IPC_CHANNELS.appGetMeta),
    retry: false
  })

  const document = ABOUT_DOCUMENT

  return (
    <div className="space-y-6">
      <Reveal>
        <section className="relative overflow-hidden rounded-2xl border border-line bg-panel px-6 py-7">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.16]"
            style={{
              backgroundImage:
                'linear-gradient(to right, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)',
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
                <Chip tone="neutral">{text(document.title, language)}</Chip>
              </div>
              <p className="mt-1 text-xs uppercase tracking-widest text-mute/70">{t('about.kicker')}</p>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink/85">{t('about.pitch')}</p>
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-mute">{text(document.summary, language)}</p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1.5">
              {metaQuery.data ? (
                <>
                  <Badge variant="secondary" className="font-mono text-[10px]">v{metaQuery.data.version}</Badge>
                  <Badge variant="secondary" className="font-mono text-[10px]">Electron {metaQuery.data.electron}</Badge>
                  <Badge variant="secondary" className="font-mono text-[10px]">{metaQuery.data.platform}</Badge>
                </>
              ) : null}
              <span className="inline-flex items-center gap-1.5 text-[11px] text-mute">
                <Mail size={12} />
                <span className="select-text">{SUPPORT_EMAIL}</span>
              </span>
            </div>
          </div>

          <div className="relative mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <PolicyLanguageSwitch language={language} explicit={explicit} onChoose={choose} />
            <PolicyDownloadButton document={document} language={language} />
            <span className="ml-auto text-[11px] text-mute">{t('legal.langNote')}</span>
          </div>
        </section>
      </Reveal>

      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <PolicyToc sections={document.sections} language={language} anchorPrefix="about" />

        <div className="min-w-0 space-y-4">
          <RevealList className="grid gap-4 xl:grid-cols-2" count={Math.min(document.sections.length, 8)}>
            {document.sections.map((section, index) => (
              <div
                key={section.id}
                // The promise section carries a full row: it is the part a reader compares against a cheat.
                className={TRUST_SECTIONS.has(section.id) ? 'xl:col-span-2' : undefined}
              >
                <PolicySectionCard
                  section={section}
                  language={language}
                  anchorPrefix="about"
                  index={index}
                  icon={SECTION_ICONS[section.id]}
                  tone={TRUST_SECTIONS.has(section.id) ? 'trust' : 'default'}
                />
              </div>
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5 text-sm">
                <span className="flex size-8 items-center justify-center rounded-xl bg-brand/15 text-brand">
                  <Info size={16} />
                </span>
                {t('about.faqTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion
                type="single"
                collapsible
                value={openFaq ?? undefined}
                onValueChange={(value) => setOpenFaq(typeof value === 'string' && value.length > 0 ? value : null)}
                className="space-y-1"
              >
                {ABOUT_FAQ.map((entry, index) => (
                  <AccordionItem key={entry.q.tr} value={`faq-${String(index)}`} className="border-b border-line/70 last:border-b-0">
                    <AccordionTrigger className="text-sm font-medium text-ink hover:text-brand">{text(entry.q, language)}</AccordionTrigger>
                    <AccordionContent className="text-sm leading-relaxed text-mute">
                      {renderMarkdown(text(entry.a, language), { onLink: openLink })}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>

          <RevealItem>
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
          </RevealItem>
        </div>
      </div>
    </div>
  )
}
