import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Award,
  BadgeCheck,
  Bell,
  BellRing,
  Building2,
  Camera,
  Check,
  Clock3,
  Crown,
  Flame,
  Frame as FrameIcon,
  Lock,
  MonitorPlay as MonitorIcon,
  Percent,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Store,
  Tag,
  Wallet
} from 'lucide-react'
import { FRAME_SKINS, CORPORATE_BENEFITS, PROFILE_THEME_KEYS, profileThemeSkin, spendErrorKey, themeSkin, VERIFIED_BENEFITS, VIP_SKU, VIP_TITLE_REF, formatCoin, type ThemeKey, type WalletItem } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { useCatalogLanguage } from '../../lib/catalog-labels'
import { navigate } from '../../lib/router'
import { buyBoost, buySku, fetchProductWaitlist, fetchWallet, newPurchaseKey, selectTheme, toggleProductWaitlist } from '../../lib/wallet-api'
import { equipCosmetic, fetchShowcase } from '../../lib/profile-api'
import { skinRows, SKIN_NAME_KEYS } from '../../lib/skins'
import { showcaseQueryKey } from '../../lib/identity'
import { selectSignedIn, selectUserId, useAuth } from '../../store/auth-store'
import { CoinAmount, CoinIcon } from '../../components/brand/coin'
import { FrameSample, FrameVitrine } from '../../components/brand/frame'
import { TitleBadge } from '../../components/brand/title-badge'
import { ProfileThemeVitrine } from '../../components/brand/profile-theme'
import { Button, Banner, cn } from '../../components/ui'
import { Chip, PageHeader, Section } from '../../components/ui/system'
import { StateEmpty, StateError } from '../../components/ui/states'
import { ThemePreview } from '../../components/brand/theme-preview'
import { RevealItem, RevealList } from '../../motion/primitives/Reveal'
import { Menu, MenuContent, MenuItem, MenuSection, MenuTrigger } from '../../components/ui/menu'
import { SkeletonCard } from '../../motion/primitives/Shimmer'

/**
 * The storefront. Six shelves, each with the preview that belongs to it: a theme shows the real scene,
 * a frame shows the ring on an avatar, a title shows the label next to a name.
 *
 * Price is a pair, never a single number: `price` is the shelf price and `finalPrice` is what the
 * server will charge. A discount is therefore visible as a strike-through plus the real amount, and the
 * till applies the same helper - the card can never promise a price the server does not honour.
 */

type Shelf = 'theme' | 'boost' | 'badge' | 'title' | 'frame' | 'overlay' | 'cosmetic'

const SHELVES: Array<{ kind: Shelf; titleKey: MessageKey; hintKey: MessageKey; icon: typeof Store; columns: string }> = [
  { kind: 'theme', titleKey: 'market.themesTitle', hintKey: 'market.themesHint', icon: Sparkles, columns: 'sm:grid-cols-2 xl:grid-cols-4' },
  { kind: 'boost', titleKey: 'market.boostsTitle', hintKey: 'market.boostsHint', icon: Flame, columns: 'sm:grid-cols-2 xl:grid-cols-3' },
  { kind: 'badge', titleKey: 'market.badgesTitle', hintKey: 'market.badgesHint', icon: Award, columns: 'sm:grid-cols-2 xl:grid-cols-3' },
  { kind: 'title', titleKey: 'market.titlesTitle', hintKey: 'market.titlesHint', icon: Tag, columns: 'sm:grid-cols-2 xl:grid-cols-4' },
  { kind: 'frame', titleKey: 'market.framesTitle', hintKey: 'market.framesHint', icon: FrameIcon, columns: 'sm:grid-cols-2 xl:grid-cols-4' },
  { kind: 'overlay', titleKey: 'market.overlayTitle', hintKey: 'market.overlayHint', icon: MonitorIcon, columns: 'sm:grid-cols-2 xl:grid-cols-4' },
  { kind: 'cosmetic', titleKey: 'market.cosmeticsTitle', hintKey: 'market.cosmeticsHint', icon: Camera, columns: 'sm:grid-cols-2' }
]

function nameOf(item: WalletItem, language: string): string {
  return (language === 'en' ? item.nameEn : item.name) ?? item.name ?? item.sku
}

function descOf(item: WalletItem, language: string): string | null {
  return (language === 'en' ? item.descEn : item.desc) ?? item.desc ?? null
}

interface DiscountInfo {
  final: number
  cut: boolean
  percent: number
}

/** `finalPrice` already includes the product cut and the VIP tier cut, so derive from the pair. */
function discountInfo(item: WalletItem): DiscountInfo {
  const final = item.finalPrice ?? item.price
  const cut = final < item.price
  const percent = cut && item.price > 0 ? Math.max(1, Math.round((1 - final / item.price) * 100)) : 0
  return { final, cut, percent }
}

