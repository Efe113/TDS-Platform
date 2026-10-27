import { useEffect, type ReactNode } from 'react'
import { AlertOctagon, ArrowRight, Info, Megaphone, TriangleAlert, X } from 'lucide-react'
import { NOTICE_CHIP_TONES, NOTICE_TONES, noticeStateOf, routeFromDeepLink, storageUrl, type ActiveAnnouncement } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { useCatalogLanguage } from '../../lib/catalog-labels'
import { SUPABASE_BASE_URL } from '../../lib/storage-base'
import { navigate } from '../../lib/router'
import { Button, cn } from '../../components/ui'
import { Chip } from '../../components/ui/system'

/**
 * The notice band and its modal (0052).
 *
 * A band carries a type, one sentence and a door; a modal carries a picture and the story. Same data,
 * two attention budgets, and the operator picks which one the day deserves — which is why the editor
 * refuses a modal with neither a long text nor an image.
 *
 * `critical` + `ackRequired` is the only case where the corner cross is missing. Closing a thing you
 * were told you had to see is not closing it, and the difference is one boolean the operator sets rather
 * than a rule the app invents here.
 *
 * The dot breathes on opacity only. A notice repaints nothing, even though the heaviest ones sit over a
 * window that is already animating a skin.
 */

const SEVERITY_KEYS: Record<ActiveAnnouncement['severity'], { labelKey: MessageKey; icon: typeof Info }> = {
  info: { labelKey: 'notice.info', icon: Info },
  warn: { labelKey: 'notice.warn', icon: TriangleAlert },
  critical: { labelKey: 'notice.critical', icon: AlertOctagon }
}

function title(value: string | null): string | null {
  return value !== null && value.trim().length > 0 ? value : null
}

function noticeCopy(notice: ActiveAnnouncement, language: 'tr' | 'en') {
  return {
    heading: language === 'tr' ? notice.titleTr : notice.titleEn,
    line: language === 'tr' ? notice.shortTr : notice.shortEn,
    body: title(language === 'tr' ? notice.bodyTr : notice.bodyEn),
    actionLabel: title(language === 'tr' ? notice.actionLabelTr : notice.actionLabelEn)
  }
}

