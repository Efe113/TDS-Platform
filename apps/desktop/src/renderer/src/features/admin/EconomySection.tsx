import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, CalendarClock, Coins, Gauge, Pencil, Plus, Save, Sparkles, Trash2, TrendingUp } from 'lucide-react'
import { formatCoin } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { Badge, Button, INPUT_CLASS, Row, cn } from '../../components/ui'
import { Chip, Metric, MetricGrid, Section } from '../../components/ui/system'
import { StateEmpty, StateError, StateLoading } from '../../components/ui/states'
import { CoinAmount } from '../../components/brand/coin'
import { deleteCurrencyRule, fetchCurrencyRules, saveCurrencyRule, type CurrencyRuleRow } from './admin-api'

/**
 * The earning curve, edited with inputs instead of JSON.
 *
 * `params` used to be a textarea: an operator had to know that `decay_after_sessions` existed and
 * what it meant. Every field that decides payout is now a labelled control with its unit spelled out,
 * and the only free-form parameters are the ones nobody edits (preserved untouched on save).
 */

const KIND_LABEL: Record<CurrencyRuleRow['kind'], MessageKey> = {
  usage: 'admin.ruleKindUsage',
  publish: 'admin.ruleKindPublish',
  approval: 'admin.ruleKindApproval',
  badge: 'admin.ruleKindBadge',
  grant: 'admin.ruleKindGrant'
}

const RULE_META: Record<string, { nameKey: MessageKey; hintKey: MessageKey; icon: typeof Coins }> = {
  usage_session: { nameKey: 'wallet.ruleUsage', hintKey: 'wallet.ruleUsageHint', icon: Gauge },
  publish_bonus: { nameKey: 'wallet.rulePublish', hintKey: 'wallet.rulePublishHint', icon: Sparkles },
  approval_bonus: { nameKey: 'wallet.ruleApproval', hintKey: 'wallet.ruleApprovalHint', icon: BadgeCheck },
  badge_reward: { nameKey: 'wallet.ruleBadge', hintKey: 'wallet.ruleBadgeHint', icon: TrendingUp }
}

const UNIT_LABEL: Record<string, MessageKey> = {
  per_qualifying_session: 'wallet.unitSession',
  per_approved_version: 'wallet.unitVersion',
  per_first_approval: 'wallet.unitFirstApproval',
  per_badge: 'wallet.unitBadge',
  per_event: 'wallet.perEvent'
}

const UNITS_BY_KIND: Record<CurrencyRuleRow['kind'], string[]> = {
  usage: ['per_qualifying_session'],
  publish: ['per_approved_version'],
  approval: ['per_first_approval'],
  badge: ['per_badge'],
  grant: ['per_event']
}

interface Draft {
  code: string
  kind: CurrencyRuleRow['kind']
  amount: string
  unit: string
  dailyCap: string
  weeklyCap: string
  minSeconds: string
  minSteps: string
  decayAfter: string
  enabled: boolean
  params: Record<string, unknown>
  nameTr: string
  nameEn: string
}

function toDraft(rule: CurrencyRuleRow): Draft {
  const decay = typeof rule.params['decay_after_sessions'] === 'number' ? String(rule.params['decay_after_sessions']) : ''
  return {
    code: rule.code,
    kind: rule.kind,
    amount: String(rule.amount),
    unit: rule.unit,
    dailyCap: rule.daily_cap === null ? '' : String(rule.daily_cap),
    weeklyCap: rule.weekly_cap === null ? '' : String(rule.weekly_cap),
    minSeconds: rule.min_qualifying_seconds === null ? '' : String(rule.min_qualifying_seconds),
    minSteps: rule.min_steps === null ? '' : String(rule.min_steps),
    decayAfter: decay,
    enabled: rule.enabled,
    params: { ...rule.params },
    nameTr: rule.name_tr ?? '',
    nameEn: rule.name_en ?? ''
  }
}

