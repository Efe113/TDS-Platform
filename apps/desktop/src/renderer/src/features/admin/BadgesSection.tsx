import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Award, Pencil, Plus, Save, Sparkles, Trash2, Upload, X } from 'lucide-react'

import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { BadgeGlyph } from '../../components/brand/badge-glyph'
import { Badge, Button, INPUT_CLASS, Row, cn } from '../../components/ui'
import { Chip, Metric, MetricGrid, Section } from '../../components/ui/system'
import { StateEmpty, StateError, StateLoading } from '../../components/ui/states'
import { CoinAmount } from '../../components/brand/coin'
import {
  deleteBadgeDefinition,
  fetchBadgeDefinitions,
  fetchBadgeMetrics,
  saveBadgeDefinition,
  uploadBadgeImage,
  type BadgeDefinitionRow
} from './admin-api'
import {
  BADGE_METRICS,
  CRITERION_GROUPS,
  DEFAULT_CRITERION_OPS,
  criteriaSentence,
  humanMetric,
  humanOp,
  isCriterionComplete,
  readCriteria,
  writeCriteria,
  type CriterionGroup,
  type CriterionRow
} from '../../lib/badge-criteria'

/**
 * Badges, with names instead of machine keys.
 *
 * The stored conditions are `{ all_of: [{ metric, op, value }] }` - correct for the engine and opaque
 * for the person editing it. Every metric and operator now carries a translated label plus the
 * engine's own description, so the editor reads like a sentence ("Nitelikli koşu en az 10 VE
 * Tamamlanan adım en az 40"). The sentence builder is the same one the member's catalogue page uses, so
 * what an admin types and what a member reads come from one place. The JSON stays available read-only
 * for debugging, never as the input.
 */

const TIER_LABEL: Record<string, MessageKey> = {
  bronze: 'profile.tierBronze',
  silver: 'profile.tierSilver',
  gold: 'profile.tierGold',
  special: 'profile.tierSpecial'
}

const GROUP_LABEL: Record<CriterionGroup, string> = {
  all_of: 'Hepsi (VE)',
  any_of: 'Herhangi biri (VEYA)'
}

interface Draft {
  code: string
  nameTr: string
  nameEn: string
  descTr: string
  tier: BadgeDefinitionRow['tier']
  awardMode: BadgeDefinitionRow['award_mode']
  reward: string
  iconPath: string
  active: boolean
  rows: CriterionRow[]
}

function toDraft(badge: BadgeDefinitionRow): Draft {
  return {
    code: badge.code,
    nameTr: badge.name_tr,
    nameEn: badge.name_en ?? '',
    descTr: badge.desc_tr ?? '',
    tier: badge.tier,
    awardMode: badge.award_mode,
    reward: String(badge.currency_reward),
    iconPath: badge.icon_path ?? '',
    active: badge.active,
    rows: readCriteria(badge.conditions) ?? []
  }
}

