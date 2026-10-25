import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Frame as FrameIcon, Palette, ShoppingBag, Sparkles, X } from 'lucide-react'
import { PROFILE_THEME_KEYS, formatCoin, profileThemeSkin, type ProfileShowcase, type WalletItem } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { navigate } from '../../lib/router'
import { fetchWallet } from '../../lib/wallet-api'
import { equipCosmetic } from '../../lib/profile-api'
import { showcaseQueryKey } from '../../lib/identity'
import { selectSignedIn, useAuth } from '../../store/auth-store'
import { Button, cn } from '../../components/ui'
import { Chip, Section } from '../../components/ui/system'
import { StateLoading } from '../../components/ui/states'
import { CoinAmount } from '../../components/brand/coin'
import { TitleBadge } from '../../components/brand/title-badge'
import { ProfileThemeSky } from '../../components/brand/profile-theme'
import { ProfileCard } from '../../components/profile/profile-card'
import { useCatalogLanguage, pickLocalized } from '../../lib/catalog-labels'

/**
 * The personaliser (0043). Discord puts this on the profile itself, and so does the app: the frame,
 * the title and now the profile theme are equipped here instead of only on a Market shelf, because
 * "what do I look like" is a profile question, not a shopping question.
 *
 * Ownership is never decided here. `wallet_summary` already answers it per entitlement (VIP frame,
 * tier themes, receipts), so a row this panel offers is a row the server will accept.
 */

type EquipKind = 'frame' | 'title' | 'profile'

interface RowProps {
  item: WalletItem
  equipped: boolean
  busy: boolean
  onEquip: (ref: string | null) => void
  preview: ReactNode
  label: string
  note?: string
}

function EquipRow({ item, equipped, busy, onEquip, preview, label, note }: RowProps): ReactNode {
  const t = useT()
  const short = !item.owned

  return (
    <div
      className={cn(
        'hud-panel flex items-center gap-3 p-2.5 transition-colors',
        equipped && 'border-brand/60 bg-brand/8'
      )}
    >
      <span className="relative grid h-12 w-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-line/70 bg-base/60">
        {preview}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-ink">{label}</p>
        {note ? <p className="truncate text-[10px] text-mute">{note}</p> : null}
      </div>
      {short ? (
        item.price > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => navigate('/market')}>
            <ShoppingBag size={12} />
            <CoinAmount value={item.price} size="sm" tone="mute" />
          </Button>
        ) : (
          /* A tier mark cannot be bought: the note already says which account type hands it out. */
          <Chip tone="neutral">{note ?? t('profile.grantByTier')}</Chip>
        )
      ) : equipped ? (
        <Chip tone="good" icon={Check}>{t('market.equipped')}</Chip>
      ) : (
        <Button size="sm" variant="primary" busy={busy} onClick={() => onEquip(item.refCode ?? null)}>
          {t('market.equip')}
        </Button>
      )}
    </div>
  )
}

