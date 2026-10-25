import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Check, Pencil, Plus, Search, Store, TrendingUp, Wallet } from 'lucide-react'
import { FRAME_SKINS, THEME_KEYS, cosmeticSlug, formatCoin, titleIsValid } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { supabase } from '../../lib/supabase'
import { Button, INPUT_CLASS, Row, cn } from '../../components/ui'
import { Chip, Metric, MetricGrid, Section, Segmented } from '../../components/ui/system'
import { StateEmpty, StateError, StateLoading } from '../../components/ui/states'
import { CoinAmount } from '../../components/brand/coin'
import { FrameSample } from '../../components/brand/frame'
import { fetchBadgeDefinitions } from './admin-api'

/**
 * The shop, editable end to end.
 *
 * Every kind has its own editor because the fields mean different things: a badge product must point
 * at a real badge code (otherwise the purchase pays and grants nothing), a theme at a registered
 * skin, a frame at a registered frame, and a title is text shown next to the name. Free text in
 * `ref_code` is exactly the bug this screen prevents.
 */

const adminCatalogRowSchema = z.object({
  sku: z.string(),
  kind: z.enum(['badge', 'theme', 'boost', 'cosmetic', 'title', 'frame', 'vip']),
  price: z.number().int(),
  refCode: z.string().nullable().default(null),
  durationHours: z.number().int().nullable().default(null),
  enabled: z.boolean(),
  sortOrder: z.number().int().default(100),
  nameTr: z.string().nullable().default(null),
  nameEn: z.string().nullable().default(null),
  descTr: z.string().nullable().default(null),
  descEn: z.string().nullable().default(null),
  perks: z.array(z.string()).default([]),
  tag: z.enum(['none', 'new', 'soon', 'vip', 'verified']).catch('none'),
  discountPercent: z.number().int().default(0),
  discountEndsAt: z.string().nullable().default(null),
  finalPrice: z.number().int().nullable().default(null),
  sales: z.number().int().default(0),
  revenue: z.number().int().default(0)
})

type AdminCatalogRow = z.infer<typeof adminCatalogRowSchema>
type Kind = AdminCatalogRow['kind']
type KindFilter = 'all' | Kind

interface Draft {
  sku: string
  kind: Kind
  price: string
  refCode: string
  durationHours: string
  sortOrder: string
  enabled: boolean
  nameTr: string
  nameEn: string
  descTr: string
  descEn: string
  perks: string
  tag: 'none' | 'new' | 'soon' | 'vip' | 'verified'
  discount: string
  discountEnds: string
}

const EMPTY_DRAFT: Draft = {
  sku: '',
  kind: 'theme',
  price: '0',
  refCode: '',
  durationHours: '',
  sortOrder: '100',
  enabled: true,
  nameTr: '',
  nameEn: '',
  descTr: '',
  descEn: '',
  perks: '',
  tag: 'none',
  discount: '0',
  discountEnds: ''
}

function toDraft(row: AdminCatalogRow): Draft {
  return {
    sku: row.sku,
    kind: row.kind,
    price: String(row.price),
    refCode: row.refCode ?? '',
    durationHours: row.durationHours === null ? '' : String(row.durationHours),
    sortOrder: String(row.sortOrder),
    enabled: row.enabled,
    nameTr: row.nameTr ?? '',
    nameEn: row.nameEn ?? '',
    descTr: row.descTr ?? '',
    descEn: row.descEn ?? '',
    perks: row.perks.join('\n'),
    tag: row.tag,
    discount: String(row.discountPercent),
    discountEnds: row.discountEndsAt ? new Date(row.discountEndsAt).toISOString().slice(0, 16) : ''
  }
}

const KIND_TONE: Record<Kind, 'brand' | 'warn' | 'good' | 'neutral'> = {
  theme: 'brand',
  boost: 'warn',
  badge: 'good',
  cosmetic: 'neutral',
  title: 'good',
  frame: 'brand',
  vip: 'warn'
}

