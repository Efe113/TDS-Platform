import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { ArrowRight, CalendarClock, Coins, PartyPopper, X } from 'lucide-react'
import {
  campaignCountdown,
  campaignHasDetail,
  campaignRuleBadge,
  formatRemaining,
  routeFromDeepLink,
  storageUrl,
  type ActiveCampaign
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { useCatalogLanguage } from '../../lib/catalog-labels'
import { SUPABASE_BASE_URL } from '../../lib/storage-base'
import { navigate } from '../../lib/router'
import { Button, cn } from '../../components/ui'
import { Chip } from '../../components/ui/system'

/**
 * The campaign band and its detail modal (0051).
 *
 * The band is the shortest honest sentence the app can make about money: what is running, until when,
 * and which rules pay differently right now. The numbers come from `active_campaigns()`, which builds
 * them with `app.campaign_overlay_for_rule()` — the same function `award_currency()` pays through — so
 * a band that says 80 is a band the ledger will honour.
 *
 * Two surfaces because two amounts of attention: `banner` sits above the content and waits to be
 * clicked, `modal` opens on its own for a launch the operator judged worth interrupting. Either way the
 * member can dismiss it, and a dismissed campaign stays dismissed until its dates change (see
 * `lib/dismissals.ts`), which is the only version of "don't show again" that survives an edit.
 *
 * Motion follows the rule the skin engine set: the accent glow breathes on `opacity`, nothing else in
 * this file animates, and the band never blurs the theme behind it.
 */

function accentStyle(accent: string | null): CSSProperties {
  if (accent === null) return {}
  // `accent` is `#rrggbb` on pain of a CHECK constraint, so the alpha suffixes below are safe.
  return {
    ['--campaign-accent' as string]: accent,
    borderColor: `${accent}59`,
    background: `linear-gradient(90deg, ${accent}1f, transparent 62%)`
  } as CSSProperties
}

function dateTime(value: string, locale: 'tr' | 'en'): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Date(parsed).toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** The one campaign that owns the band, with the copy already resolved to the member's language. */
export function campaignCopy(campaign: ActiveCampaign, language: 'tr' | 'en') {
  return {
    name: language === 'tr' ? campaign.nameTr : campaign.nameEn,
    desc: language === 'tr' ? campaign.descTr : campaign.descEn,
    body: (language === 'tr' ? campaign.bodyTr : campaign.bodyEn) ?? null,
    actionLabel: (language === 'tr' ? campaign.actionLabelTr : campaign.actionLabelEn) ?? null
  }
}

export function CampaignBand({
  campaign,
  onOpen,
  onDismiss
}: {
  campaign: ActiveCampaign
  onOpen: () => void
  onDismiss: () => void
}): ReactNode {
  const t = useT()
  const language = useCatalogLanguage() === 'en' ? 'en' : 'tr'
  const copy = campaignCopy(campaign, language)
  const countdown = campaignCountdown(campaign, Date.now())
  const upcoming = countdown.state === 'upcoming'
  const boosted = campaign.rules.filter((rule) => rule.multiplier !== 1 || rule.effectiveAmount !== rule.baseAmount)
  const first = boosted[0]

  return (
    <div
      className={cn(
        'campaign-band flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-brand/35 bg-brand/10 px-4 py-2',
        campaign.accent !== null && 'campaign-band--accent'
      )}
      style={campaign.accent !== null ? accentStyle(campaign.accent) : undefined}
    >
      <span className="flex items-center gap-2">
        <span className="campaign-glow size-1.5 shrink-0 rounded-full bg-brand" />
        <PartyPopper size={13} data-campaign-icon className="shrink-0 text-brand" />
        <span className="text-[12px] font-semibold text-ink">{copy.name}</span>
        <Chip tone={upcoming ? 'brand' : 'good'} icon={CalendarClock}>
          {t(upcoming ? 'campaign.upcoming' : 'campaign.live')}
        </Chip>
      </span>

      {first ? (
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-mute">
          <Coins size={11} className="shrink-0" />
          <span className="truncate">
            {language === 'tr' ? first.nameTr ?? first.code : first.nameEn ?? first.code}
          </span>
          <span className="hud-num shrink-0 text-brand">{campaignRuleBadge(first)}</span>
          {boosted.length > 1 ? <span className="shrink-0">+{String(boosted.length - 1)}</span> : null}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[11px] text-mute">{copy.desc}</span>
      )}

      <span className="ml-auto flex items-center gap-2">
        <span className="text-[11px] text-mute">
          {dateTime(campaign.startsAt, language)}
          <span className="mx-1 opacity-60">→</span>
          {dateTime(campaign.endsAt, language)}
        </span>
        {countdown.endsInMs !== null ? (
          <span className="text-[11px] font-semibold text-warn">{t('campaign.endsIn', { time: formatRemaining(countdown.endsInMs, language) })}</span>
        ) : countdown.startsInMs !== null ? (
          <span className="text-[11px] text-mute">{t('campaign.startsIn', { time: formatRemaining(countdown.startsInMs, language) })}</span>
        ) : null}

        {campaignHasDetail(campaign) ? (
          <Button size="sm" variant="ghost" onClick={onOpen}>
            {t('campaign.detail')}
            <ArrowRight size={12} />
          </Button>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('campaign.dismiss')}
          className="grid size-6 place-items-center rounded-md text-mute transition-colors hover:bg-panel hover:text-ink"
        >
          <X size={13} />
        </button>
      </span>
    </div>
  )
}

/**
 * The detail door: the long text, the image if the operator attached one, and the full earning sheet.
 * The sheet lists every rule the campaign touched, base amount first and effective amount second, so a
 * member can see the multiplier rather than take it on faith.
 */
export function CampaignModal({ campaign, onClose }: { campaign: ActiveCampaign; onClose: () => void }): ReactNode {
  const t = useT()
  const language = useCatalogLanguage() === 'en' ? 'en' : 'tr'
  const copy = campaignCopy(campaign, language)
  const countdown = campaignCountdown(campaign, Date.now())
  const imageUrl = campaign.imagePath !== null && SUPABASE_BASE_URL.length > 0
    ? storageUrl(SUPABASE_BASE_URL, campaign.imagePath)
    : null

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // A deep link stays inside the app; an https link is the only other thing the database may hold, and
  // it goes to the browser like every other external link in the app.
  const internal = campaign.actionUrl !== null && campaign.actionUrl.startsWith('tdsapp://')

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={copy.name}
      onClick={onClose}
      className="fixed inset-0 z-[80] grid place-items-center bg-black/78 p-6"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="hud-panel relative max-h-full w-full max-w-lg overflow-y-auto p-5"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="absolute right-3 top-3 grid size-7 place-items-center rounded-md text-mute transition-colors hover:bg-panel hover:text-ink"
        >
          <X size={14} />
        </button>

        <span className="hud-label flex items-center gap-1.5">
          <PartyPopper size={12} />
          {copy.name}
        </span>
        <p className="mt-1.5 pr-8 text-[15px] font-semibold leading-snug text-ink">{copy.desc}</p>

        {imageUrl !== null ? (
          <img src={imageUrl} alt="" loading="lazy" className="mt-3 w-full rounded-lg border border-line/70 object-cover" />
        ) : null}

        {copy.body !== null ? (
          <p className="mt-3 text-[12px] leading-relaxed whitespace-pre-line text-mute">{copy.body}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line/60 bg-base/50 px-2.5 py-2 text-[11px]">
          <Chip tone={countdown.state === 'upcoming' ? 'brand' : 'good'} icon={CalendarClock}>
            {t(countdown.state === 'upcoming' ? 'campaign.upcoming' : 'campaign.live')}
          </Chip>
          <span className="text-mute">
            {dateTime(campaign.startsAt, language)}
            <span className="mx-1 opacity-60">→</span>
            {dateTime(campaign.endsAt, language)}
          </span>
          {countdown.endsInMs !== null ? (
            <span className="font-semibold text-warn">{t('campaign.endsIn', { time: formatRemaining(countdown.endsInMs, language) })}</span>
          ) : null}
        </div>

        {campaign.rules.length > 0 ? (
          <div className="mt-4">
            <span className="hud-label flex items-center gap-1.5">
              <Coins size={12} />
              {t('campaign.rulesTitle')}
            </span>
            <ul className="mt-1.5 divide-y divide-line/50">
              {campaign.rules.map((rule) => {
                const badge = campaignRuleBadge(rule)
                const name = language === 'tr' ? rule.nameTr ?? rule.code : rule.nameEn ?? rule.code
                const note = language === 'tr' ? rule.noteTr : rule.noteEn
                return (
                  <li key={rule.code} className="flex items-center gap-2 py-1.5 text-[11px]">
                    <span className="min-w-0 flex-1 truncate text-ink/90">{name}</span>
                    {note !== null ? <span className="min-w-0 flex-1 truncate text-mute">{note}</span> : null}
                    {rule.multiplier !== 1 || rule.effectiveAmount !== rule.baseAmount ? (
                      <span className="hud-num shrink-0 text-mute line-through">{String(rule.baseAmount)}</span>
                    ) : null}
                    <span className="hud-num shrink-0 font-semibold text-brand">
                      {String(rule.effectiveAmount)}
                      {badge.length > 0 && badge !== String(rule.effectiveAmount) ? <span className="ml-1 text-mute">{badge}</span> : null}
                    </span>
                    {rule.own ? <Chip tone="brand">{t('campaign.ownRule')}</Chip> : null}
                  </li>
                )
              })}
            </ul>
            <p className="mt-2 text-[10px] leading-snug text-mute/80">{t('campaign.rulesFootnote')}</p>
          </div>
        ) : null}

        {campaign.actionUrl !== null ? (
          <div className="mt-4">
            {internal ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  // The same allowlist the OS link goes through, so a band cannot route somewhere the
                  // app would otherwise refuse.
                  const route = routeFromDeepLink(campaign.actionUrl)
                  onClose()
                  if (route !== null) navigate(route)
                }}
              >
                {copy.actionLabel ?? t('campaign.go')}
                <ArrowRight size={12} />
              </Button>
            ) : (
              <a
                href={campaign.actionUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand/45 bg-brand/12 px-3 py-1.5 text-[12px] font-semibold text-brand transition-colors hover:bg-brand/20"
              >
                {copy.actionLabel ?? t('campaign.go')}
                <ArrowRight size={12} />
              </a>
            )}
            <p className="mt-1.5 text-[10px] text-mute/80">{t('legal.openExternal')}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