export function PersonalizePanel({ profile }: { profile: ProfileShowcase }): ReactNode {
  const t = useT()
  const language = useCatalogLanguage()
  const queryClient = useQueryClient()
  const signedIn = useAuth(selectSignedIn)

  const walletQuery = useQuery({
    queryKey: ['wallet'],
    queryFn: fetchWallet,
    enabled: signedIn,
    staleTime: 30_000,
    retry: 1
  })

  const equip = useMutation({
    mutationFn: (input: { kind: EquipKind; ref: string | null }) => equipCosmetic(input.kind, input.ref),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
      void queryClient.invalidateQueries({ queryKey: showcaseQueryKey(profile.userId) })
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
    }
  })

  const items = walletQuery.data?.catalog ?? []
  const frames = items.filter((item) => item.kind === 'frame')
  const titles = items.filter((item) => item.kind === 'title')
  const themes = items.filter((item) => item.kind === 'cosmetic' && PROFILE_THEME_KEYS.includes(item.refCode ?? ''))

  const nameOf = (item: WalletItem): string => pickLocalized(item.name, item.nameEn, language) ?? item.sku
  const busyRef = equip.variables?.ref ?? null

  const clearButton = (kind: EquipKind, active: boolean): ReactNode =>
    active ? (
      <Button size="sm" variant="ghost" busy={equip.isPending && equip.variables?.kind === kind} onClick={() => equip.mutate({ kind, ref: null })}>
        <X size={12} />
        {t('profile.clearEquip')}
      </Button>
    ) : null

  return (
    <Section
      title={t('profile.personalize')}
      hint={t('profile.personalizeHint')}
      aside={
        <Button size="sm" variant="subtle" onClick={() => document.getElementById('profile-preview')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
          <Sparkles size={12} />
          {t('profile.previewCta')}
        </Button>
      }
    >
      {walletQuery.isPending ? <StateLoading /> : null}

      {/* A live preview of the member's own card, painted by whatever is currently equipped. */}
      <div id="profile-preview" className="relative scroll-mt-24">
        <ProfileCard profile={profile} compact className="mb-3" />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="hud-label flex items-center gap-1.5"><Palette size={12} />{t('profile.themesTitle')}</span>
          {clearButton('profile', profile.profileTheme !== null)}
          <span className="ml-auto text-[10px] text-mute">{t('profile.themesHint')}</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {themes.map((item) => {
            const skin = profileThemeSkin(item.refCode)
            const equipped = profile.profileTheme === item.refCode
            return (
              <EquipRow
                key={item.sku}
                item={item}
                equipped={equipped}
                busy={equip.isPending && busyRef === item.refCode}
                onEquip={(ref) => equip.mutate({ kind: 'profile', ref })}
                label={nameOf(item)}
                note={
                  skin === null
                    ? undefined
                    : skin.source === 'purchase'
                      ? t('profile.themePurchasedNote', { price: formatCoin(item.price) })
                      : t('profile.themeTierNote', { tier: skin.source === 'vip' ? 'VIP' : skin.source === 'corporate' ? t('corporate.title') : t('verified.title') })
                }
                preview={<ProfileThemeSky skin={skin} />}
              />
            )
          })}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="hud-label flex items-center gap-1.5"><FrameIcon size={12} />{t('profile.framesTitle')}</span>
          {clearButton('frame', profile.frameKey !== null)}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {frames.map((item) => (
            <EquipRow
              key={item.sku}
              item={item}
              equipped={profile.frameKey === item.refCode}
              busy={equip.isPending && busyRef === item.refCode}
              onEquip={(ref) => equip.mutate({ kind: 'frame', ref })}
              label={nameOf(item)}
              note={item.tag === 'vip' ? t('market.vipOnly') : undefined}
              preview={
                <span className="relative grid size-9 place-items-center rounded-xl border-2" style={{ borderColor: 'var(--color-brand)' }}>
                  {item.refCode}
                </span>
              }
            />
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="hud-label">{t('profile.titlesTitle')}</span>
          {clearButton('title', profile.titleKey !== null)}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {titles.map((item) => (
            <EquipRow
              key={item.sku}
              item={item}
              equipped={profile.titleKey === item.refCode}
              busy={equip.isPending && busyRef === item.refCode}
              onEquip={(ref) => equip.mutate({ kind: 'title', ref })}
              label={nameOf(item)}
              note={item.tag === 'vip' ? t('market.vipOnly') : item.tag === 'verified' ? t('verified.perkTitle') : item.tag === 'corporate' ? t('corporate.perkTitle') : undefined}
              preview={<TitleBadge label={nameOf(item)} refCode={item.refCode} size="sm" />}
            />
          ))}
        </div>
      </div>

      {equip.isError ? (
        <p className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">
          {equip.error instanceof Error ? equip.error.message : String(equip.error)}
        </p>
      ) : null}
    </Section>
  )
}