function DiscountBadge({ percent, className }: { percent: number; className?: string }): ReactNode {
  const t = useT()
  if (percent <= 0) return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-warn/45 bg-warn/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warn',
        className
      )}
    >
      <Percent size={9} />
      {t('market.discountTag')}
      <span className="hud-num text-ink/80">{`%${String(percent)}`}</span>
    </span>
  )
}

function PriceBlock({ item, large }: { item: WalletItem; large?: boolean }): ReactNode {
  const t = useT()
  const info = discountInfo(item)
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {info.cut ? (
        <CoinAmount
          value={item.price}
          size="sm"
          tone="mute"
          className="line-through decoration-warn/70 decoration-2"
        />
      ) : null}
      <CoinAmount
        value={info.final}
        size={large ? 'md' : 'sm'}
        tone={info.cut ? 'good' : 'brand'}
        className={cn('font-semibold', large && 'text-base')}
      />
      {item.discountPercent > 0 && item.discountEndsAt ? (
        <span className="hud-label text-warn/80">{t('market.discountUntil', { date: new Date(item.discountEndsAt).toLocaleDateString() })}</span>
      ) : null}
    </div>
  )
}

function TagChip({ tag }: { tag: WalletItem['tag'] }): ReactNode {
  const t = useT()
  if (tag === 'new') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-brand/50 bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-brand">
        <span className="size-1 rounded-full bg-brand" />
        {t('market.tagNew')}
      </span>
    )
  }
  if (tag === 'soon') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-mute/50 bg-panel-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-mute">
        <Clock3 size={9} />
        {t('market.tagSoon')}
      </span>
    )
  }
  if (tag === 'vip') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-300/50 bg-gradient-to-r from-pink-500/20 via-amber-300/20 to-cyan-400/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-200">
        <Crown size={9} />
        {t('market.tagVip')}
      </span>
    )
  }
  if (tag === 'verified') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-good/50 bg-good/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-good">
        <BadgeCheck size={9} />
        {t('discover.verified')}
      </span>
    )
  }
  if (tag === 'corporate') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-[#f2c14e]/55 bg-[#f2c14e]/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#f2c14e]">
        <Building2 size={9} />
        {t('discover.corporate')}
      </span>
    )
  }
  if (tag === 'renewed') {
    // Drawn, not re-shot: the chip carries the same travelling light as the renewed skin's seams.
    return (
      <span className="market-tag-renewed inline-flex items-center gap-1 rounded-md border border-warn/55 bg-warn/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-warn">
        <Flame size={9} />
        {t('market.tagRenewed')}
      </span>
    )
  }
  return null
}

