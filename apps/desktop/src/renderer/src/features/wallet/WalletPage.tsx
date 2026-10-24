import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Award,
  BadgeCheck,
  CalendarClock,
  Check,
  Copy,
  Coins,
  Flame,
  Gauge,
  Search,
  Sparkles,
  TrendingUp,
  Store,
  Wallet as WalletIcon
} from 'lucide-react'
import { capRemaining, formatCoin, type WalletRule } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { navigate } from '../../lib/router'
import { fetchWallet } from '../../lib/wallet-api'
import { formatDateTime } from '../admin/admin-ui'
import { CoinAmount, CoinIcon } from '../../components/brand/coin'
import { Banner, Button, EmptyState, INPUT_CLASS, Row, cn } from '../../components/ui'
import { Chip, Metric, MetricGrid, PageHeader, Section, Segmented } from '../../components/ui/system'
import { StateEmpty, StateError, StateLoading } from '../../components/ui/states'
import { CountUp } from '../../motion/primitives/CountUp'
import { Reveal, RevealItem, RevealList } from '../../motion/primitives/Reveal'
import { SkeletonCard } from '../../motion/primitives/Shimmer'

/**
 * The wallet is the economy's home, so it is built around three questions: what do I have, how do I
 * earn more, and where did it go. The old page answered none of them - it listed raw rule codes like
 * `badge_reward` next to catalog SKUs. Every code below has a name, an icon and a plain sentence.
 */


type LedgerFilter = 'all' | 'earn' | 'spend'

interface RuleMeta {
  nameKey: MessageKey
  unitKey: MessageKey
  hintKey: MessageKey
  icon: typeof Coins
  tone: 'brand' | 'good' | 'warn' | 'accent'
}

/** One row per code the server can actually pay out. An unknown code falls back to a readable form. */
const RULE_META: Record<string, RuleMeta> = {
  usage_session: {
    nameKey: 'wallet.ruleUsage',
    unitKey: 'wallet.unitSession',
    hintKey: 'wallet.ruleUsageHint',
    icon: Gauge,
    tone: 'brand'
  },
  publish_bonus: {
    nameKey: 'wallet.rulePublish',
    unitKey: 'wallet.unitVersion',
    hintKey: 'wallet.rulePublishHint',
    icon: Sparkles,
    tone: 'accent'
  },
  approval_bonus: {
    nameKey: 'wallet.ruleApproval',
    unitKey: 'wallet.unitFirstApproval',
    hintKey: 'wallet.ruleApprovalHint',
    icon: BadgeCheck,
    tone: 'good'
  },
  badge_reward: {
    nameKey: 'wallet.ruleBadge',
    unitKey: 'wallet.unitBadge',
    hintKey: 'wallet.ruleBadgeHint',
    icon: Award,
    tone: 'warn'
  }
}

/** `something_new_here` -> "Something new here": never show a raw snake_case token to a user. */
function readableCode(code: string): string {
  const words = code.replace(/[_-]+/g, ' ').trim()
  return words.length === 0 ? code : words.charAt(0).toLocaleUpperCase() + words.slice(1)
}

const KIND_META: Record<string, { key: MessageKey; icon: typeof Coins; good: boolean }> = {
  usage: { key: 'wallet.kindUsage', icon: ArrowUpRight, good: true },
  publish: { key: 'wallet.kindPublish', icon: ArrowUpRight, good: true },
  approval: { key: 'wallet.kindApproval', icon: ArrowUpRight, good: true },
  badge: { key: 'wallet.kindBadge', icon: ArrowUpRight, good: true },
  spend: { key: 'wallet.kindSpend', icon: ArrowDownLeft, good: false },
  refund: { key: 'wallet.kindRefund', icon: ArrowUpRight, good: true },
  grant: { key: 'wallet.kindGrant', icon: ArrowUpRight, good: true },
  reverse: { key: 'wallet.kindReverse', icon: ArrowDownLeft, good: false }
}

