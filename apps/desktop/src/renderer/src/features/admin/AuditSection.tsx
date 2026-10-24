import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Search, ShieldCheck } from 'lucide-react'
import { useT } from '../../i18n/use-t'
import { supabase } from '../../lib/supabase'
import { INPUT_CLASS, Row, cn } from '../../components/ui'
import { Chip, Section } from '../../components/ui/system'
import { StateEmpty, StateError, StateLoading } from '../../components/ui/states'
import { fetchAuditRows } from './admin-api'
import { useAdminAccess } from './admin-access'

/**
 * The audit log reads as a timeline of actions, not a JSON dump: what happened, who did it, and what
 * actually changed (field by field). The raw payload is one click away for the rare case that detail
 * matters, but the default view is meant to be read during an incident.
 */

const ACTION_LABELS: Record<string, string> = {
  review_approve: 'Strateji yayına alındı',
  review_reject: 'Strateji reddedildi',
  ban_member: 'Üye askıya alındı',
  unban_member: 'Üyenin askısı kaldırıldı',
  set_role: 'Üye rolü değiştirildi',
  set_flag: 'Özellik anahtarı değiştirildi',
  resolve_report: 'Şikayet kapatıldı',
  takedown: 'İçerik kaldırıldı',
  publish_version: 'Yeni sürüm yayınlandı'
}

const ENTITY_LABELS: Record<string, string> = {
  strategy: 'Strateji',
  profile: 'Üye',
  comment: 'Yorum',
  report: 'Şikayet',
  app_flag: 'Özellik anahtarı',
  catalog: 'Katalog',
  spend_catalog: 'Market ürünü'
}

/** Field names in the diff are data keys; these are the ones an operator sees daily. */
const FIELD_LABELS: Record<string, string> = {
  status: 'Durum',
  enabled: 'Açık',
  role: 'Rol',
  banned: 'Askıda',
  is_banned: 'Askıda',
  price: 'Fiyat',
  name: 'Ad',
  key: 'Anahtar',
  code: 'Kod',
  note: 'Not',
  theme_key: 'Tema',
  active_title: 'Unvan',
  frame_key: 'Çerçeve'
}

function humanAction(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[_-]+/g, ' ').replace(/^./, (char) => char.toLocaleUpperCase('tr'))
}

function humanEntity(entity: string): string {
  return ENTITY_LABELS[entity] ?? entity
}

function humanField(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/[_-]+/g, ' ')
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır'
  if (typeof value === 'string') return value.length > 48 ? `${value.slice(0, 48)}…` : value
  if (typeof value === 'number') return String(value)
  try {
    const text = JSON.stringify(value)
    return text.length > 48 ? `${text.slice(0, 48)}…` : text
  } catch {
    return '—'
  }
}

function diffOf(before: unknown, after: unknown): Array<{ key: string; from: string; to: string }> {
  const read = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const a = read(before)
  const b = read(after)
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const rows: Array<{ key: string; from: string; to: string }> = []
  for (const key of keys) {
    const from = renderValue(a[key])
    const to = renderValue(b[key])
    if (from !== to) rows.push({ key, from, to })
  }
  return rows
}

export function AuditSection(): ReactNode {
  const t = useT()
  const access = useAdminAccess()
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('all')

  const auditQuery = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: fetchAuditRows,
    enabled: supabase !== null && access.isAdmin,
    retry: false
  })

  const rows = auditQuery.data ?? []
  const actions = useMemo(() => [...new Set(rows.map((row) => row.action))].sort(), [rows])
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return rows
      .filter((row) => (action === 'all' ? true : row.action === action))
      .filter((row) =>
        needle.length === 0
          ? true
          : [row.action, row.entity, row.entity_id ?? '', row.profiles?.handle ?? '', JSON.stringify(row.after_data ?? {})]
              .join(' ')
              .toLocaleLowerCase()
              .includes(needle)
      )
  }, [rows, action, search])

  if (!access.isAdmin) {
    return <StateEmpty icon={ShieldCheck} title={t('admin.auditAdminOnly')} body={t('admin.auditAdminOnlyHint')} />
  }

  return (
    <Section
      title={t('admin.audit')}
      hint={t('admin.auditHint')}
      aside={
        <Row className="gap-2">
          <select className={cn(INPUT_CLASS, 'no-drag h-8 w-44 py-1 text-xs')} value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="all">{t('admin.allActions')}</option>
            {actions.map((value) => (
              <option key={value} value={value}>
                {humanAction(value)}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
            <input
              className={cn(INPUT_CLASS, 'no-drag h-8 w-48 py-1 pl-7 text-xs')}
              placeholder={t('admin.auditSearch')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </Row>
      }
    >
      {auditQuery.isPending ? <StateLoading count={5} /> : null}
      {auditQuery.isError ? <StateError detail={auditQuery.error.message} onRetry={() => void auditQuery.refetch()} busy={auditQuery.isFetching} /> : null}
      {auditQuery.data && visible.length === 0 ? <StateEmpty icon={ShieldCheck} title={t('admin.auditEmpty')} /> : null}

      {visible.length > 0 ? (
        <ol className="relative space-y-3 pl-5">
          <span aria-hidden className="absolute inset-y-1 left-[7px] w-px bg-line/70" />
          {visible.map((row) => {
            const diff = diffOf(row.before_data, row.after_data)
            return (
              <li key={row.id} className="relative">
                <span
                  aria-hidden
                  className="absolute -left-5 top-2 grid size-[15px] place-items-center rounded-full border border-brand/50 bg-base"
                >
                  <span className="size-1.5 rounded-full bg-brand" />
                </span>

                <div className="hud-panel px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-medium text-ink">{humanAction(row.action)}</p>
                    <Chip tone="neutral">{humanEntity(row.entity)}</Chip>
                    {row.profiles?.handle ? <Chip tone="brand">{`@${row.profiles.handle}`}</Chip> : null}
                    <span className="ml-auto hud-num text-[10px] text-mute">{new Date(row.created_at).toLocaleString()}</span>
                  </div>

                  {row.entity_id ? <p className="mt-0.5 truncate font-mono text-[10px] text-mute">{row.entity_id}</p> : null}

                  {diff.length > 0 ? (
                    <ul className="mt-2 space-y-1 border-t border-line/60 pt-2">
                      {diff.map((change) => (
                        <li key={change.key} className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="w-24 shrink-0 truncate text-mute">{humanField(change.key)}</span>
                          <span className="rounded bg-danger/10 px-1.5 py-0.5 font-mono text-[10px] text-danger/90 line-through">{change.from}</span>
                          <span className="text-mute">→</span>
                          <span className="inline-flex items-center gap-1 rounded bg-good/10 px-1.5 py-0.5 font-mono text-[10px] text-good">
                            <Check size={9} />
                            {change.to}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[11px] text-mute">{t('admin.auditNoDiff')}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      ) : null}
    </Section>
  )
}