function UntilDate({ notice }: { notice: ActiveAnnouncement }): ReactNode {
  const t = useT()
  const language = useCatalogLanguage() === 'en' ? 'en' : 'tr'
  const state = noticeStateOf(notice, Date.now())
  const at = new Date(state === 'upcoming' ? notice.startsAt : notice.endsAt)
  if (Number.isNaN(at.getTime())) return null
  return (
    <span className="text-[11px] text-mute">
      {t(state === 'upcoming' ? 'notice.starts' : 'notice.until', {
        time: at.toLocaleString(language === 'tr' ? 'tr-TR' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      })}
    </span>
  )
}

export function NoticeBand({
  notice,
  onOpen,
  onDismiss
}: {
  notice: ActiveAnnouncement
  onOpen: () => void
  onDismiss: () => void
}): ReactNode {
  const t = useT()
  const language = useCatalogLanguage() === 'en' ? 'en' : 'tr'
  const copy = noticeCopy(notice, language)
  const severity = SEVERITY_KEYS[notice.severity]
  const Icon = severity.icon
  const tone = NOTICE_TONES[notice.severity]
  const hasDetail = copy.body !== null || notice.imagePath !== null

  return (
    <div
      className={cn(
        'notice-band flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2',
        tone === 'danger' && 'notice-band--critical border-danger/45 bg-danger/12',
        tone === 'warn' && 'border-warn/40 bg-warn/10',
        tone === 'info' && 'border-brand/35 bg-brand/10'
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className={cn(
            'notice-glow size-1.5 shrink-0 rounded-full',
            tone === 'danger' && 'bg-danger',
            tone === 'warn' && 'bg-warn',
            tone === 'info' && 'bg-brand'
          )}
        />
        <Icon size={13} className="shrink-0" />
        <span className="text-[12px] font-semibold text-ink">{copy.heading}</span>
        <Chip tone={NOTICE_CHIP_TONES[notice.severity]}>{t(severity.labelKey)}</Chip>
      </span>

      <span className="min-w-0 flex-1 truncate text-[11px] text-mute">{copy.line}</span>

      <span className="ml-auto flex items-center gap-2">
        <UntilDate notice={notice} />
        {hasDetail ? (
          <Button size="sm" variant="ghost" onClick={onOpen}>
            {t('notice.detail')}
            <ArrowRight size={12} />
          </Button>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('notice.dismiss')}
          className="grid size-6 place-items-center rounded-md text-mute transition-colors hover:bg-panel hover:text-ink"
        >
          <X size={13} />
        </button>
      </span>
    </div>
  )
}

export function NoticeModal({
  notice,
  onAck,
  onClose
}: {
  notice: ActiveAnnouncement
  /** The acknowledgement: recorded as `read`, and the only way out of an ack-required notice. */
  onAck: () => void
  /** The corner cross: only rendered when the notice is not one that must be acknowledged. */
  onClose: () => void
}): ReactNode {
  const t = useT()
  const language = useCatalogLanguage() === 'en' ? 'en' : 'tr'
  const copy = noticeCopy(notice, language)
  const severity = SEVERITY_KEYS[notice.severity]
  const Icon = severity.icon
  const tone = NOTICE_TONES[notice.severity]
  const imageUrl = notice.imagePath !== null && SUPABASE_BASE_URL.length > 0
    ? storageUrl(SUPABASE_BASE_URL, notice.imagePath)
    : null
  const internal = notice.actionUrl !== null && notice.actionUrl.startsWith('tdsapp://')

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // An ack-required notice answers to Escape the same way it answers to the button: the member read
      // it, and there is no other meaning for "close" when the operator asked for an acknowledgement.
      if (event.key === 'Escape') onAck()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onAck])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={copy.heading}
      onClick={notice.ackRequired ? undefined : onClose}
      className="fixed inset-0 z-[82] grid place-items-center bg-black/80 p-6"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="hud-panel relative max-h-full w-full max-w-lg overflow-y-auto p-5"
      >
        {!notice.ackRequired ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('notice.dismiss')}
            className="absolute right-3 top-3 grid size-7 place-items-center rounded-md text-mute transition-colors hover:bg-panel hover:text-ink"
          >
            <X size={14} />
          </button>
        ) : null}

        <span className="hud-label flex items-center gap-1.5">
          {notice.severity === 'info' ? <Megaphone size={12} /> : <Icon size={12} />}
          {copy.heading}
          <Chip tone={NOTICE_CHIP_TONES[notice.severity]}>{t(severity.labelKey)}</Chip>
        </span>

        <p className="mt-2 pr-8 text-[15px] font-semibold leading-snug text-ink">{copy.line}</p>

        {imageUrl !== null ? (
          <img src={imageUrl ?? undefined} alt="" loading="lazy" className="mt-3 w-full rounded-lg border border-line/70 object-cover" />
        ) : null}

        {copy.body !== null ? (
          <p className="mt-3 text-[12px] leading-relaxed whitespace-pre-line text-mute">{copy.body}</p>
        ) : null}

        <div className="mt-3 flex items-center gap-2 text-[11px] text-mute">
          <UntilDate notice={notice} />
          <span className="hud-num">{noticeStateOf(notice, Date.now()) === 'upcoming' ? t('notice.upcoming') : t('notice.liveNow')}</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onAck}>
            {t(notice.ackRequired ? 'notice.acknowledge' : 'notice.gotIt')}
          </Button>
          {notice.actionUrl !== null ? (
            internal ? (
              <Button
                size="sm"
                variant="subtle"
                onClick={() => {
                  const route = routeFromDeepLink(notice.actionUrl)
                  onAck()
                  if (route !== null) navigate(route)
                }}
              >
                {copy.actionLabel ?? t('notice.go')}
                <ArrowRight size={12} />
              </Button>
            ) : (
              <a
                href={notice.actionUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand/45 bg-brand/12 px-3 py-1.5 text-[12px] font-semibold text-brand transition-colors hover:bg-brand/20"
              >
                {copy.actionLabel ?? t('notice.go')}
                <ArrowRight size={12} />
              </a>
            )
          ) : null}
          {notice.ackRequired ? (
            <span className="text-[10px] leading-snug text-mute/80">{t('notice.ackNote')}</span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