export function BadgesSection(): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const badgesQuery = useQuery({ queryKey: ['admin', 'badge-defs'], queryFn: fetchBadgeDefinitions, retry: 1 })
  const metricsQuery = useQuery({ queryKey: ['admin', 'badge-metrics'], queryFn: fetchBadgeMetrics, retry: 1 })

  const save = useMutation({
    mutationFn: async (input: Draft) => {
      const reward = Number.parseInt(input.reward, 10)
      await saveBadgeDefinition({
        code: input.code,
        name_tr: input.nameTr.trim(),
        name_en: input.nameEn.trim() || null,
        desc_tr: input.descTr.trim() || null,
        icon_path: input.iconPath.trim() || null,
        tier: input.tier,
        award_mode: input.awardMode,
        currency_reward: Number.isNaN(reward) ? 0 : reward,
        conditions: writeCriteria(input.rows.filter(isCriterionComplete)),
        active: input.active
      })
    },
    onSuccess: () => {
      setFailure(null)
      setDraft(null)
      setIsNew(false)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'badge-defs'] })
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const remove = useMutation({
    mutationFn: (code: string) => deleteBadgeDefinition(code),
    onSuccess: () => {
      setFailure(null)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'badge-defs'] })
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  // Badge art: uploaded into the same public bucket as catalog imagery, stored as an object path so the
  // admin can also paste a full https URL instead.
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const code = (draft?.code ?? '').trim().toLocaleLowerCase()
      if (code.length < 2) throw new Error('CODE_REQUIRED')
      return uploadBadgeImage(code, file)
    },
    onSuccess: (path) => setDraft((current) => (current ? { ...current, iconPath: path } : current)),
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const badges = badgesQuery.data ?? []
  const metrics = metricsQuery.data ?? []
  const metricOptions = useMemo(() => (metrics.length > 0 ? metrics.map((metric) => metric.metric) : [...BADGE_METRICS]), [metrics])
  // The engine can only read the operators badge_metrics lists, so the editor offers nothing else.
  const operatorsFor = useMemo(() => {
    const index = new Map(metrics.map((metric) => [metric.metric, metric.operators] as [string, string[]]))
    return (metric: string): string[] => index.get(metric) ?? [...DEFAULT_CRITERION_OPS]
  }, [metrics])

  const totals = useMemo(
    () => ({
      total: badges.length,
      active: badges.filter((badge) => badge.active).length,
      auto: badges.filter((badge) => badge.award_mode === 'auto').length,
      reward: badges.reduce((sum, badge) => sum + badge.currency_reward, 0)
    }),
    [badges]
  )

  const validation = useMemo(() => {
    if (!draft) return null
    if (draft.nameTr.trim().length < 2) return t('admin.badgeNameRequired')
    if (Number.isNaN(Number.parseInt(draft.reward, 10))) return t('admin.badgeRewardInvalid')
    if (draft.awardMode === 'auto' && draft.rows.filter(isCriterionComplete).length === 0) return t('admin.badConditionsInvalid')
    return null
  }, [draft, t])

  if (badgesQuery.isPending) return <StateLoading variant="cards" count={3} />
  if (badgesQuery.isError) {
    return <StateError detail={badgesQuery.error.message} onRetry={() => void badgesQuery.refetch()} busy={badgesQuery.isFetching} />
  }

  return (
    <div className="space-y-4">
      <MetricGrid columns={4}>
        <Metric index={0} icon={Award} label={t('admin.badgeTotal')} value={String(totals.total)} hint={t('admin.badgeTotalHint')} />
        <Metric index={1} icon={Sparkles} label={t('admin.marketActive')} value={String(totals.active)} hint={t('admin.badgeActiveHint')} />
        <Metric index={2} icon={Sparkles} label={t('admin.badgeAuto')} value={String(totals.auto)} hint={t('admin.badgeAutoHint')} />
        <Metric index={3} icon={Award} label={t('admin.badgePool')} value={<CoinAmount value={totals.reward} size="md" />} hint={t('admin.badgePoolHint')} />
      </MetricGrid>

      {failure ? <div className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">{failure}</div> : null}

      <Section
        title={t('admin.badges')}
        hint={t('admin.badgesHint')}
        aside={
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setDraft({
                code: '',
                nameTr: '',
                nameEn: '',
                descTr: '',
                tier: 'bronze',
                awardMode: 'auto',
                reward: '0',
                iconPath: '',
                active: true,
                rows: [{ group: 'all_of', metric: metricOptions[0] ?? 'sessions_qualified', op: 'gte', value: 1 }]
              })
              setIsNew(true)
            }}
          >
            <Plus size={13} />
            {t('admin.newBadge')}
          </Button>
        }
      >
        {badges.length === 0 ? (
          <StateEmpty icon={Award} title={t('admin.catalogEmpty')} />
        ) : (
          <ul className="space-y-1.5">
            {badges.map((badge) => {
              const rows = readCriteria(badge.conditions) ?? []
              return (
                <li key={badge.code} className="hud-panel flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg border border-line/70 bg-base/60">
                    <BadgeGlyph path={badge.icon_path} size={26} fallback={<Award size={14} className="text-mute" />} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={badge.tier === 'gold' ? 'warn' : badge.tier === 'special' ? 'accent' : 'neutral'}>
                        {t(TIER_LABEL[badge.tier] ?? 'profile.tierBronze')}
                      </Badge>
                      <span className={cn('truncate text-[13px] font-medium', badge.active ? 'text-ink' : 'text-mute line-through')}>
                        {badge.name_tr}
                      </span>
                      <Chip tone={badge.award_mode === 'auto' ? 'brand' : 'neutral'}>
                        {badge.award_mode === 'auto' ? t('admin.awardAuto') : t('admin.awardManual')}
                      </Chip>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-mute">{criteriaSentence(t, rows)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <CoinAmount value={badge.currency_reward} size="sm" tone="mute" />
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={() => {
                        setDraft(toDraft(badge))
                        setIsNew(false)
                      }}
                    >
                      <Pencil size={12} />
                      {t('admin.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      busy={remove.isPending && remove.variables === badge.code}
                      onClick={() => {
                        if (window.confirm(t('admin.deleteBadgeConfirm', { code: badge.code }))) remove.mutate(badge.code)
                      }}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      {draft ? (
        <Section
          title={`${isNew ? t('admin.newBadge') : t('admin.edit')}: ${draft.nameTr || draft.code || '—'}`}
          hint={t('admin.badgeEditorHint')}
          aside={
            <Row className="gap-2">
              <Button size="sm" variant="subtle" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" variant="primary" busy={save.isPending} disabled={validation !== null || draft.code.trim().length < 2} onClick={() => save.mutate(draft)}>
                <Save size={13} />
                {t('admin.save')}
              </Button>
            </Row>
          }
        >
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1">
                <span className="hud-label">{t('admin.nameTr')}</span>
                <input className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')} value={draft.nameTr} onChange={(event) => setDraft({ ...draft, nameTr: event.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.nameEn')}</span>
                <input className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')} value={draft.nameEn} onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.tier')}</span>
                <select
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  value={draft.tier}
                  onChange={(event) => setDraft({ ...draft, tier: event.target.value as BadgeDefinitionRow['tier'] })}
                >
                  {(['bronze', 'silver', 'gold', 'special'] as const).map((tier) => (
                    <option key={tier} value={tier}>
                      {t(TIER_LABEL[tier] ?? 'profile.tierBronze')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.awardMode')}</span>
                <select
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  value={draft.awardMode}
                  onChange={(event) => setDraft({ ...draft, awardMode: event.target.value as BadgeDefinitionRow['award_mode'] })}
                >
                  <option value="auto">{t('admin.awardAuto')}</option>
                  <option value="manual">{t('admin.awardManual')}</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1">
                <span className="hud-label">{t('admin.reward')}</span>
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  inputMode="numeric"
                  value={draft.reward}
                  onChange={(event) => setDraft({ ...draft, reward: event.target.value })}
                />
                <span className="text-[10px] text-mute">{t('admin.badgeRewardHint')}</span>
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="hud-label">{t('admin.description')}</span>
                <input className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')} value={draft.descTr} onChange={(event) => setDraft({ ...draft, descTr: event.target.value })} />
              </label>
              <label className="flex items-end gap-2 pb-1">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-brand)]"
                  checked={draft.active}
                  onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
                />
                <span className="text-[12px] text-ink">{t('admin.active')}</span>
              </label>
            </div>

            <div className="rounded-xl border border-brand/30 bg-brand/[0.05] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="text-[12px] font-medium text-ink">{t('admin.conditions')}</p>
                  <p className="text-[10px] text-mute">{t('admin.conditionsHint')}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDraft({ ...draft, rows: [...draft.rows, { group: 'all_of', metric: metricOptions[0] ?? 'sessions_qualified', op: 'gte', value: 1 }] })}
                >
                  <Plus size={12} />
                  {t('admin.addCondition')}
                </Button>
              </div>

              {draft.rows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[11px] text-mute">{t('admin.noConditionYet')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {draft.rows.map((row, index) => (
                    <li key={`${row.group}-${String(index)}`} className="grid grid-cols-[92px_minmax(0,1fr)_92px_80px_30px] items-center gap-2">
                      <select
                        className={cn(INPUT_CLASS, 'no-drag h-8 text-[11px]')}
                        value={row.group}
                        onChange={(event) => {
                          const rows = [...draft.rows]
                          rows[index] = { ...row, group: event.target.value as CriterionGroup }
                          setDraft({ ...draft, rows })
                        }}
                      >
                        {CRITERION_GROUPS.map((group) => (
                          <option key={group} value={group}>
                            {GROUP_LABEL[group]}
                          </option>
                        ))}
                      </select>
                      <select
                        className={cn(INPUT_CLASS, 'no-drag h-8 text-[11px]')}
                        value={row.metric}
                        onChange={(event) => {
                          const rows = [...draft.rows]
                          // An operator the engine cannot read for the new metric would award nothing,
                          // so the row moves to one it can.
                          const allowed = operatorsFor(event.target.value)
                          rows[index] = { ...row, metric: event.target.value, op: allowed.includes(row.op) ? row.op : allowed[0] ?? 'gte' }
                          setDraft({ ...draft, rows })
                        }}
                      >
                        {metricOptions.map((metric) => (
                          <option key={metric} value={metric}>
                            {humanMetric(t, metric)}
                          </option>
                        ))}
                      </select>
                      <select
                        className={cn(INPUT_CLASS, 'no-drag h-8 text-[11px]')}
                        value={row.op}
                        onChange={(event) => {
                          const rows = [...draft.rows]
                          rows[index] = { ...row, op: event.target.value }
                          setDraft({ ...draft, rows })
                        }}
                      >
                        {[...new Set([...operatorsFor(row.metric), row.op])].map((op) => (
                          <option key={op} value={op}>
                            {humanOp(t, op)}
                          </option>
                        ))}
                      </select>
                      <input
                        className={cn(INPUT_CLASS, 'no-drag h-8 text-[11px]')}
                        inputMode="numeric"
                        value={String(row.value)}
                        onChange={(event) => {
                          const rows = [...draft.rows]
                          rows[index] = { ...row, value: Number.parseInt(event.target.value, 10) || 0 }
                          setDraft({ ...draft, rows })
                        }}
                      />
                      <button
                        type="button"
                        aria-label={t('admin.delete')}
                        onClick={() => setDraft({ ...draft, rows: draft.rows.filter((_unused, at) => at !== index) })}
                        className="no-drag grid size-7 place-items-center rounded-md text-mute hover:text-danger"
                      >
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-2 rounded-lg bg-base/50 px-2.5 py-1.5 text-[11px] text-ink">{criteriaSentence(t, draft.rows)}</p>

              <details className="mt-2">
                <summary className="cursor-pointer text-[10px] text-mute hover:text-ink">{t('admin.rawConditions')}</summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded-lg border border-line bg-base px-2 py-1.5 font-mono text-[10px] text-mute">
                  {JSON.stringify(writeCriteria(draft.rows), null, 2)}
                </pre>
              </details>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="hud-label">{t('admin.code')}</span>
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-8 font-mono text-xs')}
                  value={draft.code}
                  disabled={!isNew}
                  onChange={(event) => setDraft({ ...draft, code: event.target.value.toLocaleLowerCase() })}
                />
                <span className="text-[10px] text-mute">{isNew ? t('admin.newCodeHint') : t('admin.keyLockedHint')}</span>
              </label>
              <div className="space-y-1.5">
                <span className="hud-label">{t('admin.badgeIcon')}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={cn(INPUT_CLASS, 'no-drag h-8 min-w-0 flex-1 font-mono text-xs')}
                    value={draft.iconPath}
                    onChange={(event) => setDraft({ ...draft, iconPath: event.target.value })}
                    placeholder={t('admin.badgeIconHint')}
                  />
                  <label className="no-drag">
                    <span className="sr-only">{t('admin.uploadIcon')}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={draft.code.trim().length < 2 || upload.isPending}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        event.target.value = ''
                        if (file) upload.mutate(file)
                      }}
                    />
                    <span
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] transition-colors',
                        draft.code.trim().length < 2 || upload.isPending
                          ? 'cursor-not-allowed border-line bg-panel-soft text-mute opacity-60'
                          : 'cursor-pointer border-brand/40 bg-brand/12 text-ink hover:bg-brand/20'
                      )}
                    >
                      <Upload size={12} />
                      {upload.isPending ? t('admin.uploading') : t('admin.uploadIcon')}
                    </span>
                  </label>
                  {draft.iconPath.trim().length > 0 ? (
                    <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, iconPath: '' })}>
                      <X size={12} />
                      {t('admin.clearImage')}
                    </Button>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-line/70 bg-base/60">
                    <BadgeGlyph path={draft.iconPath.trim().length > 0 ? draft.iconPath.trim() : null} size={32} fallback={<Award size={16} className="text-mute" />} />
                  </span>
                  <p className="text-[10px] leading-relaxed text-mute">
                    {upload.isError ? (upload.error instanceof Error ? upload.error.message : String(upload.error)) : t('admin.badgeIconHelp')}
                  </p>
                </div>
              </div>
            </div>

            {validation ? <p className="text-[11px] text-warn">{validation}</p> : null}
          </div>
        </Section>
      ) : null}
    </div>
  )
}