export function MarketAdminSection(): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<KindFilter>('all')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const catalogQuery = useQuery({
    queryKey: ['admin', 'catalog'],
    queryFn: async () => {
      if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED')
      const { data, error } = await supabase.rpc('admin_catalog')
      if (error) throw new Error(error.message)
      return adminCatalogRowSchema.array().parse(data ?? [])
    },
    retry: 1
  })

  const badgesQuery = useQuery({ queryKey: ['admin', 'badge-defs'], queryFn: fetchBadgeDefinitions, retry: 1 })

  const save = useMutation({
    mutationFn: async (input: Draft) => {
      if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED')
      const perks = input.perks
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
      const { error } = await supabase.rpc('admin_upsert_catalog_item', {
        p_sku: input.sku.trim(),
        p_kind: input.kind,
        p_price: Number.parseInt(input.price, 10),
        p_ref_code: input.refCode.trim().length > 0 ? input.refCode.trim() : null,
        p_duration_hours: input.durationHours.trim().length > 0 ? Number.parseInt(input.durationHours, 10) : null,
        p_enabled: input.enabled,
        p_sort_order: Number.parseInt(input.sortOrder || '100', 10),
        p_name_tr: input.nameTr.trim() || null,
        p_name_en: input.nameEn.trim() || null,
        p_desc_tr: input.descTr.trim() || null,
        p_desc_en: input.descEn.trim() || null,
        p_perks: perks,
        p_discount_percent: Number.parseInt(input.discount || '0', 10) || 0,
        p_discount_ends_at: input.discountEnds.trim().length > 0 ? new Date(input.discountEnds).toISOString() : null,
        p_tag: input.tag
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      setFailure(null)
      setDraft(null)
      setIsNew(false)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const toggle = useMutation({
    mutationFn: async (input: { sku: string; enabled: boolean }) => {
      if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED')
      const { error } = await supabase.rpc('admin_set_catalog_enabled', { p_sku: input.sku, p_enabled: input.enabled })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      setFailure(null)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const rows = catalogQuery.data ?? []
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return rows
      .filter((row) => (filter === 'all' ? true : row.kind === filter))
      .filter((row) =>
        needle.length === 0
          ? true
          : [row.sku, row.nameTr ?? '', row.nameEn ?? '', row.refCode ?? ''].join(' ').toLocaleLowerCase().includes(needle)
      )
  }, [rows, filter, search])

  const totals = useMemo(
    () => ({
      products: rows.length,
      active: rows.filter((row) => row.enabled).length,
      sales: rows.reduce((sum, row) => sum + row.sales, 0),
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0)
    }),
    [rows]
  )

  // A product that grants nothing is worse than no product, so the save is blocked instead.
  const refProblem = (input: Draft): string | null => {
    const ref = input.refCode.trim()
    if (input.kind === 'badge') {
      if (ref.length === 0) return t('admin.refBadgeRequired')
      return (badgesQuery.data ?? []).some((badge) => badge.code === ref) ? null : t('admin.refBadgeUnknown')
    }
    if (input.kind === 'theme') return (THEME_KEYS as readonly string[]).includes(ref) ? null : t('admin.refThemeRequired')
    if (input.kind === 'frame') return FRAME_SKINS.some((frame) => frame.key === ref) ? null : t('admin.refFrameRequired')
    if (input.kind === 'title') return titleIsValid(input.nameTr) ? null : t('admin.refTitleRequired')
    return null
  }

  if (catalogQuery.isPending) return <StateLoading variant="cards" count={3} />
  if (catalogQuery.isError) {
    return <StateError detail={catalogQuery.error.message} onRetry={() => void catalogQuery.refetch()} busy={catalogQuery.isFetching} />
  }

  const problem = draft ? refProblem(draft) : null

  return (
    <div className="space-y-4">
      <MetricGrid columns={4}>
        <Metric index={0} icon={Store} label={t('admin.marketProducts')} value={String(totals.products)} hint={t('admin.marketProductsHint')} />
        <Metric index={1} icon={Check} label={t('admin.marketActive')} value={String(totals.active)} hint={t('admin.marketActiveHint')} />
        <Metric index={2} icon={TrendingUp} label={t('admin.marketSales')} value={String(totals.sales)} hint={t('admin.marketSalesHint')} />
        <Metric index={3} icon={Wallet} label={t('admin.marketRevenue')} value={<CoinAmount value={totals.revenue} size="md" />} hint={t('admin.marketRevenueHint')} />
      </MetricGrid>

      {failure ? <div className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">{failure}</div> : null}

      <Section
        title={t('admin.marketTitle')}
        hint={t('admin.marketHint')}
        aside={
          <Row className="gap-2">
            <div className="relative">
              <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
              <input
                className={cn(INPUT_CLASS, 'no-drag h-8 w-44 py-1 pl-7 text-xs')}
                placeholder={t('admin.search')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setDraft({ ...EMPTY_DRAFT })
                setIsNew(true)
              }}
            >
              <Plus size={13} />
              {t('admin.newProduct')}
            </Button>
          </Row>
        }
      >
        <div className="space-y-3">
          <Segmented
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('admin.all') },
              { value: 'theme', label: t('admin.kindTheme'), count: rows.filter((row) => row.kind === 'theme').length },
              { value: 'boost', label: t('admin.kindBoost'), count: rows.filter((row) => row.kind === 'boost').length },
              { value: 'badge', label: t('admin.kindBadge'), count: rows.filter((row) => row.kind === 'badge').length },
              { value: 'title', label: t('admin.kindTitle'), count: rows.filter((row) => row.kind === 'title').length },
              { value: 'frame', label: t('admin.kindFrame'), count: rows.filter((row) => row.kind === 'frame').length },
              { value: 'cosmetic', label: t('admin.kindCosmetic'), count: rows.filter((row) => row.kind === 'cosmetic').length },
              { value: 'vip', label: t('admin.kindVip'), count: rows.filter((row) => row.kind === 'vip').length }
            ]}
          />

          {visible.length === 0 ? (
            <StateEmpty icon={Store} title={t('admin.marketEmpty')} />
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[minmax(0,1fr)_80px_56px_76px_80px_44px_auto] items-center gap-3 border-b border-line/70 px-2 pb-1.5">
                  <span className="hud-label">{t('admin.colProduct')}</span>
                  <span className="hud-label text-right">{t('admin.colPrice')}</span>
                  <span className="hud-label text-right">{t('admin.colSales')}</span>
                  <span className="hud-label text-right">{t('admin.colStock')}</span>
                  <span className="hud-label text-right">{t('admin.colRevenue')}</span>
                  <span className="hud-label text-right">{t('admin.colOrder')}</span>
                  <span className="hud-label text-right">{t('admin.colActions')}</span>
                </div>

                <ul className="divide-y divide-line/60">
                  {visible.map((row) => (
                    <li
                      key={row.sku}
                      className="grid grid-cols-[minmax(0,1fr)_80px_56px_76px_80px_44px_auto] items-center gap-3 px-2 py-2 transition-colors hover:bg-panel-soft/40"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Chip tone={KIND_TONE[row.kind]}>{t(`admin.kind${row.kind.charAt(0).toUpperCase()}${row.kind.slice(1)}` as 'admin.kindTheme')}</Chip>
                          <span className={cn('min-w-0 truncate text-[13px] font-medium', row.enabled ? 'text-ink' : 'text-mute line-through')}>
                            {row.nameTr ?? row.sku}
                          </span>
                          {row.tag !== 'none' ? (
                            <Chip tone={row.tag === 'new' ? 'brand' : row.tag === 'vip' ? 'warn' : row.tag === 'verified' ? 'good' : 'neutral'}>
                              {row.tag === 'new'
                                ? t('market.tagNew')
                                : row.tag === 'vip'
                                  ? t('market.tagVip')
                                  : row.tag === 'verified'
                                    ? t('discover.verified')
                                    : row.tag === 'soon'
                                      ? t('market.tagSoon')
                                      : t('admin.tagNone')}
                            </Chip>
                          ) : null}
                          {row.discountPercent > 0 ? <Chip tone="warn">{`−%${String(row.discountPercent)}`}</Chip> : null}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-mute">
                          {row.sku}
                          {row.refCode ? ` · ${row.refCode}` : ''}
                          {row.durationHours ? ` · ${String(row.durationHours)} sa` : ''}
                        </p>
                      </div>
                      <span className="hud-num text-right text-[12px] text-ink">
                        {formatCoin(row.finalPrice ?? row.price)}
                        {row.discountPercent > 0 ? (
                          <span className="block text-[10px] text-mute line-through">{formatCoin(row.price)}</span>
                        ) : null}
                      </span>
                      <span className="hud-num text-right text-[12px] text-mute">{`${String(row.sales)}×`}</span>
                      <span className="text-right">
                        <Chip tone={row.enabled ? 'good' : 'neutral'}>{row.enabled ? t('admin.onSale') : t('admin.offSale')}</Chip>
                      </span>
                      <span className="hud-num text-right text-[12px] text-mute">{formatCoin(row.revenue)}</span>
                      <span className="hud-num text-right text-[11px] text-mute">{String(row.sortOrder)}</span>
                      <Row className="justify-end gap-1">
                        <Button size="sm" variant="subtle" onClick={() => { setDraft(toDraft(row)); setIsNew(false) }}>
                          <Pencil size={12} />
                          {t('admin.edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant={row.enabled ? 'ghost' : 'primary'}
                          busy={toggle.isPending && toggle.variables?.sku === row.sku}
                          onClick={() => toggle.mutate({ sku: row.sku, enabled: !row.enabled })}
                        >
                          {row.enabled ? t('admin.deactivate') : t('admin.activate')}
                        </Button>
                      </Row>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </Section>

      {draft ? (
        <Section
          title={isNew ? t('admin.newProduct') : `${t('admin.edit')}: ${draft.nameTr || draft.sku}`}
          hint={t('admin.marketFormHint')}
          aside={
            <Row className="gap-2">
              <Button size="sm" variant="subtle" onClick={() => { setDraft(null); setIsNew(false) }}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                busy={save.isPending}
                disabled={draft.sku.trim().length < 3 || Number.isNaN(Number.parseInt(draft.price, 10)) || problem !== null}
                onClick={() => save.mutate(draft)}
              >
                {t('common.save')}
              </Button>
            </Row>
          }
        >
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <label className="space-y-1">
                <span className="hud-label">{t('admin.fieldKind')}</span>
                <select
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  value={draft.kind}
                  onChange={(event) => setDraft({ ...draft, kind: event.target.value as Kind, refCode: '' })}
                >
                  <option value="theme">{t('admin.kindTheme')}</option>
                  <option value="boost">{t('admin.kindBoost')}</option>
                  <option value="badge">{t('admin.kindBadge')}</option>
                  <option value="title">{t('admin.kindTitle')}</option>
                  <option value="frame">{t('admin.kindFrame')}</option>
                  <option value="cosmetic">{t('admin.kindCosmetic')}</option>
                  <option value="vip">{t('admin.kindVip')}</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.fieldSku')}</span>
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-8 font-mono text-xs')}
                  value={draft.sku}
                  disabled={!isNew}
                  onChange={(event) => setDraft({ ...draft, sku: event.target.value.toLocaleLowerCase() })}
                />
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.fieldPrice')}</span>
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  inputMode="numeric"
                  value={draft.price}
                  onChange={(event) => setDraft({ ...draft, price: event.target.value })}
                />
              </label>
            </div>

            {/* Kind-specific editor: this is what makes a purchase actually deliver something. */}
            <div className="rounded-xl border border-brand/30 bg-brand/[0.05] p-3">
              {draft.kind === 'badge' ? (
                <label className="space-y-1">
                  <span className="hud-label">{t('admin.fieldBadge')}</span>
                  <select
                    className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                    value={draft.refCode}
                    onChange={(event) => {
                      const code = event.target.value
                      const badge = (badgesQuery.data ?? []).find((entry) => entry.code === code)
                      setDraft({
                        ...draft,
                        refCode: code,
                        nameTr: draft.nameTr || (badge ? `${badge.name_tr} rozeti` : ''),
                        nameEn: draft.nameEn || (badge ? `${badge.name_en ?? badge.name_tr} badge` : '')
                      })
                    }}
                  >
                    <option value="">{t('admin.pickBadge')}</option>
                    {(badgesQuery.data ?? []).map((badge) => (
                      <option key={badge.code} value={badge.code}>
                        {`${badge.name_tr} · ${badge.tier}`}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-mute">{t('admin.fieldBadgeHint')}</span>
                </label>
              ) : null}

              {draft.kind === 'theme' ? (
                <label className="space-y-1">
                  <span className="hud-label">{t('admin.fieldTheme')}</span>
                  <select
                    className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                    value={draft.refCode}
                    onChange={(event) => {
                      const key = event.target.value
                      setDraft({
                        ...draft,
                        refCode: key,
                        nameTr: draft.nameTr || key,
                        nameEn: draft.nameEn || key,
                        sku: isNew && key.length > 0 ? `theme_${key}` : draft.sku
                      })
                    }}
                  >
                    <option value="">{t('admin.pickTheme')}</option>
                    {THEME_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {draft.kind === 'frame' ? (
                <div className="space-y-1.5">
                  <span className="hud-label">{t('admin.fieldFrame')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {FRAME_SKINS.map((frame) => {
                      const active = draft.refCode === frame.key
                      return (
                        <button
                          key={frame.key}
                          type="button"
                          data-press
                          onClick={() =>
                            setDraft({
                              ...draft,
                              refCode: frame.key,
                              nameTr: draft.nameTr || frame.labelTr,
                              nameEn: draft.nameEn || frame.labelEn,
                              sku: isNew && draft.sku.length === 0 ? `frame_${frame.key}` : draft.sku
                            })
                          }
                          className={cn(
                            'no-drag flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors',
                            active ? 'border-brand bg-brand/15 text-ink' : 'border-line bg-base/40 text-mute hover:text-ink'
                          )}
                        >
                          <FrameSample value={frame.key} size="sm" className="shrink-0" />
                          {frame.labelTr}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {draft.kind === 'title' ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="hud-label">{t('admin.fieldTitleText')}</span>
                    <input
                      className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                      maxLength={24}
                      value={draft.nameTr}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          nameTr: event.target.value,
                          refCode: cosmeticSlug(event.target.value),
                          sku: isNew ? `title_${cosmeticSlug(event.target.value)}` : draft.sku
                        })
                      }
                    />
                    <span className="text-[10px] text-mute">{t('admin.fieldTitleHint', { count: draft.nameTr.trim().length })}</span>
                  </label>
                  <div className="space-y-1">
                    <span className="hud-label">{t('admin.fieldTitlePreview')}</span>
                    <div className="flex h-8 items-center gap-2 rounded-lg border border-line bg-base/50 px-2.5">
                      <span className="text-[13px] font-semibold text-ink">{draft.nameTr || '—'}</span>
                      <Chip tone="brand">{draft.nameTr || t('admin.kindTitle')}</Chip>
                    </div>
                  </div>
                </div>
              ) : null}

              {draft.kind === 'boost' ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="hud-label">{t('admin.fieldDuration')}</span>
                    <input
                      className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                      inputMode="numeric"
                      value={draft.durationHours}
                      onChange={(event) => setDraft({ ...draft, durationHours: event.target.value })}
                    />
                  </label>
                  <p className="self-end text-[10px] leading-relaxed text-mute">{t('admin.fieldDurationHint')}</p>
                </div>
              ) : null}

              {draft.kind === 'vip' ? (
                <p className="text-[11px] leading-relaxed text-mute">{t('admin.vipHint')}</p>
              ) : null}

              {draft.kind === 'cosmetic' ? <p className="text-[11px] text-mute">{t('admin.fieldCosmeticHint')}</p> : null}

              {problem ? <p className="mt-2 text-[11px] text-warn">{problem}</p> : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1">
                <span className="hud-label">{t('admin.fieldDiscount')}</span>
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  inputMode="numeric"
                  disabled={draft.kind === 'boost'}
                  value={draft.kind === 'boost' ? '0' : draft.discount}
                  onChange={(event) => setDraft({ ...draft, discount: event.target.value })}
                />
                <span className="text-[10px] text-mute">{draft.kind === 'boost' ? t('admin.discountBoostLocked') : t('admin.fieldDiscountHint')}</span>
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.fieldDiscountEnds')}</span>
                <input
                  type="datetime-local"
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  disabled={draft.kind === 'boost'}
                  value={draft.discountEnds}
                  onChange={(event) => setDraft({ ...draft, discountEnds: event.target.value })}
                />
                <span className="text-[10px] text-mute">{t('admin.fieldDiscountEndsHint')}</span>
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.fieldTag')}</span>
                <select
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  value={draft.tag}
                  onChange={(event) => setDraft({ ...draft, tag: event.target.value as Draft['tag'] })}
                >
                  <option value="none">{t('admin.tagNone')}</option>
                  <option value="new">{t('market.tagNew')}</option>
                  <option value="soon">{t('market.tagSoon')}</option>
                  <option value="vip">{t('market.tagVip')}</option>
                  {/* A benefit tag is the till's deny list: it can never be bought off the shelf. */}
                  <option value="verified">{t('discover.verified')}</option>
                </select>
                <span className="text-[10px] text-mute">{t('admin.fieldTagHint')}</span>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <label className="space-y-1">
                <span className="hud-label">{t('admin.fieldNameTr')}</span>
                <input className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')} value={draft.nameTr} onChange={(event) => setDraft({ ...draft, nameTr: event.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.fieldNameEn')}</span>
                <input className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')} value={draft.nameEn} onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="hud-label">{t('admin.fieldOrder')}</span>
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-8 text-xs')}
                  inputMode="numeric"
                  value={draft.sortOrder}
                  onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })}
                />
              </label>
              <label className="flex items-end gap-2 pb-1">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-brand)]"
                  checked={draft.enabled}
                  onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                />
                <span className="text-[12px] text-ink">{t('admin.fieldEnabled')}</span>
              </label>
              <label className="space-y-1 sm:col-span-2 xl:col-span-3">
                <span className="hud-label">{t('admin.fieldDescTr')}</span>
                <textarea className={cn(INPUT_CLASS, 'no-drag text-xs')} rows={2} value={draft.descTr} onChange={(event) => setDraft({ ...draft, descTr: event.target.value })} />
              </label>
              <label className="space-y-1 sm:col-span-2 xl:col-span-3">
                <span className="hud-label">{t('admin.fieldDescEn')}</span>
                <textarea className={cn(INPUT_CLASS, 'no-drag text-xs')} rows={2} value={draft.descEn} onChange={(event) => setDraft({ ...draft, descEn: event.target.value })} />
              </label>
              <label className="space-y-1 sm:col-span-2 xl:col-span-3">
                <span className="hud-label">{t('admin.fieldPerks')}</span>
                <textarea className={cn(INPUT_CLASS, 'no-drag text-xs')} rows={3} value={draft.perks} onChange={(event) => setDraft({ ...draft, perks: event.target.value })} />
                <span className="text-[10px] text-mute">{t('admin.fieldPerksHint')}</span>
              </label>
            </div>
          </div>
        </Section>
      ) : null}
    </div>
  )
}
