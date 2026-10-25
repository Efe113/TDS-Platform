import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Check, Frame as FrameIcon, Percent, ShieldCheck, Flame, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  ACCOUNT_LINKS_LIMIT,
  ACCOUNT_MESSAGE_LIMITS,
  VERIFIED_BENEFITS,
  VERIFIED_PERK_KEYS,
  VERIFIED_TITLE_REF,
  accountMessageIsValid,
  type AccountRequest
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
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

const PERK_ICONS: Record<string, LucideIcon> = {
  'verified.perkBoost': Flame,
  'verified.perkTick': BadgeCheck,
  'verified.perkTitle': ShieldCheck,
  'verified.perkMark': Check,
  'verified.perkSort': TrendingUp,
  'verified.perkBanner': FrameIcon,
  'verified.perkDiscount': Percent
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

export function VerifiedPage(): ReactNode {
  const t = useT()
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
  const openVerified = requests.find((entry) => entry.kind === 'verified' && entry.status === 'pending') ?? null
  const decidedVerified = requests.filter((entry) => entry.kind === 'verified' && entry.status !== 'pending')
  const ownStrategies = useMemo(
    () => (showcase.data?.strategies ?? []).map((entry) => ({ id: entry.id, name: entry.name })),
    [showcase.data]
  )

  const wallet = walletQuery.data
  const verified = Boolean(wallet?.verified) || showcase.data?.verified === true
  const credits = wallet?.verifiedBoostCredits ?? showcase.data?.verifiedBoostCredits ?? 0
  const discountEndsAt = wallet?.verifiedDiscountEndsAt ?? null

  const submit = useMutation({
    mutationFn: () =>
      submitAccountRequest({
        kind: 'verified',
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
        title={t('verified.title')}
        subtitle={t('verified.subtitle')}
        badges={
          <>
            {/* The preview is the pitch: the live marks, painted by the same rules the tier grants. */}
            <VerifiedBadge show label={t('discover.verified')} />
            <TitleBadge label={t('verified.title')} refCode={VERIFIED_TITLE_REF} size="sm" />
          </>
        }
      />

      {!signedIn ? (
        <StateEmpty icon={ShieldCheck} title={t('verified.errAuth')} body={t('verified.intro')} />
      ) : (
        <>
          <Section title={t('verified.status')} aside={verified ? <Chip tone="good" icon={BadgeCheck}>{t('verified.youAre')}</Chip> : <Chip tone="neutral">{t('verified.notYet')}</Chip>}>
            {verified ? (
              <RevealList count={3}>
                <RevealItem>
                  <Card className="space-y-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="hud-label">{t('verified.perkTitle')}</span>
                      <TitleBadge label={showcase.data?.titleName ?? t('verified.title')} refCode={showcase.data?.titleKey ?? VERIFIED_TITLE_REF} size="sm" />
                    </div>
                    <p className="text-[12px] leading-relaxed text-mute">
                      {discountEndsAt
                        ? t('verified.discountActive', {
                            percent: String(VERIFIED_BENEFITS.discountPercent),
                            date: new Date(discountEndsAt).toLocaleDateString()
                          })
                        : t('verified.discountEnded')}
                    </p>
                    <div className="flex items-center gap-2">
                      <Flame size={14} className="text-warn" />
                      <span className="text-[12px] font-semibold text-ink">
                        {credits > 0 ? t('verified.creditCount', { count: String(credits) }) : t('verified.creditNone')}
                      </span>
                      <span className="text-[11px] text-mute">{t('verified.creditHint')}</span>
                    </div>
                  </Card>
                </RevealItem>
              </RevealList>
            ) : requestsQuery.isPending ? (
              <StateLoading />
            ) : requestsQuery.isError ? (
              <StateError detail={requestsQuery.error instanceof Error ? requestsQuery.error.message : String(requestsQuery.error)} onRetry={() => void requestsQuery.refetch()} />
            ) : openVerified ? (
              <Banner tone="warn" title={t('verified.statusPending')}>
                {t('verified.submittedBody')}
              </Banner>
            ) : (
              <p className="text-[12px] leading-relaxed text-mute">{t('verified.intro')}</p>
            )}

            {decidedVerified.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {decidedVerified.map((entry) => (
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

          <Section title={t('verified.applyTitle')} hint={t('verified.applyHint')}>
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
                    <ShieldCheck size={14} />
                    {submit.isPending ? t('verified.submitting') : t('verified.submit')}
                  </Button>
                  {openVerified ? <span className="text-[11px] text-mute">{t('verified.replayed')}</span> : null}
                  {remaining < 0 ? <span className="text-[11px] text-danger">{t('verified.errShort')}</span> : null}
                </div>
              </div>

              {/* Perks as a stacked rail, so the value of the tier is legible before the form is filled. */}
              <ul className="space-y-1.5 rounded-xl border border-line/60 bg-base/40 p-2">
                {VERIFIED_PERK_KEYS.map((key) => {
                  const Icon = PERK_ICONS[key] ?? BadgeCheck
                  return (
                    <li key={key} className="flex items-start gap-2 text-[11px] leading-relaxed text-mute">
                      <Icon size={13} className="mt-0.5 shrink-0 text-good" />
                      <span className="min-w-0 break-words">{t(key as MessageKey)}</span>
                    </li>
                  )
                })}
                <li className="border-t border-line/50 pt-2 text-[10px] text-mute/80">{t('verified.corporateSoon')}</li>
              </ul>
            </div>
          </Section>
        </>
      )}
    </div>
  )
}
