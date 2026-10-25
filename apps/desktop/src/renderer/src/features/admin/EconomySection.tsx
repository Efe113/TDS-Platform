import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Coins, Gauge, HandCoins, Pencil, Plus, Save, Search, Trash2, Wrench } from 'lucide-react'
import {
  CURRENCY_RULE_KINDS,
  RULE_LEDGER_KINDS,
  UNITS_BY_KIND,
  economyErrorKey,
  formatCoin,
  type CurrencyRuleKind,
  type RuleLedgerKind
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { unitLabel } from '../../lib/rule-labels'
import { Badge, Button, INPUT_CLASS, Row, Toggle, cn } from '../../components/ui'
import { Chip, Metric, MetricGrid, Section } from '../../components/ui/system'
import { StateEmpty, StateError, StateLoading } from '../../components/ui/states'
import { CoinAmount } from '../../components/brand/coin'
import { IconPicker } from '../../components/brand/icon-picker'
import { RuleIcon } from '../../components/brand/rule-icon'
import {
  awardRule,
  deleteCurrencyRule,
  fetchCurrencyRules,
  reconcileDrift,
  saveCurrencyRule,
  searchMembers,
  type CurrencyRuleRow
} from './admin-api'

/**
 * The earning curve, edited with inputs instead of JSON.
 *
 * `params` used to be a textarea: an operator had to know that `decay_after_sessions` existed and what
 * it meant. Every field that decides payout is a labelled control, the unit is spelled out, and 0038
 * finally made both the icon and the weekly ceiling mean something: the icon is picked from the set the
 * app can draw, and the ceiling is enforced at award time.
 */

const KIND_LABEL: Record<CurrencyRuleKind, MessageKey> = {
  usage: 'admin.ruleKindUsage',
  publish: 'admin.ruleKindPublish',
  approval: 'admin.ruleKindApproval',
  badge: 'admin.ruleKindBadge',
  event: 'admin.ruleKindEvent',
  streak: 'admin.ruleKindStreak',
  milestone: 'admin.ruleKindMilestone',
  community: 'admin.ruleKindCommunity',
  referral: 'admin.ruleKindReferral',
  challenge: 'admin.ruleKindChallenge',
  support: 'admin.ruleKindSupport',
  grant: 'admin.ruleKindGrant'
}

const LEDGER_LABEL: Record<RuleLedgerKind, MessageKey> = {
  usage: 'admin.ledgerKindUsage',
  publish: 'admin.ledgerKindPublish',
  approval: 'admin.ledgerKindApproval',
  badge: 'admin.ledgerKindBadge',
  grant: 'admin.ledgerKindGrant'
}

const RULE_META: Record<string, { nameKey: MessageKey; hintKey: MessageKey }> = {
  usage_session: { nameKey: 'wallet.ruleUsage', hintKey: 'wallet.ruleUsageHint' },
  publish_bonus: { nameKey: 'wallet.rulePublish', hintKey: 'wallet.rulePublishHint' },
  approval_bonus: { nameKey: 'wallet.ruleApproval', hintKey: 'wallet.ruleApprovalHint' },
  badge_reward: { nameKey: 'wallet.ruleBadge', hintKey: 'wallet.ruleBadgeHint' }
}

interface Draft {
  code: string
  kind: CurrencyRuleKind
  ledgerKind: RuleLedgerKind
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
  descTr: string
  descEn: string
  icon: string | null
}

function toDraft(rule: CurrencyRuleRow): Draft {
  const decay = typeof rule.params['decay_after_sessions'] === 'number' ? String(rule.params['decay_after_sessions']) : ''
  return {
    code: rule.code,
    kind: rule.kind,
    ledgerKind: rule.ledger_kind,
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
    nameEn: rule.name_en ?? '',
    descTr: rule.desc_tr ?? '',
    descEn: rule.desc_en ?? '',
    icon: rule.icon ?? null
  }
}

function parseOptionalInt(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Pay one rule to one member by hand. `award_currency` clamps to the rule amount and stops at the
 * ceiling, which is right for automated earnings and wrong for an operator decision, so the panel can
 * opt out with `ignoreLimits` and pay the typed number straight into the ledger.
 */
function RuleAwardPanel({
  rule,
  onDone
}: {
  rule: CurrencyRuleRow
  onDone: () => void
}): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<{ userId: string; label: string } | null>(null)
  const [amount, setAmount] = useState(String(rule.amount))
  const [note, setNote] = useState('')
  const [ignoreLimits, setIgnoreLimits] = useState(false)

  const membersQuery = useQuery({
    queryKey: ['admin', 'members', query],
    queryFn: () => searchMembers(query),
    enabled: query.trim().length > 0,
    retry: 1
  })

  const award = useMutation({
    mutationFn: () =>
      awardRule({
        userId: (picked as { userId: string }).userId,
        code: rule.code,
        amount: ignoreLimits ? Number.parseInt(amount, 10) : null,
        ignoreLimits,
        note
      }),
    onSuccess: () => {
      setNote('')
      setPicked(null)
      setQuery('')
      void queryClient.invalidateQueries({ queryKey: ['admin', 'ledger'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] })
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
    }
  })

  const parsedAmount = Number.parseInt(amount, 10)
  const ready = picked !== null && note.trim().length >= 3 && (ignoreLimits ? Number.isFinite(parsedAmount) && parsedAmount > 0 : true)

  return (
    <div className="w-full space-y-2 rounded-lg border border-brand/30 bg-brand/[0.05] p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="hud-label">{`${t('admin.awardRule')}: ${rule.name_tr ?? rule.code}`}</span>
        <Chip tone="neutral">{unitLabel(rule.unit, t)}</Chip>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>

      {award.isError ? (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">
          {t(economyErrorKey(award.error instanceof Error ? award.error.message : String(award.error)))}
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
        <div className="space-y-1.5">
          <div className="relative">
            <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
            <input
              className={cn(INPUT_CLASS, 'no-drag h-8 w-full py-0 pl-7 text-[12px]')}
              placeholder={t('admin.memberSearchHint')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {picked ? (
            <p className="text-[11px] text-ink">{`${t('admin.picked')}: ${picked.label}`}</p>
          ) : membersQuery.isPending && query.trim().length > 0 ? (
            <p className="text-[11px] text-mute">{t('common.loading')}</p>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {(membersQuery.data ?? []).map((member) => (
                <li key={member.userId}>
                  <button
                    type="button"
                    data-press
                    onClick={() => setPicked({ userId: member.userId, label: member.displayName ?? `@${member.handle}` })}
                    className="no-drag rounded-md border border-line bg-panel-soft px-2 py-1 text-[11px] text-mute hover:border-brand/50 hover:text-ink"
                  >
                    {`${member.displayName ?? member.handle} · ${formatCoin(member.balance)}`}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="space-y-1">
          <span className="hud-label">{t('admin.amount')}</span>
          <input
            className={cn(INPUT_CLASS, 'no-drag h-8 w-full text-xs')}
            inputMode="numeric"
            value={amount}
            disabled={!ignoreLimits}
            onChange={(event) => setAmount(event.target.value)}
          />
          <span className="text-[10px] text-mute">{ignoreLimits ? t('admin.economyPreview') : t('admin.awardRuleRuleAmount')}</span>
        </label>

        <div className="space-y-1.5">
          <Toggle
            checked={ignoreLimits}
            onChange={setIgnoreLimits}
            label={<span className="text-[11px] text-mute">{t('admin.awardIgnoreLimits')}</span>}
          />
          <input
            className={cn(INPUT_CLASS, 'no-drag h-8 w-56 text-[12px]')}
            placeholder={t('admin.moveNoteHint')}
            value={note}
            maxLength={300}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button size="sm" variant="primary" disabled={!ready} busy={award.isPending} onClick={() => award.mutate()}>
            <HandCoins size={12} />
            {t('admin.awardRule')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function EconomySection(): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [awardFor, setAwardFor] = useState<string | null>(null)
  const [repaired, setRepaired] = useState<number | null>(null)
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
        desc_tr: input.descTr.trim() || null,
        desc_en: input.descEn.trim() || null,
        icon: input.icon,
        ledger_kind: input.ledgerKind
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

  // 0041: `verify_balance` could only report a drift between the cache and the ledger. This is the hand
  // that repairs every account holding one, from the same screen that watches the economy.
  const repair = useMutation({
    mutationFn: () => reconcileDrift(),
    onSuccess: (count) => {
      setRepaired(count)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'ledger'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] })
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
    },
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

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line/60 bg-base/40 px-3 py-2 text-[11px]">
        <Wrench size={13} className="shrink-0 text-mute" />
        <span className="min-w-0 flex-1 break-words text-mute">{t('admin.reconcileHint')}</span>
        {repaired !== null ? (
          <Chip tone={repaired > 0 ? 'good' : 'neutral'}>{t('admin.reconcileCount', { count: String(repaired) })}</Chip>
        ) : null}
        <Button size="sm" variant={repaired === 0 ? 'ghost' : 'subtle'} busy={repair.isPending} onClick={() => repair.mutate()}>
          {t('admin.reconcileAll')}
        </Button>
      </div>

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
                ledgerKind: 'usage',
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
                nameEn: '',
                descTr: '',
                descEn: '',
                icon: null
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
              // A rule's own copy wins; the four seeded codes keep their translated names as fallback.
              const label = rule.name_tr ?? (meta ? t(meta.nameKey) : rule.code)
              return (
                <li key={rule.code} className="hud-panel flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg border', rule.enabled ? 'border-brand/30 bg-brand/12 text-brand' : 'border-line bg-panel-soft text-mute')}>
                    <RuleIcon name={rule.icon} kind={rule.kind} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className={cn('truncate text-[13px] font-medium', rule.enabled ? 'text-ink' : 'text-mute')}>
                        {label}
                      </p>
                      <Chip tone="neutral">{t(KIND_LABEL[rule.kind])}</Chip>
                      <Chip tone="neutral">{t('admin.ledgerKind')}: {t(LEDGER_LABEL[rule.ledger_kind])}</Chip>
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
                    <Button
                      size="sm"
                      variant={awardFor === rule.code ? 'primary' : 'subtle'}
                      disabled={!rule.enabled}
                      onClick={() => setAwardFor((current) => (current === rule.code ? null : rule.code))}
                    >
                      <HandCoins size={12} />
                      {t('admin.awardRule')}
                    </Button>
                  </Row>
                  {awardFor === rule.code ? <RuleAwardPanel rule={rule} onDone={() => setAwardFor(null)} /> : null}
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
              {/* 0038: name_en has been in the table since 0029 and wiped by every save, because no
                  input existed and the RPC always overwrote it. */}
              <label className="space-y-1">
                <span className="hud-label">{t('admin.nameEn')}</span>
                <input className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')} value={draft.nameEn} onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.kind')}</span>
                <select
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  value={draft.kind}
                  onChange={(event) => {
                    const kind = event.target.value as CurrencyRuleKind
                    setDraft({ ...draft, kind, unit: UNITS_BY_KIND[kind][0] ?? 'per_event' })
                  }}
                >
                  {CURRENCY_RULE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(KIND_LABEL[kind])}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.ledgerKind')}</span>
                <select
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  value={draft.ledgerKind}
                  onChange={(event) => setDraft({ ...draft, ledgerKind: event.target.value as RuleLedgerKind })}
                >
                  {RULE_LEDGER_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(LEDGER_LABEL[kind])}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-mute">{t('admin.ledgerKindHint')}</span>
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

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="hud-label">{t('admin.descTr')}</span>
                <textarea
                  className={cn(INPUT_CLASS, 'min-h-16 w-full resize-y text-xs')}
                  value={draft.descTr}
                  onChange={(event) => setDraft({ ...draft, descTr: event.target.value })}
                  placeholder={t('admin.descTrHint')}
                />
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.descEn')}</span>
                <textarea
                  className={cn(INPUT_CLASS, 'min-h-16 w-full resize-y text-xs')}
                  value={draft.descEn}
                  onChange={(event) => setDraft({ ...draft, descEn: event.target.value })}
                  placeholder={t('admin.descEnHint')}
                />
              </label>
            </div>

            <IconPicker
              label={t('admin.ruleIcon')}
              value={draft.icon}
              onChange={(next) => setDraft({ ...draft, icon: next })}
            />

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