function RuleCard({ rule }: { rule: WalletRule }): ReactNode {
  const t = useT()
  const meta = RULE_META[rule.code]
  const Icon = meta?.icon ?? Coins
  const todayLeft = capRemaining(rule.earnedToday, rule.dailyCap)
  const weekLeft = capRemaining(rule.earnedWeek, rule.weeklyCap)
  const dailyPercent = rule.dailyCap && rule.dailyCap > 0 ? Math.min(100, Math.round(((todayLeft ?? 0) / rule.dailyCap) * 100)) : null
  const weekPercent = rule.weeklyCap && rule.weeklyCap > 0 ? Math.min(100, Math.round(((weekLeft ?? 0) / rule.weeklyCap) * 100)) : null

  return (
    <div data-lift className="hud-panel p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-brand/30 bg-brand/12 text-brand">
            <Icon size={15} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-ink">{meta ? t(meta.nameKey) : readableCode(rule.code)}</p>
            <p className="truncate text-[11px] text-mute">
              {meta ? t(meta.unitKey) : readableCode(rule.code)}
            </p>
          </div>
        </div>
        <div className="text-right">
          <CoinAmount value={rule.amount} size="md" />
        </div>
      </div>

      {meta ? <p className="mt-2 text-[11px] leading-relaxed text-mute/85">{t(meta.hintKey)}</p> : null}

      <div className="mt-2.5 space-y-2">
        {dailyPercent !== null ? (
          <div>
            <div className="flex items-center justify-between gap-2 text-[10px] text-mute">
              <span className="hud-label">{t('wallet.dailyCap')}</span>
              <span className="hud-num">{`${formatCoin(rule.earnedToday)} / ${formatCoin(rule.dailyCap ?? 0)}`}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel-soft">
              <div className="h-full rounded-full bg-brand/70" style={{ width: `${String(dailyPercent)}%` }} />
            </div>
          </div>
        ) : null}
        {weekPercent !== null ? (
          <div>
            <div className="flex items-center justify-between gap-2 text-[10px] text-mute">
              <span className="hud-label">{t('wallet.weeklyCap')}</span>
              <span className="hud-num">{`${formatCoin(rule.earnedWeek)} / ${formatCoin(rule.weeklyCap ?? 0)}`}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel-soft">
              <div className="h-full rounded-full bg-good/70" style={{ width: `${String(weekPercent)}%` }} />
            </div>
          </div>
        ) : null}
        {rule.dailyCap === null && rule.weeklyCap === null ? (
          <Chip tone="neutral" icon={TrendingUp}>{t('wallet.unlimited')}</Chip>
        ) : null}
      </div>
    </div>
  )
}

