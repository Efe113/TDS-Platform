import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Building2, ArrowRight, Check, Frame as FrameIcon, Image as ImageIcon, Percent, ShieldCheck, Flame, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  ACCOUNT_LINKS_LIMIT,
  ACCOUNT_MESSAGE_LIMITS,
  CORPORATE_BENEFITS,
  CORPORATE_PERK_KEYS,
  CORPORATE_TITLE_REF,
  VERIFIED_BENEFITS,
  VERIFIED_PERK_KEYS,
  VERIFIED_TITLE_REF,
  accountMessageIsValid,
  type AccountRequest,
  type AccountRequestKind
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { navigate } from '../../lib/router'
import { fetchMyAccountRequests, submitAccountRequest, verificationErrorKey } from '../../lib/account-api'
import { fetchWallet } from '../../lib/wallet-api'
import { fetchShowcase } from '../../lib/profile-api'
import { showcaseQueryKey } from '../../lib/identity'
import { selectSignedIn, selectUserId, useAuth } from '../../store/auth-store'
import { VerifiedBadge } from '../../components/brand/verified-badge'
import { TitleBadge } from '../../components/brand/title-badge'
import { Banner, Button, Card, Field, INPUT_CLASS, cn } from '../../components/ui'
import { Chip, PageHeader, Section } from '../../components/ui/system'
import { StateEmpty, StateError, StateLoading } from '../../components/ui/states'
import { RevealItem, RevealList } from '../../motion/primitives/Reveal'

/**
 * The two staff-granted tiers share one application shape — a message, proof links, an optional
 * example strategy, a queue decision — so they share one page. `kind` only selects which copy, which
 * numbers and which pocket of credits to read; `account_requests` already stores both in one queue.
 */
interface TierCopy {
  kind: AccountRequestKind
  titleKey: MessageKey
  subtitleKey: MessageKey
  introKey: MessageKey
  applyTitleKey: MessageKey
  applyHintKey: MessageKey
  youAreKey: MessageKey
  notYetKey: MessageKey
  perkKeys: readonly string[]
  titleRef: string
  discountPercent: number
  discountEndedKey: MessageKey
  creditHintKey: MessageKey
}

const PERK_ICONS: Record<string, LucideIcon> = {
  'verified.perkBoost': Flame,
  'verified.perkTick': BadgeCheck,
  'verified.perkTitle': ShieldCheck,
  'verified.perkMark': Check,
  'verified.perkSort': TrendingUp,
  'verified.perkBanner': FrameIcon,
  'verified.perkDiscount': Percent,
  'corporate.perkTitle': Building2,
  'corporate.perkTick': BadgeCheck,
  'corporate.perkBrand': ImageIcon,
  'corporate.perkFrame': FrameIcon,
  'corporate.perkCredits': Flame,
  'corporate.perkDiscount': Percent,
  'corporate.perkSort': TrendingUp
}

const TIERS: Record<AccountRequestKind, TierCopy> = {
  verified: {
    kind: 'verified',
    titleKey: 'verified.title',
    subtitleKey: 'verified.subtitle',
    introKey: 'verified.intro',
    applyTitleKey: 'verified.applyTitle',
    applyHintKey: 'verified.applyHint',
    youAreKey: 'verified.youAre',
    notYetKey: 'verified.notYet',
    perkKeys: VERIFIED_PERK_KEYS,
    titleRef: VERIFIED_TITLE_REF,
    discountPercent: VERIFIED_BENEFITS.discountPercent,
    discountEndedKey: 'verified.discountEnded',
    creditHintKey: 'verified.creditHint'
  },
  corporate: {
    kind: 'corporate',
    titleKey: 'corporate.title',
    subtitleKey: 'corporate.subtitle',
    introKey: 'corporate.intro',
    applyTitleKey: 'corporate.applyTitle',
    applyHintKey: 'corporate.applyHint',
    youAreKey: 'corporate.youAre',
    notYetKey: 'corporate.notYet',
    perkKeys: CORPORATE_PERK_KEYS,
    titleRef: CORPORATE_TITLE_REF,
    discountPercent: CORPORATE_BENEFITS.discountPercent,
    discountEndedKey: 'corporate.discountEnded',
    creditHintKey: 'verified.creditHint'
  }
}

const STATUS_TONE: Record<AccountRequest['status'], 'warn' | 'good' | 'danger'> = {
  pending: 'warn',
  approved: 'good',
  rejected: 'danger'
}

function statusLabel(status: AccountRequest['status'], t: (key: MessageKey) => string): string {
  if (status === 'pending') return t('verified.statusPending')
  return status === 'approved' ? t('verified.statusApproved') : t('verified.statusRejected')
}

