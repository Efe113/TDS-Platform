import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import {
  Activity,
  Ban,
  CircleDollarSign,
  Coins,
  Flag,
  Search,
  ShieldCheck,
  Store,
  Users
} from 'lucide-react'
import { useT } from '../../i18n/use-t'
import { supabase } from '../../lib/supabase'
import { Button, INPUT_CLASS, Row, Toggle, cn } from '../../components/ui'
import { Chip, Metric, MetricGrid, Section, Segmented } from '../../components/ui/system'
import { StateEmpty, StateError, StateLoading } from '../../components/ui/states'
import { CoinAmount } from '../../components/brand/coin'
import { fetchMaintenanceFlag, setMaintenance } from './admin-api'
import { relativeTime } from '../../lib/text'

/**
 * Two operational screens the console was missing: the platform at a glance, and the people behind it.
 * Both read one RPC each, so a moderation action and the number next to it never disagree.
 */

const healthSchema = z.object({
  queueDepth: z.number().int().default(0),
  openReports: z.number().int().default(0),
  unmatchedLabels: z.number().int().default(0),
  members: z.number().int().default(0),
  bannedMembers: z.number().int().default(0),
  newMembers7d: z.number().int().default(0),
  sales24h: z.number().int().default(0),
  revenue24h: z.number().int().default(0),
  earned24h: z.number().int().default(0),
  runs24h: z.number().int().default(0),
  qualified7d: z.number().int().default(0),
  lastImportAt: z.string().nullable().default(null),
  lastPublishedAt: z.string().nullable().default(null),
  activeFlags: z.array(z.object({ key: z.string(), value: z.unknown() })).default([])
})

const userRowSchema = z.object({
  userId: z.string().uuid(),
  handle: z.string(),
  displayName: z.string().nullable().default(null),
  role: z.string(),
  banned: z.boolean(),
  joinedAt: z.string(),
  balance: z.number().int().default(0),
  published: z.number().int().default(0),
  runs: z.number().int().default(0)
})

const ledgerRowSchema = z.object({
  id: z.number(),
  handle: z.string().nullable().default(null),
  userId: z.string().uuid(),
  delta: z.number().int(),
  kind: z.string(),
  ruleCode: z.string().nullable().default(null),
  refType: z.string().nullable().default(null),
  at: z.string()
})

function flagEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'object' && value !== null && 'enabled' in value) {
    return (value as { enabled?: unknown }).enabled === true
  }
  return false
}