export function WalletPage(): ReactNode {
  const t = useT()
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('all')
  const [ledgerQuery, setLedgerQuery] = useState('')
  const [copied, setCopied] = useState(false)

  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: fetchWallet, retry: 1 })
  const wallet = walletQuery.data

  // The economy in one sentence: what came in, what went out, this week and all time.
  const totals = useMemo(() => {
    const weekStart = Date.now() - 7 * 24 * 3_600_000
    let earnedWeek = 0
    let spentWeek = 0
    let earnedLife = 0
    let spentLife = 0
    for (const entry of wallet?.entries ?? []) {
      const at = new Date(entry.at).getTime()
      const inWeek = Number.isFinite(at) && at >= weekStart
      if (entry.delta >= 0) {
        earnedLife += entry.delta
        if (inWeek) earnedWeek += entry.delta
      } else {
        spentLife += -entry.delta
        if (inWeek) spentWeek += -entry.delta
      }
    }
    return { earnedWeek, spentWeek, earnedLife, spentLife }
  }, [wallet?.entries])

  const ledger = useMemo(() => {
    const needle = ledgerQuery.trim().toLocaleLowerCase()
    return (wallet?.entries ?? []).filter((entry) => {
      if (ledgerFilter === 'earn' && entry.delta < 0) return false
      if (ledgerFilter === 'spend' && entry.delta >= 0) return false
      if (needle.length === 0) return true
      const kind = KIND_META[entry.kind]
      const label = kind ? t(kind.key) : entry.kind
      return label.toLocaleLowerCase().includes(needle) || String(entry.delta).includes(needle)
    })
  }, [wallet?.entries, ledgerFilter, ledgerQuery, t])

  const ledgerGroups = useMemo(() => {
    const groups = new Map<string, typeof ledger>()
    for (const entry of ledger) {
      const day = new Date(entry.at).toLocaleDateString()
      const list = groups.get(day) ?? []
      list.push(entry)
      groups.set(day, list)
    }
    return [...groups.entries()]
  }, [ledger])

  const copyLedger = (): void => {
    const text = ledger
      .map((entry) => `${new Date(entry.at).toLocaleString()}\t${t(KIND_META[entry.kind]?.key ?? 'wallet.ledger')}\t${entry.delta > 0 ? '+' : ''}${entry.delta}`)
      .join('\n')
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    })
  }

  if (walletQuery.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('wallet.title')} subtitle={t('wallet.subtitle')} />
        <SkeletonCard lines={3} />
        <StateLoading variant="cards" count={3} />
        <SkeletonCard lines={5} />
      </div>
    )
  }

  if (!wallet) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('wallet.title')} subtitle={t('wallet.subtitle')} />
        <StateError
          detail={walletQuery.error?.message ?? null}
          onRetry={() => void walletQuery.refetch()}
          busy={walletQuery.isFetching}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('wallet.title')}
        subtitle={t('wallet.subtitle')}
        badges={
          <>
            <Chip tone={wallet.reconciled ? 'good' : 'danger'} icon={Coins}>
              {wallet.reconciled ? t('wallet.reconciled') : t('wallet.unreconciledTitle')}
            </Chip>
            <Chip tone="brand" icon={Sparkles}>
              {(wallet.catalog.find((item) => item.kind === 'theme' && item.refCode === wallet.theme)?.name ?? t('theme.name.default')) as string}
            </Chip>
            {wallet.boosts.length > 0 ? <Chip tone="warn" icon={Flame}>{t('wallet.boostsActive', { count: wallet.boosts.length })}</Chip> : null}
          </>
        }
        actions={
          <Button variant="primary" onClick={() => navigate('/discover')}>
            <WalletIcon size={14} />
            {t('wallet.earnCta')}
          </Button>
        }
      />

      {!wallet.reconciled ? (
        <Banner tone="danger" title={t('wallet.unreconciledTitle')}>
          {`${t('wallet.unreconciledBody')} (${formatCoin(wallet.balance)} / ${formatCoin(wallet.cached ?? 0)})`}
        </Banner>
      ) : null}

      <Reveal>
        <div className="hud-panel relative overflow-hidden px-5 py-4">
          <span aria-hidden className="hud-scan" />
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="hud-label flex items-center gap-1.5">
                <Coins size={12} className="text-brand" />
                {t('wallet.balance')}
              </p>
              <p className="mt-1.5 flex items-center gap-3">
                <CoinIcon size={30} className="text-brand" />
                <span className="hud-num text-4xl leading-none font-semibold text-ink">
                  <CountUp value={wallet.balance} format={formatCoin} />
                </span>
              </p>
              <p className="mt-1.5 text-[11px] text-mute">{t('wallet.balanceHint')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip tone="good" icon={TrendingUp}>{`${t('wallet.thisWeekEarned')}: +${formatCoin(totals.earnedWeek)}`}</Chip>
              <Chip tone="neutral" icon={ArrowDownLeft}>{`${t('wallet.thisWeekSpent')}: -${formatCoin(totals.spentWeek)}`}</Chip>
            </div>
          </div>
        </div>
      </Reveal>

      <MetricGrid columns={4}>
        <Metric index={0} icon={TrendingUp} label={t('wallet.thisWeekEarned')} value={<CoinAmount value={totals.earnedWeek} tone="good" size="md" />} hint={t('wallet.lastSevenDays')} />
        <Metric index={1} icon={ArrowDownLeft} label={t('wallet.thisWeekSpent')} value={<CoinAmount value={totals.spentWeek} tone="ink" size="md" />} hint={t('wallet.lastSevenDays')} />
        <Metric index={2} icon={Coins} label={t('wallet.lifetimeEarned')} value={<CoinAmount value={totals.earnedLife} tone="ink" size="md" />} hint={t('wallet.ledgerHint')} />
        <Metric index={3} icon={Flame} label={t('wallet.lifetimeSpent')} value={<CoinAmount value={totals.spentLife} tone="mute" size="md" />} hint={t('wallet.ledgerHint')} />
      </MetricGrid>

      <Section title={t('wallet.earnings')} hint={t('wallet.earningsHint')}>
        {wallet.rules.length === 0 ? (
          <EmptyState title={t('wallet.noRules')} body={t('wallet.noRulesHint')} />
        ) : (
          <RevealList className="grid gap-2.5 sm:grid-cols-2" count={wallet.rules.length}>
            {wallet.rules.map((rule) => (
              <RevealItem key={rule.code} className="h-full">
                <RuleCard rule={rule} />
              </RevealItem>
            ))}
          </RevealList>
        )}
      </Section>

      <Section title={t('wallet.shopTitle')} hint={t('wallet.shopHint')}>
        <Row className="flex-wrap gap-2">
          <Button variant="primary" onClick={() => navigate('/market')}>
            <Store size={14} />
            {t('market.title')}
          </Button>
          <Chip tone="neutral" icon={Coins}>{t('wallet.shopItems', { count: wallet.catalog.length })}</Chip>
        </Row>
      </Section>

      {wallet.boosts.length > 0 ? (
        <Section title={t('wallet.activeBoosts')} hint={t('wallet.activeBoostsHint')}>
          <ul className="space-y-2">
            {wallet.boosts.map((boost) => (
              <li key={`${boost.strategyId}-${boost.endsAt}`} className="flex items-center justify-between gap-2 text-[13px]">
                <button
                  type="button"
                  className="no-drag min-w-0 flex-1 truncate text-left hover:text-brand"
                  onClick={() => navigate(`/strategy/${boost.strategyId}`)}
                >
                  {boost.strategyName}
                </button>
                <Chip tone="brand" icon={CalendarClock}>{formatDateTime(boost.endsAt)}</Chip>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section
        title={t('wallet.ledger')}
        hint={t('wallet.ledgerHint')}
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              value={ledgerFilter}
              onChange={setLedgerFilter}
              options={[
                { value: 'all', label: t('wallet.filterAll') },
                { value: 'earn', label: t('wallet.filterEarn') },
                { value: 'spend', label: t('wallet.filterSpend') }
              ]}
            />
            <div className="relative">
              <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
              <input
                className={cn(INPUT_CLASS, 'no-drag h-8 w-40 py-1 pl-7 text-xs')}
                placeholder={t('wallet.searchLedger')}
                value={ledgerQuery}
                onChange={(event) => setLedgerQuery(event.target.value)}
              />
            </div>
            <Button size="sm" variant="ghost" onClick={copyLedger} disabled={ledger.length === 0}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? t('detail.copied') : t('wallet.copyLedger')}
            </Button>
          </div>
        }
      >
        {ledger.length === 0 ? (
          <StateEmpty icon={Coins} title={t('wallet.noEntries')} body={t('wallet.noEntriesHint')} />
        ) : (
          <div className="space-y-4">
            {ledgerGroups.map(([day, entries]) => (
              <div key={day}>
                <p className="hud-label mb-1.5">{day}</p>
                <ul className="space-y-1">
                  {entries.map((entry, index) => {
                    const kind = KIND_META[entry.kind]
                    const Icon = kind?.icon ?? Coins
                    return (
                      <li
                        key={`${String(entry.delta)}-${entry.at}-${String(index)}`}
                        className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-panel-soft/60"
                      >
                        <span
                          className={cn(
                            'grid size-7 shrink-0 place-items-center rounded-lg border',
                            entry.delta >= 0 ? 'border-good/30 bg-good/10 text-good' : 'border-line bg-panel-soft text-mute'
                          )}
                        >
                          <Icon size={13} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink">{kind ? t(kind.key) : readableCode(entry.kind)}</span>
                          <span className="block text-[10px] text-mute">{new Date(entry.at).toLocaleTimeString()}</span>
                        </span>
                        <CoinAmount value={entry.delta} signed tone={entry.delta >= 0 ? 'good' : 'danger'} size="sm" className="font-semibold" />
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