function unitLabel(unit: string, t: (key: MessageKey) => string): string {
  const key = UNIT_LABEL[unit]
  return key ? t(key) : unit
}

function parseOptionalInt(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isNaN(parsed) ? null : parsed
}

export function EconomySection(): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const rulesQuery = useQuery({ queryKey: ['admin', 'currency-rules'], queryFn: fetchCurrencyRules, retry: 1 })

  const save = useMutation({
    mutationFn: async (input: Draft) => {
      const amount = Number.parseInt(input.amount, 10)
      const params = { ...input.params }
      if (input.kind === 'usage' && input.decayAfter.trim().length > 0) {
        params['decay_after_sessions'] = Number.parseInt(input.decayAfter, 10)
      } else {
        delete params['decay_after_sessions']
      }
      await saveCurrencyRule({
        code: input.code,
        kind: input.kind,
        amount,
        unit: input.unit,
        daily_cap: parseOptionalInt(input.dailyCap),
        weekly_cap: parseOptionalInt(input.weeklyCap),
        min_qualifying_seconds: parseOptionalInt(input.minSeconds),
        min_steps: parseOptionalInt(input.minSteps),
        enabled: input.enabled,
        params,
        name_tr: input.nameTr.trim() || null,
        name_en: input.nameEn.trim() || null,
        desc_tr: (rulesQuery.data ?? []).find((row) => row.code === input.code)?.desc_tr ?? null,
        desc_en: (rulesQuery.data ?? []).find((row) => row.code === input.code)?.desc_en ?? null
      })
    },
    onSuccess: () => {
      setFailure(null)
      setDraft(null)
      setIsNew(false)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'currency-rules'] })
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const toggle = useMutation({
    mutationFn: async (rule: CurrencyRuleRow) => {
      await saveCurrencyRule({ ...rule, enabled: !rule.enabled })
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'currency-rules'] }),
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const remove = useMutation({
    mutationFn: (code: string) => deleteCurrencyRule(code),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'currency-rules'] }),
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const rules = rulesQuery.data ?? []
  const totals = useMemo(() => {
    const daily = rules.reduce((sum, rule) => sum + (rule.daily_cap ?? 0), 0)
    const weekly = rules.reduce((sum, rule) => sum + (rule.weekly_cap ?? 0), 0)
    return { active: rules.filter((rule) => rule.enabled).length, daily, weekly }
  }, [rules])

  const draftMeta = draft ? RULE_META[draft.code] : undefined

  const validation = useMemo(() => {
    if (!draft) return null
    const amount = Number.parseInt(draft.amount, 10)
    if (Number.isNaN(amount) || amount < 0) return t('admin.economyAmountInvalid')
    const daily = parseOptionalInt(draft.dailyCap)
    const weekly = parseOptionalInt(draft.weeklyCap)
    if (daily !== null && daily < amount) return t('admin.economyCapBelowAmount')
    if (weekly !== null && daily !== null && weekly < daily) return t('admin.economyWeeklyBelowDaily')
    if (draft.minSeconds.trim().length > 0 && parseOptionalInt(draft.minSeconds) === null) return t('admin.economyMinInvalid')
    if (draft.minSteps.trim().length > 0 && parseOptionalInt(draft.minSteps) === null) return t('admin.economyMinInvalid')
    return null
  }, [draft, t])

  if (rulesQuery.isPending) return <StateLoading variant="cards" count={3} />
  if (rulesQuery.isError) {
    return <StateError detail={rulesQuery.error.message} onRetry={() => void rulesQuery.refetch()} busy={rulesQuery.isFetching} />
  }

  return (
    <div className="space-y-4">
      <MetricGrid columns={4}>
        <Metric index={0} icon={Coins} label={t('admin.economyRules')} value={String(rules.length)} hint={t('admin.economyRulesHint')} />
        <Metric index={1} icon={Gauge} label={t('admin.marketActive')} value={String(totals.active)} hint={t('admin.economyActiveHint')} />
        <Metric index={2} icon={CalendarClock} label={t('admin.economyDailyCeiling')} value={<CoinAmount value={totals.daily} size="md" />} hint={t('admin.economyDailyCeilingHint')} />
        <Metric index={3} icon={CalendarClock} label={t('admin.economyWeeklyCeiling')} value={<CoinAmount value={totals.weekly} size="md" />} hint={t('admin.economyWeeklyCeilingHint')} />
      </MetricGrid>

      {failure ? <div className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">{failure}</div> : null}

      <Section
        title={t('admin.currencyRules')}
        hint={t('admin.economyHint')}
        aside={
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setDraft({
                code: '',
                kind: 'usage',
                amount: '3',
                unit: 'per_qualifying_session',
                dailyCap: '12',
                weeklyCap: '60',
                minSeconds: '180',
                minSteps: '5',
                decayAfter: '',
                enabled: true,
                params: {},
                nameTr: '',
                nameEn: ''
              })
              setIsNew(true)
            }}
          >
            <Plus size={13} />
            {t('admin.newRule')}
          </Button>
        }
      >
        {rules.length === 0 ? (
          <StateEmpty icon={Coins} title={t('admin.catalogEmpty')} />
        ) : (
          <ul className="space-y-1.5">
            {rules.map((rule) => {
              const meta = RULE_META[rule.code]
              const Icon = meta?.icon ?? Coins
              return (
                <li key={rule.code} className="hud-panel flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg border', rule.enabled ? 'border-brand/30 bg-brand/12 text-brand' : 'border-line bg-panel-soft text-mute')}>
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className={cn('truncate text-[13px] font-medium', rule.enabled ? 'text-ink' : 'text-mute')}>
                        {meta ? t(meta.nameKey) : (rule.name_tr ?? rule.code)}
                      </p>
                      <Chip tone="neutral">{t(KIND_LABEL[rule.kind])}</Chip>
                    </div>
                    <p className="truncate font-mono text-[10px] text-mute">{`${rule.code} · ${unitLabel(rule.unit, t)}`}</p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-3 text-[11px]">
                    <CoinAmount value={rule.amount} size="sm" />
                    <span className="hud-num w-24 text-right text-mute">
                      {rule.daily_cap === null ? t('admin.economyNoCap') : `${t('admin.dailyCap')}: ${formatCoin(rule.daily_cap)}`}
                    </span>
                    <span className="hud-num w-24 text-right text-mute">
                      {rule.weekly_cap === null ? t('admin.economyNoCap') : `${t('admin.weeklyCap')}: ${formatCoin(rule.weekly_cap)}`}
                    </span>
                  </div>

                  <Row className="gap-1">
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={() => {
                        setDraft(toDraft(rule))
                        setIsNew(false)
                      }}
                    >
                      <Pencil size={12} />
                      {t('admin.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      busy={remove.isPending && remove.variables === rule.code}
                      onClick={() => {
                        if (window.confirm(t('admin.deleteRuleConfirm', { code: rule.code }))) remove.mutate(rule.code)
                      }}
                    >
                      <Trash2 size={12} />
                    </Button>
                    <Button size="sm" variant={rule.enabled ? 'ghost' : 'primary'} busy={toggle.isPending} onClick={() => toggle.mutate(rule)}>
                      {rule.enabled ? t('admin.disable') : t('admin.enable')}
                    </Button>
                  </Row>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      {draft ? (
        <Section
          title={`${isNew ? t('admin.newRule') : t('admin.edit')}: ${draft.nameTr || (draftMeta ? t(draftMeta.nameKey) : draft.code)}`}
          hint={t('admin.economyEditorHint')}
          aside={
            <Row className="gap-2">
              <Button size="sm" variant="subtle" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                busy={save.isPending}
                disabled={validation !== null || draft.code.trim().length < 3 || draft.nameTr.trim().length < 2}
                onClick={() => save.mutate(draft)}
              >
                <Save size={13} />
                {t('admin.save')}
              </Button>
            </Row>
          }
        >
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1">
                <span className="hud-label">{t('admin.code')}</span>
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-8 font-mono text-xs')}
                  value={draft.code}
                  disabled={!isNew}
                  onChange={(event) => setDraft({ ...draft, code: event.target.value.toLocaleLowerCase() })}
                />
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.nameTr')}</span>
                <input className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')} value={draft.nameTr} onChange={(event) => setDraft({ ...draft, nameTr: event.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.kind')}</span>
                <select
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  value={draft.kind}
                  onChange={(event) => {
                    const kind = event.target.value as CurrencyRuleRow['kind']
                    setDraft({ ...draft, kind, unit: UNITS_BY_KIND[kind]?.[0] ?? draft.unit })
                  }}
                >
                  {(Object.keys(KIND_LABEL) as CurrencyRuleRow['kind'][]).map((kind) => (
                    <option key={kind} value={kind}>
                      {t(KIND_LABEL[kind])}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.unit')}</span>
                <select
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  value={draft.unit}
                  onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
                >
                  {(UNITS_BY_KIND[draft.kind] ?? []).map((unit) => (
                    <option key={unit} value={unit}>
                      {unitLabel(unit, t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.amount')}</span>
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  inputMode="numeric"
                  value={draft.amount}
                  onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
                />
              </label>
              <div className="space-y-1">
                <span className="hud-label">{t('admin.economyPreview')}</span>
                <div className="flex h-8 items-center rounded-lg border border-line bg-base/50 px-2.5">
                  <CoinAmount value={Number.parseInt(draft.amount, 10) || 0} size="sm" />
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1">
                <span className="hud-label">{t('admin.dailyCap')}</span>
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  inputMode="numeric"
                  placeholder={t('admin.optionalHint')}
                  value={draft.dailyCap}
                  onChange={(event) => setDraft({ ...draft, dailyCap: event.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.weeklyCap')}</span>
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  inputMode="numeric"
                  placeholder={t('admin.optionalHint')}
                  value={draft.weeklyCap}
                  onChange={(event) => setDraft({ ...draft, weeklyCap: event.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.minQualifying')}</span>
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  inputMode="numeric"
                  placeholder={t('admin.optionalHint')}
                  value={draft.minSeconds}
                  onChange={(event) => setDraft({ ...draft, minSeconds: event.target.value })}
                />
                <span className="text-[10px] text-mute">{t('admin.economySecondsHint')}</span>
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.minSteps')}</span>
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  inputMode="numeric"
                  placeholder={t('admin.optionalHint')}
                  value={draft.minSteps}
                  onChange={(event) => setDraft({ ...draft, minSteps: event.target.value })}
                />
                <span className="text-[10px] text-mute">{t('admin.economyStepsHint')}</span>
              </label>
            </div>

            {draft.kind === 'usage' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="hud-label">{t('admin.economyDecay')}</span>
                  <input
                    className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                    inputMode="numeric"
                    placeholder={t('admin.optionalHint')}
                    value={draft.decayAfter}
                    onChange={(event) => setDraft({ ...draft, decayAfter: event.target.value })}
                  />
                  <span className="text-[10px] text-mute">{t('admin.economyDecayHint')}</span>
                </label>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line/70 bg-base/40 px-3 py-2 text-[11px] text-mute">
              <Badge tone="neutral">{draft.enabled ? t('admin.enabled') : t('admin.flagOff')}</Badge>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-brand)]"
                  checked={draft.enabled}
                  onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                />
                <span className="text-ink">{t('admin.economyEnabledLabel')}</span>
              </label>
              {validation ? <span className="ml-auto text-warn">{validation}</span> : null}
            </div>
          </div>
        </Section>
      ) : null}
    </div>
  )
}
