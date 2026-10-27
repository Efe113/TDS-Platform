import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, PartyPopper, Plus, Trash2, Unlink, Upload } from 'lucide-react'
import {
  CAMPAIGN_MULTIPLIER_LIMITS,
  activeCampaignSchema,
  campaignAdminToDraft,
  campaignDraftErrors,
  emptyCampaignDraft,
  emptyCampaignRule,
  storageUrl,
  type CampaignAdminRow,
  type CampaignDraft,
  type CampaignRuleDraft,
  type CampaignSurface,
  type ActiveCampaign
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { useCatalogLanguage } from '../../lib/catalog-labels'
import { SUPABASE_BASE_URL } from '../../lib/storage-base'
import { Banner, Button, EmptyState, Field, INPUT_CLASS, Toggle, cn } from '../../components/ui'
import { Chip, Section, Segmented } from '../../components/ui/system'
import { StateLoading } from '../../components/ui/states'
import { ErrorBanner, fromLocalInput, toLocalInput } from './admin-ui'
import { CampaignBand } from '../shell/CampaignSurface'
import {
  deleteCampaign,
  fetchCampaigns,
  fetchCurrencyRules,
  saveCampaign,
  setCampaignRules,
  setRuleCampaign,
  uploadCampaignImage,
  type CurrencyRuleRow
} from './admin-api'

/**
 * The event console (0051).
 *
 * Two things had to be true for an operator to run a promotion without me: the dates are ordinary
 * inputs (`datetime-local`, converted on the way in and out by the same helpers maintenance uses), and
 * the earning sheet picks rules from a list instead of asking for a code. A campaign that has to be
 * typed into SQL is a campaign that only gets run by accident.
 *
 * The preview is the real band component fed by the draft, not a drawing of it. Multiplier and fixed
 * amount are both editable because they mean different promises — "twice what it normally pays" follows
 * a rule the economy editor later changes, "exactly 300" does not.
 */

/** Until the window opens, or while it runs: the band a member would be looking at right now. */
function ruleLabel(rule: CurrencyRuleRow, language: 'tr' | 'en'): string {
  const named = language === 'tr' ? rule.name_tr : rule.name_en
  if (named !== null && named !== undefined && named.trim().length > 0) return named
  return rule.code.replace(/_/g, ' ')
}

/**
 * The draft as an `ActiveCampaign`, so the preview is the component the member gets rather than a
 * drawing of it. The rules are resolved against the economy's own rows, because the number an operator
 * wants to check is `base → effective`, and only the server's rule knows the base.
 */
function previewCampaign(draft: CampaignDraft, rules: CurrencyRuleRow[]): ActiveCampaign {
  return activeCampaignSchema.parse({
    key: draft.key.trim().toLowerCase() || 'onizleme',
    nameTr: draft.nameTr,
    nameEn: draft.nameEn,
    descTr: draft.descTr,
    descEn: draft.descEn,
    bodyTr: draft.bodyTr,
    bodyEn: draft.bodyEn,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    surface: draft.surface,
    accent: draft.accent,
    imagePath: draft.imagePath,
    actionLabelTr: draft.actionLabelTr,
    actionLabelEn: draft.actionLabelEn,
    actionUrl: draft.actionUrl,
    state: 'live',
    rules: draft.rules
      .filter((entry) => entry.code.length > 0)
      .map((entry) => {
        const base = rules.find((rule) => rule.code === entry.code)
        return {
          code: entry.code,
          nameTr: base?.name_tr ?? null,
          nameEn: base?.name_en ?? null,
          kind: base?.kind ?? 'usage',
          unit: base?.unit ?? 'per_event',
          baseAmount: base?.amount ?? 0,
          effectiveAmount: entry.amountOverride ?? Math.ceil((base?.amount ?? 0) * entry.multiplier),
          multiplier: entry.multiplier,
          dailyCap: entry.dailyCapOverride,
          noteTr: entry.noteTr,
          noteEn: entry.noteEn,
          own: false
        }
      })
  })
}

function StateChip({ row }: { row: CampaignAdminRow }): ReactNode {
  const t = useT()
  const map: Record<CampaignAdminRow['state'], { tone: 'good' | 'brand' | 'neutral' | 'warn'; key: MessageKey }> = {
    live: { tone: 'good', key: 'admin.campaignStateLive' },
    upcoming: { tone: 'brand', key: 'admin.campaignStateUpcoming' },
    ended: { tone: 'neutral', key: 'admin.campaignStateEnded' },
    off: { tone: 'warn', key: 'admin.campaignStateOff' }
  }
  const entry = map[row.state]
  return (
    <Chip tone={entry.tone} icon={CalendarClock}>
      {t(entry.key)}
    </Chip>
  )
}

export function CampaignSection(): ReactNode {
  const t = useT()
  const language = useCatalogLanguage() === 'en' ? 'en' : 'tr'
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)

  const campaignsQuery = useQuery({ queryKey: ['admin', 'campaigns'], queryFn: fetchCampaigns, retry: 1 })
  const rulesQuery = useQuery({ queryKey: ['admin', 'currency-rules'], queryFn: fetchCurrencyRules, retry: 1 })
  const [draft, setDraft] = useState<CampaignDraft | null>(null)
  const [isNew, setIsNew] = useState(true)

  const rules = rulesQuery.data ?? []
  const errors = useMemo(() => (draft === null ? [] : campaignDraftErrors(draft, Date.now())), [draft])

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'campaigns'] })
    void queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    void queryClient.invalidateQueries({ queryKey: ['wallet'] })
  }

  // Text first, then the sheet: a campaign with no rules is a plain announcement, and a rule list
  // pointing at a campaign that failed to save would be an overlay nothing pays.
  const save = useMutation({
    mutationFn: async (next: CampaignDraft) => {
      const key = next.key.trim().toLowerCase()
      const state = await saveCampaign({ ...next, key })
      await setCampaignRules(key, next.rules)
      return { key, state }
    },
    onSuccess: () => {
      refresh()
      setDraft(null)
    }
  })

  const remove = useMutation({
    mutationFn: (key: string) => deleteCampaign(key),
    onSuccess: () => refresh()
  })

  const unbind = useMutation({
    mutationFn: (code: string) => setRuleCampaign(code, null),
    onSuccess: () => refresh()
  })

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (draft === null) throw new Error(t('admin.campaignKey'))
      return uploadCampaignImage(draft.key.trim().toLowerCase(), file)
    },
    onSuccess: (path) => setDraft((current) => (current === null ? current : { ...current, imagePath: path }))
  })

  if (campaignsQuery.isPending) return <StateLoading variant="cards" count={2} />

  const campaigns = campaignsQuery.data ?? []

  const startNew = (): void => {
    setIsNew(true)
    setDraft(emptyCampaignDraft())
  }

  const startEdit = (row: CampaignAdminRow): void => {
    setIsNew(false)
    setDraft(campaignAdminToDraft(row))
  }

  const patch = (next: Partial<CampaignDraft>): void => setDraft((current) => (current === null ? current : { ...current, ...next }))

  const patchRule = (index: number, next: Partial<CampaignRuleDraft>): void =>
    setDraft((current) => {
      if (current === null) return current
      const rulesList = [...current.rules]
      const entry = rulesList[index]
      if (entry === undefined) return current
      rulesList[index] = { ...entry, ...next }
      return { ...current, rules: rulesList }
    })

  return (
    <div className="space-y-4">
      <Section
        title={t('admin.campaignTitle')}
        hint={t('admin.campaignHint')}
        aside={
          <Button size="sm" variant="primary" onClick={startNew}>
            <Plus size={12} />
            {t('admin.campaignNew')}
          </Button>
        }
      >
        {campaignsQuery.isError ? <ErrorBanner error={campaignsQuery.error} onRetry={() => void campaignsQuery.refetch()} /> : null}
        {campaigns.length === 0 && !draft ? (
          <EmptyState title={t('admin.campaignTitle')} body={t('admin.campaignNone')} />
        ) : (
          <ul className="divide-y divide-line/50">
            {campaigns.map((row) => (
              <li key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 first:pt-0 last:pb-0">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <PartyPopper size={14} className="shrink-0 text-brand" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-ink">
                      {language === 'tr' ? row.nameTr : row.nameEn}
                    </span>
                    <span className="block truncate text-[11px] text-mute">
                      {language === 'tr' ? row.descTr : row.descEn}
                    </span>
                  </span>
                </span>
                <span className="hud-num shrink-0 text-[11px] text-mute">{row.key}</span>
                <Chip tone="neutral">{t(row.surface === 'banner' ? 'admin.campaignSurfaceBanner' : 'admin.campaignSurfaceModal')}</Chip>
                <span className="hud-num shrink-0 text-[11px] text-mute">{`${String(row.rules.length)}/${String(row.boundRules.length)}`}</span>
                <StateChip row={row} />
                <span className="flex shrink-0 items-center gap-1.5">
                  <Button size="sm" variant="subtle" onClick={() => startEdit(row)}>
                    {t('admin.campaignEdit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    busy={remove.isPending && remove.variables === row.key}
                    onClick={() => {
                      if (window.confirm(t('admin.campaignDeleteConfirm'))) remove.mutate(row.key)
                    }}
                  >
                    <Trash2 size={12} />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {draft === null ? null : (
        <>
          <Section title={t(isNew ? 'admin.campaignNew' : 'admin.campaignEdit')} hint={t('admin.campaignWindowHint')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('admin.campaignKey')} hint={t('admin.campaignKeyHint')}>
                <input
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={draft.key}
                  disabled={!isNew}
                  maxLength={48}
                  onChange={(event) => patch({ key: event.target.value })}
                />
              </Field>
              <Field label={t('admin.campaignSurface')} hint={t('admin.campaignSurfaceHint')}>
                <Segmented<CampaignSurface>
                  value={draft.surface}
                  onChange={(surface) => patch({ surface })}
                  options={[
                    { value: 'banner', label: t('admin.campaignSurfaceBanner') },
                    { value: 'modal', label: t('admin.campaignSurfaceModal') }
                  ]}
                />
              </Field>

              <Field label={t('admin.campaignNameTr')}>
                <input className={cn(INPUT_CLASS, 'w-full')} value={draft.nameTr} maxLength={80} onChange={(event) => patch({ nameTr: event.target.value })} />
              </Field>
              <Field label={t('admin.campaignNameEn')}>
                <input className={cn(INPUT_CLASS, 'w-full')} value={draft.nameEn} maxLength={80} onChange={(event) => patch({ nameEn: event.target.value })} />
              </Field>

              <Field label={t('admin.campaignDescTr')}>
                <input className={cn(INPUT_CLASS, 'w-full')} value={draft.descTr} maxLength={140} onChange={(event) => patch({ descTr: event.target.value })} />
              </Field>
              <Field label={t('admin.campaignDescEn')}>
                <input className={cn(INPUT_CLASS, 'w-full')} value={draft.descEn} maxLength={140} onChange={(event) => patch({ descEn: event.target.value })} />
              </Field>

              <Field label={t('admin.campaignBodyTr')} hint={t('admin.campaignBodyHint')}>
                <textarea
                  className={cn(INPUT_CLASS, 'min-h-20 w-full resize-y')}
                  value={draft.bodyTr}
                  maxLength={1200}
                  onChange={(event) => patch({ bodyTr: event.target.value })}
                />
              </Field>
              <Field label={t('admin.campaignBodyEn')}>
                <textarea
                  className={cn(INPUT_CLASS, 'min-h-20 w-full resize-y')}
                  value={draft.bodyEn}
                  maxLength={1200}
                  onChange={(event) => patch({ bodyEn: event.target.value })}
                />
              </Field>

              <Field label={t('admin.campaignStart')}>
                <input
                  type="datetime-local"
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={toLocalInput(draft.startsAt.length > 0 ? draft.startsAt : null)}
                  onChange={(event) => patch({ startsAt: fromLocalInput(event.target.value) ?? '' })}
                />
              </Field>
              <Field label={t('admin.campaignEnd')}>
                <input
                  type="datetime-local"
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={toLocalInput(draft.endsAt.length > 0 ? draft.endsAt : null)}
                  onChange={(event) => patch({ endsAt: fromLocalInput(event.target.value) ?? '' })}
                />
              </Field>

              <Field label={t('admin.campaignAccent')} hint={t('admin.campaignAccentHint')}>
                <div className="flex items-center gap-2">
                  <input
                    className={cn(INPUT_CLASS, 'w-32 font-mono')}
                    value={draft.accent}
                    maxLength={7}
                    placeholder="#f2c14e"
                    onChange={(event) => patch({ accent: event.target.value })}
                  />
                  <span
                    aria-hidden
                    className="size-6 shrink-0 rounded-md border border-line/70"
                    style={{ background: /^#[0-9a-fA-F]{6}$/.test(draft.accent.trim()) ? draft.accent.trim() : 'transparent' }}
                  />
                </div>
              </Field>
              <Field label={t('admin.campaignImage')} hint={t('admin.campaignImageHint')}>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="subtle" busy={upload.isPending} onClick={() => fileInput.current?.click()}>
                    <Upload size={12} />
                    {t('admin.campaignImagePick')}
                  </Button>
                  {draft.imagePath !== null && SUPABASE_BASE_URL.length > 0 ? (
                    <img src={storageUrl(SUPABASE_BASE_URL, draft.imagePath) ?? undefined} alt="" className="h-8 w-16 rounded-md border border-line/70 object-cover" />
                  ) : (
                    <span className="text-[11px] text-mute">{t('admin.campaignImage')}</span>
                  )}
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

              <Field label={t('admin.campaignActionTr')}>
                <input className={cn(INPUT_CLASS, 'w-full')} value={draft.actionLabelTr} maxLength={40} onChange={(event) => patch({ actionLabelTr: event.target.value })} />
              </Field>
              <Field label={t('admin.campaignActionEn')}>
                <input className={cn(INPUT_CLASS, 'w-full')} value={draft.actionLabelEn} maxLength={40} onChange={(event) => patch({ actionLabelEn: event.target.value })} />
              </Field>
              <Field label={t('admin.campaignActionUrl')} hint={t('admin.campaignActionHint')}>
                <input
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={draft.actionUrl}
                  maxLength={200}
                  placeholder="tdsapp://market"
                  onChange={(event) => patch({ actionUrl: event.target.value })}
                />
              </Field>
              <Field label={t('admin.campaignEnabled')}>
                <Toggle checked={draft.enabled} onChange={(enabled) => patch({ enabled })} label={t('admin.campaignEnabled')} />
              </Field>
            </div>

            {errors.length > 0 ? (
              <Banner tone="warn" title={t('admin.campaignSave')}>
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
              <Button
                size="sm"
                variant="primary"
                busy={save.isPending}
                disabled={errors.length > 0}
                onClick={() => save.mutate(draft)}
              >
                {t('admin.campaignSave')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </Button>
              <span className="text-[10px] leading-snug text-mute/80">{t('admin.campaignWindowHint')}</span>
            </div>
          </Section>

          <Section title={t('admin.campaignRules')} hint={t('admin.campaignRulesHint')}>
            {rulesQuery.isPending ? (
              <StateLoading variant="rows" count={2} />
            ) : (
              <div className="space-y-2.5">
                {draft.rules.map((entry, index) => {
                  const base = rules.find((rule) => rule.code === entry.code)
                  const taken = draft.rules.filter((other) => other.code.length > 0).map((other) => other.code)
                  return (
                    <div key={`${entry.code}-${String(index)}`} className="hud-panel p-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="min-w-40 flex-1 space-y-1">
                          <span className="hud-label block">{t('admin.campaignRule')}</span>
                          <select
                            className={cn(INPUT_CLASS, 'w-full')}
                            value={entry.code}
                            onChange={(event) => patchRule(index, { code: event.target.value })}
                          >
                            <option value="">—</option>
                            {rules
                              .filter((rule) => taken.includes(rule.code) || rule.enabled)
                              .map((rule) => (
                                <option key={rule.code} value={rule.code}>
                                  {`${ruleLabel(rule, language)} · ${rule.code}`}
                                </option>
                              ))}
                          </select>
                        </label>

                        <label className="w-24 space-y-1">
                          <span className="hud-label block">{t('admin.campaignRuleMultiplier')}</span>
                          <input
                            type="number"
                            step="0.1"
                            min={CAMPAIGN_MULTIPLIER_LIMITS.min}
                            max={CAMPAIGN_MULTIPLIER_LIMITS.max}
                            className={cn(INPUT_CLASS, 'w-full')}
                            value={entry.multiplier}
                            onChange={(event) => patchRule(index, { multiplier: Number(event.target.value) })}
                          />
                        </label>

                        <label className="w-28 space-y-1">
                          <span className="hud-label block">{t('admin.campaignRuleAmount')}</span>
                          <input
                            type="number"
                            min="1"
                            className={cn(INPUT_CLASS, 'w-full')}
                            placeholder={t('admin.campaignRuleAmountHint')}
                            value={entry.amountOverride ?? ''}
                            onChange={(event) => patchRule(index, { amountOverride: event.target.value.trim().length === 0 ? null : Number(event.target.value) })}
                          />
                        </label>

                        <label className="w-28 space-y-1">
                          <span className="hud-label block">{t('admin.campaignRuleCap')}</span>
                          <input
                            type="number"
                            min="0"
                            className={cn(INPUT_CLASS, 'w-full')}
                            value={entry.dailyCapOverride ?? ''}
                            onChange={(event) => patchRule(index, { dailyCapOverride: event.target.value.trim().length === 0 ? null : Number(event.target.value) })}
                          />
                        </label>

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setDraft((current) =>
                              current === null ? current : { ...current, rules: current.rules.filter((_, at) => at !== index) }
                            )
                          }
                        >
                          <Trash2 size={12} />
                          {t('admin.campaignRuleRemove')}
                        </Button>
                      </div>

                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <input
                          className={cn(INPUT_CLASS, 'w-full')}
                          placeholder={t('admin.campaignRuleNoteTr')}
                          value={entry.noteTr}
                          maxLength={80}
                          onChange={(event) => patchRule(index, { noteTr: event.target.value })}
                        />
                        <input
                          className={cn(INPUT_CLASS, 'w-full')}
                          placeholder={t('admin.campaignRuleNoteEn')}
                          value={entry.noteEn}
                          maxLength={80}
                          onChange={(event) => patchRule(index, { noteEn: event.target.value })}
                        />
                      </div>

                      {base ? (
                        <p className="mt-2 text-[10px] text-mute">
                          {`${String(base.amount)} → ${String(entry.amountOverride ?? Math.ceil(base.amount * entry.multiplier))}`}
                          {base.daily_cap !== null ? ` · ${t('wallet.dailyCap')}: ${String(entry.dailyCapOverride ?? base.daily_cap)}` : ''}
                        </p>
                      ) : null}
                    </div>
                  )
                })}

                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => setDraft((current) => (current === null ? current : { ...current, rules: [...current.rules, emptyCampaignRule('')] }))}
                >
                  <Plus size={12} />
                  {t('admin.campaignRuleAdd')}
                </Button>
              </div>
            )}

            {!isNew ? (
              <BoundRules
                row={campaigns.find((entry) => entry.key === draft.key.trim().toLowerCase()) ?? null}
                busy={unbind.isPending}
                onUnbind={(code) => unbind.mutate(code)}
              />
            ) : null}
          </Section>

          <Section title={t('admin.campaignPreview')} hint={t('admin.campaignPreviewBand')}>
            <div className="overflow-hidden rounded-xl border border-line/60 bg-base/40">
              <CampaignBand
                campaign={previewCampaign(draft, rules)}
                onOpen={() => undefined}
                onDismiss={() => undefined}
              />
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-mute">{t('admin.campaignSurfaceHint')}</p>
          </Section>
        </>
      )}
    </div>
  )
}

/** Rules minted for this campaign: they exist only inside its window, and the list says so. */
function BoundRules({ row, busy, onUnbind }: { row: CampaignAdminRow | null; busy: boolean; onUnbind: (code: string) => void }): ReactNode {
  const t = useT()
  const language = useCatalogLanguage() === 'en' ? 'en' : 'tr'
  if (row === null || row.boundRules.length === 0) return null
  return (
    <div className="mt-3 rounded-lg border border-line/60 bg-base/40 p-3">
      <p className="hud-label">{t('admin.campaignBound')}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-mute">{t('admin.campaignBoundHint')}</p>
      <ul className="mt-2 space-y-1">
        {row.boundRules.map((rule) => (
          <li key={rule.code} className="flex items-center gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate text-ink/90">{(language === 'tr' ? rule.nameTr : rule.nameEn) ?? rule.code}</span>
            <span className="hud-num text-mute">{rule.code}</span>
            {rule.enabled ? null : <Chip tone="neutral">{t('admin.campaignStateOff')}</Chip>}
            <Button size="sm" variant="ghost" busy={busy} onClick={() => onUnbind(rule.code)}>
              <Unlink size={12} />
              {t('admin.campaignUnbind')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
