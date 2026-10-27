import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, FileText, Scale, ShieldCheck, Trash2 } from 'lucide-react'
import {
  DEFAULT_POLICY_DOCUMENT,
  IPC_CHANNELS,
  POLICY_DOCUMENTS,
  POLICY_VERSION,
  policyDocument,
  text,
  type AppMeta,
  type PolicyKind
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { call } from '../../lib/ipc'
import { navigate, routeSegments, useRoutePath } from '../../lib/router'
import { usePolicyLanguage } from '../../lib/policy-language'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent } from '../../components/ui/card'
import { Chip, Segmented } from '../../components/ui/system'
import { Reveal, RevealItem, RevealList } from '../../motion/primitives/Reveal'
import {
  PolicyDocumentHeader,
  PolicyDownloadButton,
  PolicyLanguageSwitch,
  PolicySectionList,
  PolicyToc
} from './PolicyReader'

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

export function LegalPage(): ReactNode {
  const t = useT()
  const { language, explicit, choose } = usePolicyLanguage()
  const path = useRoutePath()
  const selected = routeSegments(path)[1]
  const activeKind: PolicyKind = isPolicyKind(selected) ? selected : DEFAULT_POLICY_DOCUMENT.kind
  const active = policyDocument(activeKind)
  const facts = activeKind === 'privacy' ? PRIVACY_FACTS : TERMS_FACTS

  const metaQuery = useQuery({
    queryKey: ['app', 'meta'],
    queryFn: () => call<AppMeta>(IPC_CHANNELS.appGetMeta),
    retry: false
  })
  const version = metaQuery.data?.policyVersion ?? POLICY_VERSION

  return (
    <div className="space-y-5">
      <Reveal>
        <PolicyDocumentHeader
          document={active}
          language={language}
          version={version}
          kicker={
            <Chip tone={activeKind === 'privacy' ? 'brand' : 'neutral'}>
              {activeKind === 'privacy' ? t('legal.kindPrivacy') : t('legal.kindTerms')}
            </Chip>
          }
          actions={
            <>
              <Segmented
                size="sm"
                value={activeKind}
                onChange={(next) => navigate(`/legal/${next}`)}
                options={POLICY_DOCUMENTS.map((document, index) => ({
                  value: document.kind,
                  label: text(document.title, language),
                  icon: index === 0 ? ShieldCheck : Scale
                }))}
              />
              <span className="ml-auto flex items-center gap-2">
                <PolicyLanguageSwitch language={language} explicit={explicit} onChoose={choose} />
                <PolicyDownloadButton document={active} language={language} />
              </span>
            </>
          }
        />
      </Reveal>

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

      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <PolicyToc sections={active.sections} language={language} anchorPrefix={activeKind} />

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Badge variant="outline" className="border-line text-[10px] font-medium tracking-wide text-mute">
              {t('legal.reading', { count: active.sections.length })}
            </Badge>
            <span className="text-[11px] text-mute">{t('legal.langNote')}</span>
          </div>

          <PolicySectionList sections={active.sections} language={language} anchorPrefix={activeKind} />

          <p className="border-t border-line pt-4 text-[11px] leading-relaxed text-mute">
            {t('legal.reconsentNote', { version })}
          </p>
        </div>
      </div>
    </div>
  )
}