export function HealthSection(): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()
  const [ledgerQuery, setLedgerQuery] = useState('')
  const [ledgerKind, setLedgerKind] = useState<'all' | 'usage' | 'spend' | 'badge'>('all')

  const healthQuery = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: async () => {
      if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED')
      const { data, error } = await supabase.rpc('admin_health')
      if (error) throw new Error(error.message)
      return healthSchema.parse(data ?? {})
    },
    refetchInterval: 30_000,
    retry: 1
  })

  const ledgerQueryResult = useQuery({
    queryKey: ['admin', 'ledger', ledgerKind, ledgerQuery],
    queryFn: async () => {
      if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED')
      const { data, error } = await supabase.rpc('admin_ledger_search', {
        p_query: ledgerQuery.trim().length > 0 ? ledgerQuery.trim() : null,
        p_kind: ledgerKind === 'all' ? null : ledgerKind,
        p_limit: 30
      })
      if (error) throw new Error(error.message)
      return ledgerRowSchema.array().parse(data ?? [])
    },
    retry: 1
  })

  const maintenanceQuery = useQuery({ queryKey: ['admin', 'maintenance'], queryFn: fetchMaintenanceFlag, retry: 1 })
  const maintenance = useMutation({
    mutationFn: (on: boolean) => setMaintenance(on, null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'maintenance'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'health'] })
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
    }
  })

  const setFlag = useMutation({
    mutationFn: async (input: { key: string; enabled: boolean }) => {
      if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED')
      const { error } = await supabase.rpc('admin_set_flag', { p_key: input.key, p_enabled: input.enabled, p_note: null })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'health'] })
    }
  })

  const health = healthQuery.data
  const entries = ledgerQueryResult.data ?? []

  if (healthQuery.isPending) return <StateLoading variant="cards" count={3} />
  if (healthQuery.isError || !health) {
    return <StateError detail={healthQuery.error?.message ?? null} onRetry={() => void healthQuery.refetch()} busy={healthQuery.isFetching} />
  }

  return (
    <div className="space-y-4">
      <MetricGrid columns={4}>
        <Metric index={0} icon={ShieldCheck} label={t('admin.healthQueue')} value={String(health.queueDepth)} hint={t('admin.healthQueueHint')} />
        <Metric index={1} icon={Flag} label={t('admin.healthReports')} value={String(health.openReports)} hint={t('admin.healthReportsHint')} />
        <Metric index={2} icon={Activity} label={t('admin.healthRuns')} value={String(health.runs24h)} hint={t('admin.healthRunsHint')} />
        <Metric index={3} icon={Users} label={t('admin.healthMembers')} value={String(health.members)} hint={t('admin.healthMembersHint', { count: health.newMembers7d })} />
        <Metric index={4} icon={Store} label={t('admin.healthSales')} value={String(health.sales24h)} hint={t('admin.healthSalesHint')} />
        <Metric index={5} icon={CircleDollarSign} label={t('admin.healthRevenue')} value={<CoinAmount value={health.revenue24h} size="md" />} hint={t('admin.healthRevenueHint')} />
        <Metric index={6} icon={Coins} label={t('admin.healthEarned')} value={<CoinAmount value={health.earned24h} size="md" tone="good" />} hint={t('admin.healthEarnedHint')} />
        <Metric index={7} icon={Activity} label={t('admin.healthQualified')} value={String(health.qualified7d)} hint={t('admin.healthQualifiedHint')} />
      </MetricGrid>

      <Section title={t('admin.maintenanceTitle')} hint={t('admin.maintenanceHint')}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line/70 bg-base/40 px-3 py-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
              {maintenanceQuery.data ? t('admin.maintenanceOn') : t('admin.maintenanceOff')}
              <Chip tone={maintenanceQuery.data ? 'warn' : 'good'}>{maintenanceQuery.data ? 'ON' : 'OFF'}</Chip>
            </p>
            <p className="text-[10px] leading-relaxed text-mute">{t('admin.maintenanceBody')}</p>
          </div>
          <Toggle
            checked={maintenanceQuery.data === true}
            onChange={(next) => maintenance.mutate(next)}
            label={maintenanceQuery.data ? t('admin.disable') : t('admin.enable')}
          />
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('admin.flagsTitle')} hint={t('admin.flagsHint')}>
          {health.activeFlags.length === 0 ? (
            <StateEmpty icon={Flag} title={t('admin.flagsEmpty')} />
          ) : (
            <ul className="space-y-1.5">
              {health.activeFlags.map((flag) => {
                const on = flagEnabled(flag.value)
                return (
                  <li key={flag.key} className="flex items-center justify-between gap-2 rounded-lg border border-line/70 bg-base/40 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px] text-ink">{flag.key}</p>
                      <p className="text-[10px] text-mute">{on ? t('admin.flagOn') : t('admin.flagOff')}</p>
                    </div>
                    <Button
                      size="sm"
                      variant={on ? 'ghost' : 'primary'}
                      busy={setFlag.isPending && setFlag.variables?.key === flag.key}
                      onClick={() => setFlag.mutate({ key: flag.key, enabled: !on })}
                    >
                      {on ? t('admin.disable') : t('admin.enable')}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="mt-3 space-y-1 border-t border-line/60 pt-2 text-[11px] text-mute">
            <p>{`${t('admin.lastImport')}: ${health.lastImportAt ? relativeTime(health.lastImportAt, 'tr') : '—'}`}</p>
            <p>{`${t('admin.lastPublish')}: ${health.lastPublishedAt ? relativeTime(health.lastPublishedAt, 'tr') : '—'}`}</p>
            <p>{`${t('admin.healthUnmatched')}: ${String(health.unmatchedLabels)}`}</p>
          </div>
        </Section>

        <Section
          title={t('admin.ledgerTitle')}
          hint={t('admin.ledgerHint')}
          aside={
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                size="sm"
                value={ledgerKind}
                onChange={setLedgerKind}
                options={[
                  { value: 'all', label: t('admin.all') },
                  { value: 'usage', label: t('admin.ledgerUsage') },
                  { value: 'spend', label: t('admin.ledgerSpend') },
                  { value: 'badge', label: t('admin.ledgerBadge') }
                ]}
              />
              <div className="relative">
                <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-8 w-40 py-1 pl-7 text-xs')}
                  placeholder={t('admin.search')}
                  value={ledgerQuery}
                  onChange={(event) => setLedgerQuery(event.target.value)}
                />
              </div>
            </div>
          }
        >
          {ledgerQueryResult.isPending ? (
            <StateLoading count={4} />
          ) : entries.length === 0 ? (
            <StateEmpty icon={Coins} title={t('admin.ledgerEmpty')} />
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-[11px] hover:bg-panel-soft/50">
                  <span className="hud-num w-16 shrink-0 truncate text-mute">{entry.handle ?? '—'}</span>
                  <span className="min-w-0 flex-1 truncate text-mute">{entry.ruleCode ?? entry.kind}</span>
                  <CoinAmount value={entry.delta} signed size="sm" tone={entry.delta >= 0 ? 'good' : 'danger'} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}

const ROLE_LABEL: Record<string, string> = { user: 'Üye', moderator: 'Moderatör', admin: 'Yönetici' }

export function UsersSection(): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', search],
    queryFn: async () => {
      if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED')
      const { data, error } = await supabase.rpc('admin_user_search', {
        p_query: search.trim().length > 0 ? search.trim() : null,
        p_limit: 40
      })
      if (error) throw new Error(error.message)
      return userRowSchema.array().parse(data ?? [])
    },
    retry: 1
  })

  const ban = useMutation({
    mutationFn: async (input: { userId: string; banned: boolean }) => {
      if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED')
      const { error } = await supabase.rpc('admin_set_user_ban', { p_user: input.userId, p_banned: input.banned })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
    onError: () => undefined
  })

  const role = useMutation({
    mutationFn: async (input: { userId: string; role: string }) => {
      if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED')
      const { error } = await supabase.rpc('admin_set_user_role', { p_user: input.userId, p_role: input.role })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
    onError: () => undefined
  })

  const rows = usersQuery.data ?? []
  const failure = ban.error ?? role.error

  return (
    <div className="space-y-4">
      <Section
        title={t('admin.users')}
        hint={t('admin.usersHint')}
        aside={
          <div className="relative">
            <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
            <input
              className={cn(INPUT_CLASS, 'no-drag h-8 w-52 py-1 pl-7 text-xs')}
              placeholder={t('admin.usersSearch')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        }
      >
        {failure ? (
          <div className="mb-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-danger">
            {failure instanceof Error ? failure.message : String(failure)}
          </div>
        ) : null}

        {usersQuery.isPending ? (
          <StateLoading count={5} />
        ) : usersQuery.isError ? (
          <StateError detail={usersQuery.error.message} onRetry={() => void usersQuery.refetch()} busy={usersQuery.isFetching} />
        ) : rows.length === 0 ? (
          <StateEmpty icon={Users} title={t('admin.usersEmpty')} />
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li key={row.userId} className="hud-panel flex flex-wrap items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-ink">
                    {row.displayName ?? row.handle}
                    {row.banned ? <Chip tone="danger" icon={Ban}>{t('admin.banned')}</Chip> : null}
                  </p>
                  <p className="truncate font-mono text-[10px] text-mute">{`@${row.handle}`}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-[11px] text-mute">
                  <span className="hud-num">{`${String(row.published)} ${t('admin.usersPublished')}`}</span>
                  <span className="hud-num">{`${String(row.runs)} ${t('admin.usersRuns')}`}</span>
                  <CoinAmount value={row.balance} size="sm" tone="mute" />
                  <Chip tone={row.role === 'admin' ? 'brand' : row.role === 'moderator' ? 'warn' : 'neutral'}>
                    {ROLE_LABEL[row.role] ?? row.role}
                  </Chip>
                </div>
                <Row className="gap-1">
                  <select
                    className={cn(INPUT_CLASS, 'no-drag h-7 w-28 py-0 text-[11px]')}
                    value={row.role}
                    disabled={role.isPending}
                    onChange={(event) => role.mutate({ userId: row.userId, role: event.target.value })}
                  >
                    <option value="user">{ROLE_LABEL.user}</option>
                    <option value="moderator">{ROLE_LABEL.moderator}</option>
                    <option value="admin">{ROLE_LABEL.admin}</option>
                  </select>
                  <Button
                    size="sm"
                    variant={row.banned ? 'ghost' : 'danger'}
                    busy={ban.isPending && ban.variables?.userId === row.userId}
                    onClick={() => ban.mutate({ userId: row.userId, banned: !row.banned })}
                  >
                    <Ban size={12} />
                    {row.banned ? t('admin.unban') : t('admin.ban')}
                  </Button>
                </Row>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