export function AccountRequestPage({ kind }: { kind: AccountRequestKind }): ReactNode {
  const t = useT()
  const copy = TIERS[kind]
  const corporate = kind === 'corporate'
  const queryClient = useQueryClient()
  const signedIn = useAuth(selectSignedIn)
  const userId = useAuth(selectUserId)

  const [message, setMessage] = useState('')
  const [links, setLinks] = useState('')
  const [strategyId, setStrategyId] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const walletQuery = useQuery({
    queryKey: ['wallet'],
    queryFn: fetchWallet,
    enabled: signedIn,
    staleTime: 30_000
  })

  const showcase = useQuery({
    queryKey: showcaseQueryKey(userId),
    queryFn: () => fetchShowcase(userId ?? ''),
    enabled: signedIn && userId !== null,
    staleTime: 30_000
  })

  const requestsQuery = useQuery({
    queryKey: ['account-requests'],
    queryFn: fetchMyAccountRequests,
    enabled: signedIn,
    staleTime: 15_000,
    retry: false
  })

  const requests = requestsQuery.data ?? []
  const openHere = requests.find((entry) => entry.kind === kind && entry.status === 'pending') ?? null
  const decidedHere = requests.filter((entry) => entry.kind === kind && entry.status !== 'pending')
  const ownStrategies = useMemo(
    () => (showcase.data?.strategies ?? []).map((entry) => ({ id: entry.id, name: entry.name })),
    [showcase.data]
  )

  const wallet = walletQuery.data
  // The tier flags come from the server: `verified` is true for a corporate account as well, so the
  // corporate page asks its own question instead of reading the superset field.
  const hasTier = corporate
    ? Boolean(wallet?.corporate) || showcase.data?.corporate === true
    : Boolean(wallet?.verified) || showcase.data?.verified === true
  const credits = wallet?.verifiedBoostCredits ?? showcase.data?.verifiedBoostCredits ?? 0
  const discountEndsAt = corporate ? (wallet?.corporateDiscountEndsAt ?? null) : (wallet?.verifiedDiscountEndsAt ?? null)

  const submit = useMutation({
    mutationFn: () =>
      submitAccountRequest({
        kind: copy.kind,
        message,
        links,
        strategyId: strategyId.length > 0 ? strategyId : null
      }),
    onSuccess: (result) => {
      setFailure(null)
      setNotice(result.replayed ? t('verified.replayed') : t('verified.submitted'))
      setMessage('')
      setLinks('')
      setStrategyId('')
      void queryClient.invalidateQueries({ queryKey: ['account-requests'] })
    },
    onError: (error: unknown) => {
      setNotice(null)
      setFailure(t(verificationErrorKey(error instanceof Error ? error.message : String(error))))
    }
  })

  const remaining = ACCOUNT_MESSAGE_LIMITS.max - message.trim().length
  const canSubmit = accountMessageIsValid(message) && !submit.isPending

  return (
    <div className="space-y-4">
      <PageHeader
        title={t(copy.titleKey)}
        subtitle={t(copy.subtitleKey)}
        badges={
          <>
            {/* The preview is the pitch: the live marks, painted by the same rules the tier grants. */}
            <VerifiedBadge show tier={corporate ? 'corporate' : 'verified'} label={t(tickLabel(kind))} />
            <TitleBadge label={t(copy.titleKey)} refCode={copy.titleRef} size="sm" />
          </>
        }
      />

      {!signedIn ? (
        <StateEmpty icon={corporate ? Building2 : ShieldCheck} title={t('verified.errAuth')} body={t(copy.introKey)} />
      ) : (
        <>
          <Section
            title={t('verified.status')}
            aside={
              hasTier ? (
                <Chip tone={corporate ? 'warn' : 'good'} icon={corporate ? Building2 : BadgeCheck}>
                  {t(copy.youAreKey)}
                </Chip>
              ) : (
                <Chip tone="neutral">{t(copy.notYetKey)}</Chip>
              )
            }
          >
            {hasTier ? (
              <RevealList count={1}>
                <RevealItem>
                  <Card className="space-y-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="hud-label">{t('verified.perkTitle')}</span>
                      <TitleBadge
                        label={showcase.data?.titleName ?? t(copy.titleKey)}
                        refCode={showcase.data?.titleKey ?? copy.titleRef}
                        size="sm"
                      />
                      {corporate ? <VerifiedBadge tier="corporate" label={t('discover.corporate')} size="sm" /> : null}
                    </div>
                    <p className="text-[12px] leading-relaxed text-mute">
                      {discountEndsAt
                        ? t('verified.discountActive', {
                            percent: String(copy.discountPercent),
                            date: new Date(discountEndsAt).toLocaleDateString()
                          })
                        : t(copy.discountEndedKey)}
                    </p>
                    <div className="flex items-center gap-2">
                      <Flame size={14} className="text-warn" />
                      <span className="text-[12px] font-semibold text-ink">
                        {credits > 0 ? t('verified.creditCount', { count: String(credits) }) : t('verified.creditNone')}
                      </span>
                      <span className="text-[11px] text-mute">{t(copy.creditHintKey)}</span>
                    </div>
                    {corporate ? <p className="text-[11px] text-mute/90">{t('corporate.isVerifiedToo')}</p> : null}
                  </Card>
                </RevealItem>
              </RevealList>
            ) : requestsQuery.isPending ? (
              <StateLoading />
            ) : requestsQuery.isError ? (
              <StateError detail={requestsQuery.error instanceof Error ? requestsQuery.error.message : String(requestsQuery.error)} onRetry={() => void requestsQuery.refetch()} />
            ) : openHere ? (
              <Banner tone="warn" title={t('verified.statusPending')}>
                {t('verified.submittedBody')}
              </Banner>
            ) : (
              <p className="text-[12px] leading-relaxed text-mute">{t(copy.introKey)}</p>
            )}

            {decidedHere.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {decidedHere.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line/60 bg-base/40 px-2 py-1.5 text-[11px]">
                    <Chip tone={STATUS_TONE[entry.status]}>{statusLabel(entry.status, t)}</Chip>
                    <span className="text-mute">{new Date(entry.createdAt).toLocaleDateString()}</span>
                    {entry.decisionNote ? <span className="min-w-0 flex-1 break-words text-ink/80">{entry.decisionNote}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>

          {notice ? <Banner tone="good" title={t('verified.submitted')}>{notice}</Banner> : null}
          {failure ? <Banner tone="danger" title={t('common.errorTitle')}>{failure}</Banner> : null}

          <Section title={t(copy.applyTitleKey)} hint={t(copy.applyHintKey)}>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
              <div className="space-y-3">
                <Field label={t('verified.fieldMessage')} hint={t('verified.messageCount', {
                  count: String(message.trim().length),
                  max: String(ACCOUNT_MESSAGE_LIMITS.max),
                  min: String(ACCOUNT_MESSAGE_LIMITS.min)
                })}>
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={5}
                    maxLength={ACCOUNT_MESSAGE_LIMITS.max}
                    placeholder={t('verified.messagePlaceholder')}
                    className={cn(INPUT_CLASS, 'w-full resize-y')}
                  />
                </Field>

                <Field label={t('verified.fieldLinks')} hint={t('verified.fieldLinksHint')}>
                  <textarea
                    value={links}
                    onChange={(event) => setLinks(event.target.value)}
                    rows={3}
                    maxLength={ACCOUNT_LINKS_LIMIT}
                    className={cn(INPUT_CLASS, 'w-full resize-y')}
                  />
                </Field>

                <Field label={t('verified.fieldStrategy')}>
                  <select value={strategyId} onChange={(event) => setStrategyId(event.target.value)} className={cn(INPUT_CLASS, 'w-full')}>
                    <option value="">{t('verified.fieldStrategyNone')}</option>
                    {ownStrategies.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" disabled={!canSubmit} busy={submit.isPending} onClick={() => submit.mutate()}>
                    {corporate ? <Building2 size={14} /> : <ShieldCheck size={14} />}
                    {submit.isPending ? t('verified.submitting') : t('verified.submit')}
                  </Button>
                  {openHere ? <span className="text-[11px] text-mute">{t('verified.replayed')}</span> : null}
                  {remaining < 0 ? <span className="text-[11px] text-danger">{t('verified.errShort')}</span> : null}
                </div>
              </div>

              {/* Perks as a stacked rail, so the value of the tier is legible before the form is filled. */}
              <ul className={cn('space-y-1.5 rounded-xl border border-line/60 bg-base/40 p-2', corporate && 'border-warn/40')}>
                {copy.perkKeys.map((key) => {
                  const Icon = PERK_ICONS[key] ?? BadgeCheck
                  return (
                    <li key={key} className="flex items-start gap-2 text-[11px] leading-relaxed text-mute">
                      <Icon size={13} className={cn('mt-0.5 shrink-0', corporate ? 'text-warn' : 'text-good')} />
                      <span className="min-w-0 break-words">{t(key as MessageKey)}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </Section>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line/60 bg-base/40 px-3 py-2">
            <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-mute">{t('verified.corporateSoon')}</p>
            <Button size="sm" variant="subtle" onClick={() => navigate(corporate ? '/verified' : '/corporate')}>
              {t(corporate ? 'verified.nav' : 'corporate.nav')}
              <ArrowRight size={12} />
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function tickLabel(kind: AccountRequestKind): MessageKey {
  return kind === 'corporate' ? 'discover.corporate' : 'discover.verified'
}

export function VerifiedPage(): ReactNode {
  return <AccountRequestPage kind="verified" />
}

export function CorporatePage(): ReactNode {
  return <AccountRequestPage kind="corporate" />
}