/** A shelf card: preview on top, copy, price, action. The golden ring only appears on a real cut. */
function ProductCard({
  item,
  shelf,
  language,
  owned,
  equipped,
  busy,
  balance,
  onBuy,
  onEquip,
  onVip,
  queue,
  queueBusy,
  onQueue
}: {
  item: WalletItem
  shelf: Shelf
  language: string
  owned: boolean
  equipped: boolean
  busy: boolean
  balance: number
  onBuy: () => void
  onEquip?: () => void
  onVip?: () => void
  /** 0057: the queue for a product that is not on the shelf. `null` means the read failed or is absent. */
  queue?: { joined: boolean; demand: number } | null
  queueBusy?: boolean
  onQueue?: () => void
}): ReactNode {
  const t = useT()
  const info = discountInfo(item)
  const short = balance < info.final
  const sale = item.discountPercent > 0 && info.cut
  const soon = item.tag === 'soon'
  // 0042: `kind` is the truth and `tag` is only a chip. The membership is a product, so it must never
  // be painted as something a tier hands out — that is exactly how its price and buy button vanished.
  const isMembership = item.kind === 'vip'
  const vipOnly = item.tag === 'vip' && !isMembership
  // A benefit-tagged row never reaches the till, whether it belongs to VIP, verification or an
  // organisation (0040 keeps the list in one place with the SQL CHECK).
  const benefitOnly = !isMembership && (item.tag === 'vip' || item.tag === 'verified' || item.tag === 'corporate')

  return (
    <div
      className={cn(
        'hud-panel relative flex h-full flex-col gap-2 p-2.5',
        sale && 'market-discount',
        soon && 'opacity-80'
      )}
    >
      {sale ? <span aria-hidden className="market-discount-ring" /> : null}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <TagChip tag={item.tag} />
        </div>
        {owned ? <Chip tone="good" icon={Check}>{t('wallet.owned')}</Chip> : null}
      </div>

      {/* Kind-specific preview: this is what the buyer is actually looking at. */}
      {/* Kind-specific preview: this is what the buyer is actually looking at. A profile theme is sold
          as the five surfaces it stacks, listed by name, because the ring on a member's card is exactly
          those five and nothing else. */}
      {item.kind === 'cosmetic' && PROFILE_THEME_KEYS.includes(item.refCode ?? '') ? (
        <ProfileThemeVitrine
          skin={profileThemeSkin(item.refCode)}
          language={language === 'en' ? 'en' : 'tr'}
          className="rounded-lg border border-line/70 bg-base/50 p-2"
        />
      ) : null}

      {item.kind === 'frame' ? (
        <FrameVitrine value={item.refCode} language={language === 'en' ? 'en' : 'tr'} />
      ) : null}

      {item.kind === 'title' ? (
        <div className="relative flex min-h-14 items-center justify-center overflow-hidden rounded-lg border border-line/70 bg-base/50 px-3 py-3">
          <span
            aria-hidden
            className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-brand/70 to-transparent"
          />
          <span
            aria-hidden
            className="absolute inset-0 opacity-60"
            style={{ background: 'radial-gradient(ellipse at 50% 130%, color-mix(in oklab, var(--color-brand) 22%, transparent), transparent 62%)' }}
          />
          <TitleBadge
            className="relative"
            label={item.name ?? item.refCode ?? ''}
            refCode={item.refCode}
            size="md"
          />
        </div>
      ) : null}

      {item.kind === 'badge' ? (
        <div className="flex items-center gap-2 rounded-lg border border-line/70 bg-base/50 px-2.5 py-2">
          <span className="grid size-8 place-items-center rounded-lg border border-good/35 bg-good/12 text-good">
            <BadgeCheck size={14} />
          </span>
          <span className="text-[11px] text-mute">{t('market.badgePreview')}</span>
        </div>
      ) : null}

      {shelf === 'overlay' ? (
        <div className="relative flex items-center justify-center overflow-hidden rounded-lg border border-line/70 bg-base/60 py-2.5">
          <span
            aria-hidden
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'linear-gradient(to right, color-mix(in oklab, var(--color-line) 70%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--color-line) 70%, transparent) 1px, transparent 1px)',
              backgroundSize: '14px 14px'
            }}
          />
          <div
            className={cn(
              'relative w-28 rounded-md border bg-panel/95 p-1.5',
              item.refCode === 'overlay_glow' ? 'border-brand/70 shadow-[0_0_18px_-4px] shadow-brand/70' : 'border-brand/30'
            )}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="truncate font-mono text-[9px] text-brand">19/32</span>
              {item.refCode === 'overlay_counter' ? (
                <span className="rounded border border-brand/40 bg-brand/15 px-1 font-mono text-[8px] text-brand">19/32</span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[9px] font-semibold text-ink">{t('market.overlayPreviewAction')}</p>
            <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-line">
              <div className="h-full w-3/5 rounded-full bg-brand" />
            </div>
            {item.refCode === 'overlay_scan' ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-md"
                style={{ background: 'repeating-linear-gradient(0deg, color-mix(in oklab, var(--color-brand) 14%, transparent) 0 1px, transparent 1px 3px)' }}
              />
            ) : null}
          </div>
          <span className="absolute bottom-1 right-1.5 flex items-center gap-1 text-[9px] text-mute">
            {item.refCode === 'overlay_scan' ? <ScanLine size={9} /> : <MonitorIcon size={9} />}
            {t('market.overlayBadge')}
          </span>
        </div>
      ) : null}

      {shelf === 'cosmetic' ? (
        <div className="flex items-center gap-2 rounded-lg border border-line/70 bg-base/50 px-2.5 py-2">
          <span className="grid size-8 place-items-center rounded-lg border border-brand/30 bg-brand/12 text-brand">
            <Camera size={14} />
          </span>
          <span className="text-[11px] text-mute">{t('market.cosmeticPreview')}</span>
        </div>
      ) : null}

      <div className="min-w-0">
        <p className="break-words text-[13px] leading-snug font-semibold text-ink">{nameOf(item, language)}</p>
        {descOf(item, language) ? <p className="mt-0.5 text-[11px] leading-relaxed text-mute">{descOf(item, language)}</p> : null}
      </div>

      {item.perks.length > 0 ? (
        <ul className="space-y-0.5">
          {item.perks.slice(0, 3).map((perk) => (
            <li key={perk} className="flex items-start gap-1.5 text-[10px] leading-snug text-mute">
              <Check size={10} className="mt-0.5 shrink-0 text-good" />
              <span>{perk}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-auto space-y-2 border-t border-line/60 pt-2">
        {info.cut ? <DiscountBadge percent={info.percent} /> : null}
        {vipOnly ? (
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-200/90">
            <Crown size={11} />
            {t('market.vipOnly')}
          </p>
        ) : benefitOnly ? (
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-good">
            <ShieldCheck size={11} />
            {t('verified.creditHint')}
          </p>
        ) : (
          <PriceBlock item={item} />
        )}
        {soon ? (
          !onQueue || queue === null || queue === undefined ? (
            <Button size="sm" variant="ghost" disabled className="w-full">
              <Lock size={12} />
              {t('market.comingSoon')}
            </Button>
          ) : (
            <div className="space-y-1">
              <Button
                size="sm"
                variant={queue.joined ? 'primary' : 'ghost'}
                busy={queueBusy === true}
                className="w-full"
                title={queue.joined ? t('market.leaveQueue') : t('market.queueNote')}
                onClick={onQueue}
              >
                {queue.joined ? <BellRing size={12} /> : <Bell size={12} />}
                {queue.joined ? t('market.joinedQueue') : t('market.joinQueue')}
              </Button>
              <p className="text-[10px] leading-snug text-mute">
                {queue.demand > 0 ? t('market.queueDemand', { count: String(queue.demand) }) : t('market.queueEmpty')}
              </p>
            </div>
          )
        ) : vipOnly && !owned ? (
          <Button size="sm" variant="primary" disabled={!onVip} onClick={onVip}>
            <Crown size={13} />
            {t('market.vipCta')}
          </Button>
        ) : benefitOnly && !owned ? (
          <Button size="sm" variant="ghost" disabled className="w-full">
            <ShieldCheck size={12} />
            {t('discover.verified')}
          </Button>
        ) : owned && onEquip ? (
          equipped ? (
            <Chip tone="good" icon={Check}>{t('market.equipped')}</Chip>
          ) : (
            <Button size="sm" variant="primary" busy={busy} onClick={onEquip}>
              {t('market.equip')}
            </Button>
          )
        ) : owned ? (
          <Chip tone="good" icon={Check}>{t('wallet.owned')}</Chip>
        ) : (
          <Button
            size="sm"
            variant={short ? 'danger' : 'primary'}
            busy={busy}
            disabled={short}
            title={short ? t('market.insufficientHint', { need: formatCoin(info.final - balance) }) : undefined}
            onClick={onBuy}
          >
            {short ? t('market.insufficient') : t('wallet.buy')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** The VIP shelf is not a card in a row: it is the one purchase that changes what the account can do. */
function VipPanel({
  item,
  active,
  language,
  balance,
  busy,
  onBuy,
  onEdit
}: {
  item: WalletItem
  /** Membership is an entitlement (`app.vip_active`), not this one SKU's receipt. */
  active: boolean
  language: string
  balance: number
  busy: boolean
  onBuy: () => void
  onEdit: () => void
}): ReactNode {
  const t = useT()
  const info = discountInfo(item)
  const price = info.final
  const short = balance < price

  return (
    <section id="market-vip" className="hud-panel relative scroll-mt-20 overflow-hidden p-4">
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, #ff5f6d, #ffc371, #7bd88f, #4cc9f0, #a78bfa, transparent)' }}
      />
      <span
        aria-hidden
        className="absolute -top-16 -right-10 size-56 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(167, 139, 250, 0.24), transparent 66%)' }}
      />
      <span
        aria-hidden
        className="absolute -bottom-20 -left-10 size-48 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(255, 95, 109, 0.16), transparent 66%)' }}
      />

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid size-9 place-items-center rounded-lg border border-amber-300/40 bg-gradient-to-br from-pink-500/20 via-amber-300/15 to-cyan-400/20 text-amber-200">
              <Crown size={16} />
            </span>
            <div className="min-w-0">
              <p className="hud-label text-amber-200/80">{t('market.vipEyebrow')}</p>
              <h2 className="break-words text-[15px] font-semibold text-ink">
                {nameOf(item, language) || t('market.vipTitleFallback')}
              </h2>
            </div>
            <TagChip tag={item.tag} />
            {active ? <Chip tone="good" icon={Check}>{t('market.vipActive')}</Chip> : null}
          </div>

          <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-mute">
            {descOf(item, language) ?? t('market.vipBodyFallback')}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="hud-label text-mute">{t('market.vipTitlePerk')}</span>
            <TitleBadge label={t('market.vipTitleLabel')} refCode={VIP_TITLE_REF} size="sm" />
          </div>

          {item.perks.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {item.perks.slice(0, 4).map((perk) => (
                <li key={perk}>
                  <Chip tone="neutral">{perk}</Chip>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
          <FrameSample value="rainbow" size="lg" />
          {active ? (
            <div className="space-y-1.5 text-right">
              <p className="text-[11px] font-medium text-good">{t('market.vipActiveHint')}</p>
              <Button size="sm" variant="subtle" onClick={onEdit}>
                {t('market.openProfile')}
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5 text-right">
              {info.cut ? <DiscountBadge percent={info.percent} /> : null}
              <div className="flex items-baseline justify-end gap-1.5">
                {info.cut ? (
                  <CoinAmount value={item.price} size="sm" tone="mute" className="line-through decoration-warn/70" />
                ) : null}
                <CoinAmount value={price} size="md" tone={info.cut ? 'good' : 'brand'} />
                <span className="text-[10px] text-mute">{t('market.vipPermanent')}</span>
              </div>
              <Button
                size="sm"
                variant={short ? 'danger' : 'primary'}
                busy={busy}
                disabled={short}
                title={short ? t('market.insufficientHint', { need: formatCoin(info.final - balance) }) : undefined}
                onClick={onBuy}
              >
                <Crown size={13} />
                {short ? t('market.insufficient') : t('market.vipCta')}
              </Button>
              {short ? (
                <p className="text-[10px] text-mute">{t('market.insufficientHint', { need: formatCoin(info.final - balance) })}</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export function MarketPage(): ReactNode {
  const t = useT()
  const language = useCatalogLanguage()
  const queryClient = useQueryClient()
  const signedIn = useAuth(selectSignedIn)
  const userId = useAuth(selectUserId)
  const [failure, setFailure] = useState<string | null>(null)

  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: fetchWallet, enabled: signedIn, retry: 1 })
  const wallet = walletQuery.data
  const myProfile = useQuery({
    queryKey: showcaseQueryKey(userId),
    queryFn: () => fetchShowcase(userId ?? ''),
    enabled: signedIn && userId !== null,
    retry: 1
  })

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['wallet'] })
    void queryClient.invalidateQueries({ queryKey: ['strategy'] })
    void queryClient.invalidateQueries({ queryKey: ['discover'] })
    void queryClient.invalidateQueries({ queryKey: showcaseQueryKey(userId) })
  }

  const purchase = useMutation({
    mutationFn: (sku: string) => buySku(sku, newPurchaseKey()),
    onSuccess: () => {
      setFailure(null)
      refresh()
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const boost = useMutation({
    mutationFn: (input: { strategyId: string; sku: string }) => buyBoost(input.strategyId, input.sku, newPurchaseKey()),
    onSuccess: () => {
      setFailure(null)
      refresh()
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const themeUse = useMutation({
    mutationFn: (key: ThemeKey) => selectTheme(key),
    onSuccess: () => {
      setFailure(null)
      refresh()
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  // 0057: the queue in front of a product that is not on the shelf yet. If the read does not answer —
  // a database that has not run the migration, for instance — the card keeps its locked button instead
  // of promising a queue that would only error.
  const waitlistQuery = useQuery({
    queryKey: ['product', 'waitlist'],
    queryFn: fetchProductWaitlist,
    enabled: signedIn,
    retry: 1,
    staleTime: 60_000
  })
  const waitlist = useMemo(
    () => new Map((waitlistQuery.data ?? []).map((row) => [row.sku, { joined: row.joined, demand: row.demand }])),
    [waitlistQuery.data]
  )

  const queue = useMutation({
    mutationFn: (input: { sku: string; joined: boolean }) => toggleProductWaitlist(input.sku, input.joined),
    onSuccess: () => {
      setFailure(null)
      void queryClient.invalidateQueries({ queryKey: ['product', 'waitlist'] })
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const equip = useMutation({
    mutationFn: (input: { kind: 'title' | 'frame'; ref: string | null }) => equipCosmetic(input.kind, input.ref),
    onSuccess: () => {
      setFailure(null)
      refresh()
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const items = wallet?.catalog ?? []
  const vipItem = items.find((item) => item.sku === VIP_SKU) ?? items.find((item) => item.kind === 'vip') ?? null
  // `wallet.vip` is the authoritative entitlement; the SKU-level `owned` flag only ever looked at one
  // receipt, which is how a member ended up with a live "VIP ol" button the till refused.
  const vipOwned = Boolean(wallet?.vip) || (vipItem?.owned ?? false)
  const byKind = useMemo(() => {
    const map = new Map<Shelf, WalletItem[]>()
    for (const shelf of SHELVES) map.set(shelf.kind, [])
    for (const item of items) {
      const shelf: Shelf = item.kind === 'cosmetic' && (item.refCode ?? '').startsWith('overlay_') ? 'overlay' : (item.kind as Shelf)
      const list = map.get(shelf)
      if (list) list.push(item)
    }
    for (const shelf of SHELVES) {
      const list = map.get(shelf.kind) ?? []
      if (shelf.kind === 'boost') list.sort((a, b) => (a.durationHours ?? 0) - (b.durationHours ?? 0))
      map.set(shelf.kind, list)
    }
    return map
  }, [items])

  const themeRows = useMemo(() => skinRows(items), [items])
  const myStrategies = myProfile.data?.strategies ?? []
  const discountedCount = items.filter((item) => item.discountPercent > 0).length

  if (!signedIn) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('market.title')} subtitle={t('market.subtitle')} />
        <StateEmpty
          icon={Store}
          title={t('market.signedOut')}
          action={
            <Button size="sm" variant="primary" onClick={() => navigate('/account')}>
              {t('auth.signIn')}
            </Button>
          }
        />
      </div>
    )
  }

  if (walletQuery.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('market.title')} subtitle={t('market.subtitle')} />
        <SkeletonCard lines={3} />
      </div>
    )
  }

  if (!wallet) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('market.title')} subtitle={t('market.subtitle')} />
        <StateError detail={walletQuery.error?.message ?? null} onRetry={() => void walletQuery.refetch()} busy={walletQuery.isFetching} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('market.title')}
        subtitle={t('market.subtitle')}
        badges={
          <>
            <Chip tone="brand" icon={Store}>{t('market.catalogCount', { count: items.length })}</Chip>
            {vipOwned ? <Chip tone="warn" icon={Crown}>{t('market.vipDiscount', { percent: 25 })}</Chip> : null}
            {wallet.verified ? (
              <Chip tone={wallet.corporate ? 'warn' : 'good'} icon={wallet.corporate ? Building2 : BadgeCheck}>
                {t('verified.discountTitle')} %{String(wallet.corporate ? CORPORATE_BENEFITS.discountPercent : VERIFIED_BENEFITS.discountPercent)}
              </Chip>
            ) : null}
            {discountedCount > 0 ? <Chip tone="warn" icon={Tag}>{t('market.discountCount', { count: discountedCount })}</Chip> : null}
          </>
        }
        actions={
          <>
            <Chip tone="neutral" icon={Wallet}>
              <span className="hud-num">{formatCoin(wallet.balance)}</span>
            </Chip>
            <Button size="sm" variant="ghost" onClick={() => navigate('/wallet')}>
              {t('market.openWallet')}
            </Button>
          </>
        }
      />

      {failure ? (
        <Banner tone="danger" title={t('common.errorTitle')}>
          {t(spendErrorKey(failure))}
          {spendErrorKey(failure) === 'wallet.errGeneric' ? <p className="mt-1 break-words text-[11px] text-mute">{failure}</p> : null}
        </Banner>
      ) : null}

      {/* The tier strip answers "why is this price what it is" before the shelves start. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line/60 bg-base/40 px-3 py-2 text-[11px]">
        {wallet.corporate ? (
          <>
            {/* Corporate is the superset tier, so it wins the strip and prices at 20% instead of 10%. */}
            <Chip tone="warn" icon={Building2}>{t('corporate.youAre')}</Chip>
            <span className="min-w-0 flex-1 break-words text-mute">
              {wallet.corporateDiscountEndsAt
                ? t('verified.discountActive', {
                    percent: String(CORPORATE_BENEFITS.discountPercent),
                    date: new Date(wallet.corporateDiscountEndsAt).toLocaleDateString()
                  })
                : t('corporate.discountEnded')}
            </span>
            <span className="flex items-center gap-1 text-ink/80">
              <Flame size={12} className="text-warn" />
              {wallet.verifiedBoostCredits > 0
                ? t('verified.creditCount', { count: String(wallet.verifiedBoostCredits) })
                : t('verified.creditNone')}
            </span>
          </>
        ) : wallet.verified ? (
          <>
            <Chip tone="good" icon={BadgeCheck}>{t('verified.youAre')}</Chip>
            <span className="min-w-0 flex-1 break-words text-mute">
              {wallet.verifiedDiscountEndsAt
                ? t('verified.discountActive', {
                    percent: String(VERIFIED_BENEFITS.discountPercent),
                    date: new Date(wallet.verifiedDiscountEndsAt).toLocaleDateString()
                  })
                : t('verified.discountEnded')}
            </span>
            <span className="flex items-center gap-1 text-ink/80">
              <Flame size={12} className="text-warn" />
              {wallet.verifiedBoostCredits > 0
                ? t('verified.creditCount', { count: String(wallet.verifiedBoostCredits) })
                : t('verified.creditNone')}
            </span>
          </>
        ) : (
          <>
            <Chip tone="neutral" icon={ShieldCheck}>{t('verified.title')}</Chip>
            <span className="min-w-0 flex-1 break-words text-mute">{t('verified.perkDiscount')}</span>
            <Button size="sm" variant="ghost" onClick={() => navigate('/verified')}>
              {t('verified.applyTitle')}
            </Button>
          </>
        )}
      </div>

      {vipItem ? (
        <VipPanel
          item={vipItem}
          active={wallet.vip || vipItem.owned}
          language={language}
          balance={wallet.balance}
          busy={purchase.isPending && purchase.variables === vipItem.sku}
          onBuy={() => purchase.mutate(vipItem.sku)}
          onEdit={() => navigate('/profile')}
        />
      ) : null}

      {/* Themes come first: they are the only product that changes the whole app. */}
      <Section title={t('market.themesTitle')} hint={t('market.themesHint')}>
        <RevealList className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4" count={themeRows.length}>
          {themeRows.map((row) => {
            const item = byKind.get('theme')?.find((entry) => entry.refCode === row.key) ?? null
            const active = wallet.theme === row.key
            // The registry is the truth about how deep a skin goes, so the shelf can say it instead of
            // implying it: a renewed skin shows its whole layer stack and its full change list.
            const skin = themeSkin(row.key)
            const perkCount = skin.renewed ? 5 : 3
            const info = item ? discountInfo(item) : null
            const themePrice = item ? (info?.final ?? item.finalPrice ?? item.price) : 0
            const sale = Boolean(item && info?.cut && item.discountPercent > 0)
            return (
              <RevealItem key={row.key} className="h-full">
                <div className={cn('hud-panel flex h-full flex-col gap-2 p-2.5', active && 'ring-1 ring-inset ring-brand/50', sale && 'market-discount')}>
                  {sale ? <span aria-hidden className="market-discount-ring" /> : null}
                  <div className="flex items-center justify-between gap-1">
                    <TagChip tag={item?.tag ?? 'none'} />
                    {skin.renewed ? (
                      <Chip tone="warn" icon={Flame}>{t('market.renewedLayers', { count: skin.layers.length })}</Chip>
                    ) : null}
                  </div>
                  <ThemePreview value={row.key} active={active} detailed />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink">{item ? nameOf(item, language) : t(SKIN_NAME_KEYS[row.key])}</p>
                    {item && descOf(item, language) ? <p className="mt-0.5 text-[11px] leading-relaxed text-mute">{descOf(item, language)}</p> : null}
                  </div>
                  {item && item.perks.length > 0 ? (
                    <ul className="space-y-0.5">
                      {item.perks.slice(0, perkCount).map((perk) => (
                        <li key={perk} className="flex items-start gap-1.5 text-[10px] text-mute">
                          <Check size={10} className="mt-0.5 shrink-0 text-good" />
                          <span>{perk}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-auto space-y-2 border-t border-line/60 pt-2">
                    {info?.cut ? <DiscountBadge percent={info.percent} /> : null}
                    {item ? <PriceBlock item={item} /> : <span className="text-[11px] text-mute">{t('theme.free')}</span>}
                    {item?.tag === 'soon' ? (
                      <Button size="sm" variant="ghost" disabled className="w-full">
                        <Lock size={12} />
                        {t('market.comingSoon')}
                      </Button>
                    ) : row.owned ? (
                      active ? (
                        <Chip tone="good" icon={Check}>{t('wallet.inUse')}</Chip>
                      ) : (
                        <Button size="sm" variant="subtle" busy={themeUse.isPending} onClick={() => themeUse.mutate(row.key)}>
                          {t('wallet.use')}
                        </Button>
                      )
                    ) : row.sku && item ? (
                      <Button
                        size="sm"
                        variant={wallet.balance < themePrice ? 'danger' : 'primary'}
                        busy={purchase.isPending && purchase.variables === row.sku}
                        disabled={wallet.balance < themePrice}
                        title={
                          wallet.balance < themePrice
                            ? t('market.insufficientHint', { need: formatCoin(themePrice - wallet.balance) })
                            : undefined
                        }
                        onClick={() => purchase.mutate(row.sku as string)}
                      >
                        {wallet.balance < themePrice ? t('market.insufficient') : t('wallet.buy')}
                      </Button>
                    ) : (
                      <p className="text-[11px] text-mute">{t('theme.notForSale')}</p>
                    )}
                    {row.owned && item ? <p className="text-[10px] text-mute">{t('market.themeBundleNote')}</p> : null}
                  </div>
                </div>
              </RevealItem>
            )
          })}
        </RevealList>
      </Section>

      {/* Boosts keep their own shelf because buying one needs a strategy, not just a wallet. */}
      <Section title={t('market.boostsTitle')} hint={t('market.boostsHint')}>
        {(byKind.get('boost') ?? []).length === 0 ? (
          <StateEmpty icon={Flame} title={t('wallet.noBoostItem')} />
        ) : (
          <RevealList className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3" count={(byKind.get('boost') ?? []).length}>
            {(byKind.get('boost') ?? []).map((item) => {
              const info = discountInfo(item)
              const affordable = wallet.balance >= info.final
              const soon = item.tag === 'soon'
              const sale = item.discountPercent > 0 && info.cut
              return (
                <RevealItem key={item.sku} className="h-full">
                  <div className={cn('hud-panel flex h-full flex-col gap-2 p-3', sale && 'market-discount', soon && 'opacity-80')}>
                    {sale ? <span aria-hidden className="market-discount-ring" /> : null}
                    <div className="flex items-center justify-between gap-1">
                      <span className="grid size-7 place-items-center rounded-lg border border-warn/35 bg-warn/12 text-warn">
                        <Flame size={13} />
                      </span>
                      <div className="flex items-center gap-1">
                        <TagChip tag={item.tag} />
                        {item.durationHours ? <Chip tone="brand">{t('market.hours', { count: item.durationHours })}</Chip> : null}
                      </div>
                    </div>
                    <p className="text-[13px] leading-snug font-semibold text-ink">{nameOf(item, language)}</p>
                    <p className="text-[11px] leading-relaxed text-mute">{descOf(item, language) ?? ''}</p>
                    <div className="mt-auto space-y-2 border-t border-line/60 pt-2">
                      {info.cut ? <DiscountBadge percent={info.percent} /> : null}
                      <PriceBlock item={item} />
                      {soon ? (
                        <Button size="sm" variant="ghost" disabled className="w-full">
                          <Lock size={12} />
                          {t('market.comingSoon')}
                        </Button>
                      ) : myStrategies.length === 0 ? (
                        <Button size="sm" variant="ghost" onClick={() => navigate('/import')}>
                          {t('market.needStrategy')}
                        </Button>
                      ) : (
                        <Menu>
                          <MenuTrigger asChild>
                            <Button
                              size="sm"
                              variant={affordable ? 'primary' : 'danger'}
                              disabled={!affordable}
                              title={
                                affordable
                                  ? undefined
                                  : t('market.insufficientHint', { need: formatCoin(info.final - wallet.balance) })
                              }
                            >
                              {affordable ? t('market.applyBoost') : t('market.insufficient')}
                            </Button>
                          </MenuTrigger>
                          <MenuContent align="start" side="bottom" className="w-64">
                            <MenuSection label={t('market.pickStrategy')} />
                            {myStrategies.map((strategy, index) => (
                              <MenuItem
                                key={strategy.id}
                                index={index}
                                onSelect={() => boost.mutate({ strategyId: strategy.id, sku: item.sku })}
                                aside={`${String(strategy.timesUsed)}×`}
                              >
                                {strategy.name}
                              </MenuItem>
                            ))}
                          </MenuContent>
                        </Menu>
                      )}
                    </div>
                  </div>
                </RevealItem>
              )
            })}
          </RevealList>
        )}
      </Section>

      {/* Badges, titles, frames and cosmetics each get their own shelf and their own preview. */}
      {SHELVES.filter((shelf) => shelf.kind !== 'theme' && shelf.kind !== 'boost').map((shelf) => {
        const list = byKind.get(shelf.kind) ?? []
        const Icon = shelf.icon
        if (list.length === 0) return null
        return (
          <Section
            key={shelf.kind}
            title={
              <span className="flex items-center gap-1.5">
                <Icon size={13} className="text-brand" />
                {t(shelf.titleKey)}
              </span>
            }
            hint={t(shelf.hintKey)}
          >
            <RevealList className={cn('grid gap-2.5', shelf.columns)} count={list.length}>
              {list.map((item) => {
                const equipped =
                  item.kind === 'title'
                    ? myProfile.data?.titleKey === item.refCode
                    : item.kind === 'frame'
                      ? myProfile.data?.frameKey === item.refCode
                      : false
                const canEquip = item.kind === 'title' || item.kind === 'frame'
                return (
                  <RevealItem key={item.sku} className="h-full">
                    <ProductCard
                      item={item}
                      shelf={shelf.kind}
                      language={language}
                      owned={item.owned || (item.refCode === 'rainbow' && vipOwned)}
                      equipped={equipped}
                      busy={purchase.isPending || equip.isPending}
                      balance={wallet.balance}
                      onBuy={() => purchase.mutate(item.sku)}
                      onEquip={
                        canEquip
                          ? () => equip.mutate({ kind: item.kind === 'title' ? 'title' : 'frame', ref: item.refCode ?? null })
                          : undefined
                      }
                      onVip={
                        vipItem
                          ? () => document.getElementById('market-vip')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          : undefined
                      }
                      queue={waitlist.get(item.sku) ?? null}
                      queueBusy={queue.isPending && queue.variables?.sku === item.sku}
                      onQueue={
                        item.tag === 'soon' && signedIn
                          ? () => queue.mutate({ sku: item.sku, joined: waitlist.get(item.sku)?.joined === true })
                          : undefined
                      }
                    />
                  </RevealItem>
                )
              })}
            </RevealList>
          </Section>
        )
      })}

      {SHELVES.some((shelf) => shelf.kind === 'frame') ? (
        <p className="flex flex-wrap items-center gap-2 text-[11px] text-mute">
          <CoinIcon size={12} className="text-brand" />
          {t('market.balanceNote', { balance: formatCoin(wallet.balance) })}
          <span className="text-mute/60">·</span>
          {t('market.frameRegistryNote', { count: FRAME_SKINS.length })}
        </p>
      ) : null}
    </div>
  )
}
