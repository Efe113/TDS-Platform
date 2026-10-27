import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Megaphone, Plus, Trash2, Upload } from 'lucide-react'
import {
  NOTICE_CHIP_TONES,
  storageUrl,
  activeAnnouncementSchema,
  emptyNoticeDraft,
  noticeAdminToDraft,
  noticeDraftErrors,
  type AdminAnnouncement,
  type ActiveAnnouncement,
  type AnnouncementSeverity,
  type NoticeDraft,
  type NoticeSurface
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { useCatalogLanguage } from '../../lib/catalog-labels'
import { SUPABASE_BASE_URL } from '../../lib/storage-base'
import { Banner, Button, EmptyState, Field, INPUT_CLASS, Toggle, cn } from '../../components/ui'
import { Chip, Section, Segmented } from '../../components/ui/system'
import { StateLoading } from '../../components/ui/states'
import { ErrorBanner, fromLocalInput, toLocalInput } from './admin-ui'
import { NoticeBand } from '../shell/NoticeSurface'
import { deleteAnnouncement, fetchAnnouncements, saveAnnouncement, uploadNoticeImage } from './admin-api'

/**
 * The notice console (0052).
 *
 * Type and surface are two separate choices, and the form keeps them separate: `warn` says how loud the
 * sentence is, `modal` says how much of the screen it may take. Fourteen keys of copy exist because an
 * operator needs to see both knobs at once to pick them sensibly.
 *
 * The preview is the real band. The modal is previewed by the same component under the same heading, so
 * "this is what a member gets" is never a claim about a drawing.
 */

const SEVERITY_KEYS: Record<AnnouncementSeverity, MessageKey> = {
  info: 'admin.noticeSeverityInfo',
  warn: 'admin.noticeSeverityWarn',
  critical: 'admin.noticeSeverityCritical'
}

const STATE_KEYS: Record<AdminAnnouncement['state'], MessageKey> = {
  off: 'admin.noticeStateOff',
  upcoming: 'admin.noticeStateUpcoming',
  live: 'admin.noticeStateLive',
  ended: 'admin.noticeStateEnded'
}

/** The draft as the band's own row, so the preview cannot drift from what the RPC will store. */
function previewNotice(draft: NoticeDraft): ActiveAnnouncement {
  return activeAnnouncementSchema.parse({
    key: draft.key.trim().toLowerCase() || 'onizleme',
    severity: draft.severity,
    surface: draft.surface,
    titleTr: draft.titleTr,
    titleEn: draft.titleEn,
    shortTr: draft.shortTr,
    shortEn: draft.shortEn,
    bodyTr: draft.bodyTr,
    bodyEn: draft.bodyEn,
    imagePath: draft.imagePath,
    actionLabelTr: draft.actionLabelTr,
    actionLabelEn: draft.actionLabelEn,
    actionUrl: draft.actionUrl,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    updatedAt: new Date().toISOString(),
    ackRequired: draft.ackRequired,
    state: 'live',
    dismissed: false,
    readAt: null
  })
}

export function NoticeSection(): ReactNode {
  const t = useT()
  const language = useCatalogLanguage() === 'en' ? 'en' : 'tr'
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)

  const noticesQuery = useQuery({ queryKey: ['admin', 'announcements'], queryFn: fetchAnnouncements, retry: 1 })
  const [draft, setDraft] = useState<NoticeDraft | null>(null)
  const [isNew, setIsNew] = useState(true)

  const errors = useMemo(() => (draft === null ? [] : noticeDraftErrors(draft, Date.now())), [draft])

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] })
    void queryClient.invalidateQueries({ queryKey: ['notices'] })
  }

  const save = useMutation({
    mutationFn: (next: NoticeDraft) => saveAnnouncement({ ...next, key: next.key.trim().toLowerCase() }),
    onSuccess: () => {
      refresh()
      setDraft(null)
    }
  })

  const remove = useMutation({
    mutationFn: (key: string) => deleteAnnouncement(key),
    onSuccess: () => refresh()
  })

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (draft === null) throw new Error(t('admin.noticeKey'))
      return uploadNoticeImage(draft.key.trim().toLowerCase(), file)
    },
    onSuccess: (path) => setDraft((current) => (current === null ? current : { ...current, imagePath: path }))
  })

  if (noticesQuery.isPending) return <StateLoading variant="cards" count={2} />

  const notices = noticesQuery.data ?? []
  const patch = (next: Partial<NoticeDraft>): void => setDraft((current) => (current === null ? current : { ...current, ...next }))

  return (
    <div className="space-y-4">
      <Section
        title={t('admin.noticeTitle')}
        hint={t('admin.noticeHint')}
        aside={
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setIsNew(true)
              setDraft(emptyNoticeDraft())
            }}
          >
            <Plus size={12} />
            {t('admin.noticeNew')}
          </Button>
        }
      >
        {noticesQuery.isError ? <ErrorBanner error={noticesQuery.error} onRetry={() => void noticesQuery.refetch()} /> : null}
        {notices.length === 0 && !draft ? <EmptyState title={t('admin.noticeTitle')} body={t('admin.noticeNone')} /> : null}

        <ul className="divide-y divide-line/50">
          {notices.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 first:pt-0 last:pb-0">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Megaphone size={14} className="shrink-0 text-mute" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink">{language === 'tr' ? row.titleTr : row.titleEn}</span>
                  <span className="block truncate text-[11px] text-mute">{language === 'tr' ? row.shortTr : row.shortEn}</span>
                </span>
              </span>
              <Chip tone={NOTICE_CHIP_TONES[row.severity]}>{t(SEVERITY_KEYS[row.severity])}</Chip>
              <Chip tone="neutral">{t(row.surface === 'banner' ? 'admin.noticeSurfaceBanner' : 'admin.noticeSurfaceModal')}</Chip>
              {row.ackRequired ? <Chip tone="warn">{t('admin.noticeAck')}</Chip> : null}
              <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-mute">
                {t('admin.noticeReads', { count: String(row.readCount) })} · {t('admin.noticeDismisses', { count: String(row.dismissCount) })}
              </span>
              <Chip tone={row.state === 'live' ? 'good' : 'neutral'}>{t(STATE_KEYS[row.state])}</Chip>
              <span className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => {
                    setIsNew(false)
                    setDraft(noticeAdminToDraft(row))
                  }}
                >
                  {t('admin.noticeEdit')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  busy={remove.isPending && remove.variables === row.key}
                  onClick={() => {
                    if (window.confirm(t('admin.noticeDeleteConfirm'))) remove.mutate(row.key)
                  }}
                >
                  <Trash2 size={12} />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {draft === null ? null : (
        <>
          <Section title={t(isNew ? 'admin.noticeNew' : 'admin.noticeEdit')} hint={t('admin.noticeWindowHint')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('admin.noticeKey')} hint={t('admin.noticeKeyHint')}>
                <input
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={draft.key}
                  disabled={!isNew}
                  maxLength={48}
                  onChange={(event) => patch({ key: event.target.value })}
                />
              </Field>
              <Field label={t('admin.noticeEnabled')}>
                <Toggle checked={draft.enabled} onChange={(enabled) => patch({ enabled })} label={t('admin.noticeEnabled')} />
              </Field>

              <Field label={t('admin.noticeSeverity')} hint={t('admin.noticeSeverityHint')}>
                <Segmented<AnnouncementSeverity>
                  value={draft.severity}
                  onChange={(severity) => patch({ severity })}
                  options={(Object.keys(SEVERITY_KEYS) as AnnouncementSeverity[]).map((value) => ({ value, label: t(SEVERITY_KEYS[value]) }))}
                />
              </Field>
              <Field label={t('admin.noticeSurface')} hint={t('admin.noticeSurfaceHint')}>
                <Segmented<NoticeSurface>
                  value={draft.surface}
                  onChange={(surface) => patch({ surface })}
                  options={[
                    { value: 'banner', label: t('admin.noticeSurfaceBanner') },
                    { value: 'modal', label: t('admin.noticeSurfaceModal') }
                  ]}
                />
              </Field>

              <Field label={t('admin.noticeTitleTr')}>
                <input className={cn(INPUT_CLASS, 'w-full')} value={draft.titleTr} maxLength={80} onChange={(event) => patch({ titleTr: event.target.value })} />
              </Field>
              <Field label={t('admin.noticeTitleEn')}>
                <input className={cn(INPUT_CLASS, 'w-full')} value={draft.titleEn} maxLength={80} onChange={(event) => patch({ titleEn: event.target.value })} />
              </Field>

              <Field label={t('admin.noticeShortTr')}>
                <input className={cn(INPUT_CLASS, 'w-full')} value={draft.shortTr} maxLength={140} onChange={(event) => patch({ shortTr: event.target.value })} />
              </Field>
              <Field label={t('admin.noticeShortEn')}>
                <input className={cn(INPUT_CLASS, 'w-full')} value={draft.shortEn} maxLength={140} onChange={(event) => patch({ shortEn: event.target.value })} />
              </Field>

              <Field label={t('admin.noticeBodyTr')} hint={t('admin.noticeBodyHint')}>
                <textarea
                  className={cn(INPUT_CLASS, 'min-h-24 w-full resize-y')}
                  value={draft.bodyTr}
                  maxLength={2000}
                  onChange={(event) => patch({ bodyTr: event.target.value })}
                />
              </Field>
              <Field label={t('admin.noticeBodyEn')}>
                <textarea
                  className={cn(INPUT_CLASS, 'min-h-24 w-full resize-y')}
                  value={draft.bodyEn}
                  maxLength={2000}
                  onChange={(event) => patch({ bodyEn: event.target.value })}
                />
              </Field>

              <Field label={t('admin.noticeStart')}>
                <input
                  type="datetime-local"
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={toLocalInput(draft.startsAt.length > 0 ? draft.startsAt : null)}
                  onChange={(event) => patch({ startsAt: fromLocalInput(event.target.value) ?? '' })}
                />
              </Field>
              <Field label={t('admin.noticeEnd')}>
                <input
                  type="datetime-local"
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={toLocalInput(draft.endsAt.length > 0 ? draft.endsAt : null)}
                  onChange={(event) => patch({ endsAt: fromLocalInput(event.target.value) ?? '' })}
                />
              </Field>

              <Field label={t('admin.noticeImage')} hint={t('admin.noticeImageHint')}>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="subtle" busy={upload.isPending} onClick={() => fileInput.current?.click()}>
                    <Upload size={12} />
                    {t('admin.noticeImagePick')}
                  </Button>
                  {draft.imagePath !== null ? (
                    <img
                      src={storageUrl(SUPABASE_BASE_URL, draft.imagePath) ?? undefined}
                      alt=""
                      className="h-8 w-16 rounded-md border border-line/70 object-cover"
                    />
                  ) : null}
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file !== undefined) upload.mutate(file)
                      event.target.value = ''
                    }}
                  />
                </div>
              </Field>
              <Field label={t('admin.noticeAck')} hint={t('admin.noticeAckHint')}>
                <Toggle checked={draft.ackRequired} onChange={(ackRequired) => patch({ ackRequired })} label={t('admin.noticeAck')} />
              </Field>

              <Field label={t('admin.noticeActionTr')}>
                <input className={cn(INPUT_CLASS, 'w-full')} value={draft.actionLabelTr} maxLength={40} onChange={(event) => patch({ actionLabelTr: event.target.value })} />
              </Field>
              <Field label={t('admin.noticeActionEn')}>
                <input className={cn(INPUT_CLASS, 'w-full')} value={draft.actionLabelEn} maxLength={40} onChange={(event) => patch({ actionLabelEn: event.target.value })} />
              </Field>
              <Field label={t('admin.noticeActionUrl')} hint={t('admin.noticeActionHint')}>
                <input
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={draft.actionUrl}
                  maxLength={200}
                  placeholder="tdsapp://wallet"
                  onChange={(event) => patch({ actionUrl: event.target.value })}
                />
              </Field>
            </div>

            {errors.length > 0 ? (
              <Banner tone="warn" title={t('admin.noticeSave')}>
                <ul className="mt-1 space-y-0.5">
                  {errors.map((key) => (
                    <li key={key}>{t(key as MessageKey)}</li>
                  ))}
                </ul>
              </Banner>
            ) : null}

            {save.isError ? <ErrorBanner error={save.error} /> : null}
            {upload.isError ? <ErrorBanner error={upload.error} /> : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" busy={save.isPending} disabled={errors.length > 0} onClick={() => save.mutate(draft)}>
                {t('admin.noticeSave')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </Section>

          <Section title={t('admin.noticePreview')} hint={t('admin.noticePreviewBand')}>
            <div className="overflow-hidden rounded-xl border border-line/60 bg-base/40">
              <NoticeBand notice={previewNotice(draft)} onOpen={() => undefined} onDismiss={() => undefined} />
            </div>
          </Section>
        </>
      )}
    </div>
  )
}
