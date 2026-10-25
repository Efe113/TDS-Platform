import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BadgeCheck,
  Camera,
  Check,
  Crown,
  ImagePlus,
  Lock,
  Pencil,
  Save,
  Sparkles,
  Trash2,
  UserRound
} from 'lucide-react'
import {
  PROFILE_METRICS,
  metricValue,
  storageUrl,
  themeSkin,
  toggleShowcaseCode,
  type BadgeTier,
  type ProfileBadge,
  type ThemeKey
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { navigate, routeSegments, useRoutePath } from '../../lib/router'
import { useCatalogLanguage } from '../../lib/catalog-labels'
import { fetchShowcase, setProfileMedia, setPublicBadges, updateProfile } from '../../lib/profile-api'
import { showcaseQueryKey, useIdentity } from '../../lib/identity'
import { removeProfileImage, uploadProfileImage } from '../../lib/media-upload'
import { buySku, fetchWallet, newPurchaseKey, selectTheme } from '../../lib/wallet-api'
import { skinRows, SKIN_NAME_KEYS } from '../../lib/skins'
import { SUPABASE_BASE_URL } from '../../lib/storage-base'
import { relativeTime } from '../../lib/text'
import { selectUserId, useAuth } from '../../store/auth-store'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { Badge, Banner, Button, EmptyState, INPUT_CLASS, Row, cn } from '../../components/ui'
import { Chip, Metric, MetricGrid, PageHeader, Section } from '../../components/ui/system'
import { StateEmpty, StateError } from '../../components/ui/states'
import { CoinAmount } from '../../components/brand/coin'
import { TitleBadge } from '../../components/brand/title-badge'
import { VerifiedBadge } from '../../components/brand/verified-badge'
import { FrameRing, frameStyle } from '../../components/brand/frame'
import { ThemePreview, skinStyle } from '../../components/brand/theme-preview'
import { CountUp } from '../../motion/primitives/CountUp'
import { RevealItem, RevealList } from '../../motion/primitives/Reveal'
import { SkeletonCard } from '../../motion/primitives/Shimmer'

const METRIC_LABEL: Record<string, MessageKey> = {
  strategies_published: 'profile.metricPublished',
  sessions_qualified: 'profile.metricSessions',
  steps_completed: 'profile.metricSteps',
  distinct_maps: 'profile.metricMaps',
  active_days: 'profile.metricDays',
  streak: 'profile.metricStreak'
}

const TIER_LABEL: Record<BadgeTier, MessageKey> = {
  bronze: 'profile.tierBronze',
  silver: 'profile.tierSilver',
  gold: 'profile.tierGold',
  special: 'profile.tierSpecial'
}

const TIER_TONE: Record<BadgeTier, 'neutral' | 'accent' | 'warn' | 'good'> = {
  bronze: 'neutral',
  silver: 'neutral',
  gold: 'warn',
  special: 'accent'
}

function mediaUrl(path: string | null): string | null {
  if (!path) return null
  return SUPABASE_BASE_URL.length > 0 ? storageUrl(SUPABASE_BASE_URL, path) : null
}

function BadgeTile({ badge, inShowcase, onToggle }: { badge: ProfileBadge; inShowcase: boolean; onToggle: (() => void) | null }): ReactNode {
  const t = useT()
  const language = useCatalogLanguage()
  const name = language === 'en' ? badge.nameEn : badge.name

  return (
    <button
      type="button"
      data-press
      disabled={onToggle === null}
      onClick={onToggle ?? undefined}
      className={cn(
        'flex h-full w-full flex-col gap-1 rounded-lg border p-3 text-left transition',
        inShowcase ? 'border-brand bg-brand/10' : 'border-panel-soft',
        onToggle === null ? 'cursor-default' : 'hover:border-brand/60'
      )}
    >
      <Row className="gap-2">
        <Badge tone={TIER_TONE[badge.tier]}>{t(TIER_LABEL[badge.tier])}</Badge>
        {inShowcase ? <span className="text-[11px] text-brand">{t('profile.inShowcase')}</span> : null}
      </Row>
      <span className="text-[13px] font-medium">{name}</span>
      {badge.desc ? <span className="text-[11px] text-mute">{badge.desc}</span> : null}
      <span className="hud-num text-[10px] text-mute">{relativeTime(badge.awardedAt, language)}</span>
    </button>
  )
}

export function ProfilePage(): ReactNode {
  const t = useT()
  const path = useRoutePath()
  const ownId = useAuth(selectUserId)
  const identity = useIdentity()
  const queryClient = useQueryClient()
  const routeUserId = routeSegments(path)[1] ?? null
  const userId = routeUserId ?? ownId
  const isOwn = userId !== null && userId === ownId

  const [showcase, setShowcase] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [handle, setHandle] = useState('')
  const [bio, setBio] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const avatarInput = useRef<HTMLInputElement>(null)
  const bannerInput = useRef<HTMLInputElement>(null)
  const backgroundInput = useRef<HTMLInputElement>(null)

  const showcaseQuery = useQuery({
    queryKey: showcaseQueryKey(userId),
    queryFn: () => fetchShowcase(String(userId)),
    enabled: userId !== null,
    retry: 1
  })
  const profile = showcaseQuery.data

  useEffect(() => {
    setShowcase((profile?.showcase ?? []).map((entry) => entry.code))
  }, [profile?.showcase])

  useEffect(() => {
    if (!profile) return
    setDisplayName(profile.displayName ?? '')
    setHandle(profile.handle)
    setBio(profile.bio ?? '')
  }, [profile?.displayName, profile?.handle, profile?.bio, profile])

  const saveBadges = useMutation({
    mutationFn: () => setPublicBadges(showcase),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: showcaseQueryKey(userId) })
    }
  })

  const saveIdentity = useMutation({
    mutationFn: () => updateProfile({ displayName: displayName.trim(), handle: handle.trim().toLocaleLowerCase(), bio: bio.trim() }),
    onSuccess: () => {
      setFailure(null)
      void queryClient.invalidateQueries({ queryKey: showcaseQueryKey(userId) })
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: fetchWallet, enabled: isOwn, retry: 1 })
  const bannerItem = (walletQuery.data?.catalog ?? []).find((item) => item.sku === 'cosmetic_banner') ?? null
  const vipItem = (walletQuery.data?.catalog ?? []).find((item) => item.kind === 'vip') ?? null
  const themeRows = skinRows(walletQuery.data?.catalog ?? [])

  const upload = useMutation({
    mutationFn: async (input: { kind: 'avatar' | 'banner' | 'background'; file: File }) => {
      if (!userId) throw new Error('AUTH_REQUIRED')
      const previous =
        input.kind === 'avatar'
          ? (profile?.avatarPath ?? null)
          : input.kind === 'banner'
            ? (profile?.bannerPath ?? null)
            : (profile?.customBackgroundPath ?? null)
      const path = await uploadProfileImage({ kind: input.kind, userId }, input.file, previous)
      return setProfileMedia(input.kind, path)
    },
    onSuccess: () => {
      setFailure(null)
      void queryClient.invalidateQueries({ queryKey: showcaseQueryKey(userId) })
      // The VIP app background lives on the wallet summary, so the shell must refetch it too.
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const removeMedia = useMutation({
    mutationFn: async (input: { kind: 'avatar' | 'banner' | 'background'; path: string }) => {
      // Clearing the column without deleting the object would leak free-tier storage forever.
      await removeProfileImage(input.path)
      return setProfileMedia(input.kind, null)
    },
    onSuccess: () => {
      setFailure(null)
      void queryClient.invalidateQueries({ queryKey: showcaseQueryKey(userId) })
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const unlockBanner = useMutation({
    mutationFn: async () => {
      if (!bannerItem) throw new Error('NOT_FOUND')
      await buySku(bannerItem.sku, newPurchaseKey())
    },
    onSuccess: () => {
      setFailure(null)
      void queryClient.invalidateQueries({ queryKey: showcaseQueryKey(userId) })
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const themeChoice = useMutation({
    mutationFn: (key: ThemeKey) => selectTheme(key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wallet'] })
      void queryClient.invalidateQueries({ queryKey: showcaseQueryKey(userId) })
    },
    onError: (error: unknown) => setFailure(error instanceof Error ? error.message : String(error))
  })

  const dirty = useMemo(() => {
    if (!profile) return false
    return (
      displayName.trim() !== (profile.displayName ?? '') ||
      handle.trim().toLocaleLowerCase() !== profile.handle ||
      bio.trim() !== (profile.bio ?? '')
    )
  }, [profile, displayName, handle, bio])

  const dirtyBadges = useMemo(() => {
    const current = (profile?.showcase ?? []).map((entry) => entry.code).sort()
    return current.join('|') !== [...showcase].sort().join('|')
  }, [profile?.showcase, showcase])

  if (userId === null) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('profile.title')} />
        <StateEmpty icon={UserRound} title={t('profile.needSignIn')} body={t('discover.needsSignIn')} />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('profile.title')} />
        {showcaseQuery.error ? (
          <StateError detail={showcaseQuery.error.message} onRetry={() => void showcaseQuery.refetch()} busy={showcaseQuery.isFetching} />
        ) : null}
        <SkeletonCard lines={3} />
        <div className="grid gap-3 sm:grid-cols-2">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </div>
      </div>
    )
  }

  const skin = themeSkin(profile.themeKey)
  const avatar = mediaUrl(profile.avatarPath) ?? (isOwn ? identity.avatarUrl : null)
  const banner = mediaUrl(profile.bannerPath)
  const backgroundPreview = mediaUrl(profile.customBackgroundPath)
  const initials = (profile.displayName ?? profile.handle).slice(0, 2).toLocaleUpperCase()
  const failureMessage =
    failure === 'IMAGE_TOO_LARGE'
      ? t('profile.uploadTooLarge')
      : failure === 'IMAGE_INVALID'
        ? t('profile.uploadInvalid')
        : failure === 'VIP_REQUIRED'
          ? t('profile.vipRequired')
          : failure

  return (
    <div className="space-y-4">
      <PageHeader
        title={profile.displayName ?? `@${profile.handle}`}
        subtitle={`@${profile.handle} · ${t('profile.joined')}: ${new Date(profile.joinedAt).toLocaleDateString()}`}
        badges={
          <>
            <Chip tone="brand" icon={Sparkles}>{profile.themeName ?? t('profile.themeDefault')}</Chip>
            {profile.vip ? <Chip tone="warn" icon={Crown}>{t('profile.vip')}</Chip> : null}
            {profile.bannerUnlocked ? (
              <Chip tone="good" icon={Check}>{t('profile.bannerUnlocked')}</Chip>
            ) : (
              <Chip tone="warn" icon={Lock}>{t('profile.bannerLocked')}</Chip>
            )}
          </>
        }
        actions={
          isOwn ? (
            <Button variant={editing ? 'primary' : 'ghost'} onClick={() => setEditing((current) => !current)}>
              <Pencil size={14} />
              {editing ? t('profile.closeEditor') : t('profile.edit')}
            </Button>
          ) : null
        }
      />

      {failureMessage ? (
        <Banner tone="danger" title={t('common.errorTitle')}>
          {failureMessage}
        </Banner>
      ) : null}

      {/* The profile carries its own skin: the banner, avatar ring and accents read from the owner's
          theme, while the surrounding app keeps the visitor's own. */}
      <div className="hud-panel overflow-hidden p-0" style={skinStyle(skin)}>
        <div className="relative h-40 w-full overflow-hidden sm:h-48">
          {banner ? (
            <img src={banner} alt="" className="size-full object-cover" />
          ) : (
            <div className="size-full" style={{ background: `linear-gradient(120deg, ${skin.glow[0]}, ${skin.glow[1]})` }} />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-base/90 via-base/10 to-transparent" />
          {!profile.bannerUnlocked ? (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-md border border-line bg-base/80 px-2 py-1 text-[10px] text-warn">
              <Lock size={11} />
              {t('profile.bannerLockedHint')}
            </span>
          ) : null}
        </div>

        <div className="relative px-4 pb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="-mt-10">
              <span className="relative inline-flex rounded-[21px]">
                <FrameRing value={profile.frameKey} />
                <Avatar
                  size="lg"
                  className={cn('size-[88px] rounded-2xl border-4 border-panel')}
                  style={frameStyle(profile.frameKey)}
                >
                  {avatar ? <AvatarImage src={avatar} alt="" /> : null}
                  <AvatarFallback className="rounded-2xl bg-brand/15 text-xl font-semibold text-brand">{initials}</AvatarFallback>
                </Avatar>
              </span>
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <p className="flex flex-wrap items-center gap-2 truncate text-lg leading-tight font-semibold text-ink">
                {profile.displayName ?? `@${profile.handle}`}
                <VerifiedBadge show={profile.verified} label={t('discover.verified')} />
                {profile.titleName ? <TitleBadge label={profile.titleName} refCode={profile.titleKey} size="md" /> : null}
              </p>
              <p className="truncate text-[12px] text-mute">{`@${profile.handle}`}</p>
            </div>
          </div>

          {profile.bio ? <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-mute">{profile.bio}</p> : null}
          {isOwn && !profile.bio && !editing ? (
            <p className="mt-3 text-[11px] text-mute">{t('profile.bioEmpty')}</p>
          ) : null}
        </div>
      </div>

      <MetricGrid columns={4}>
        {PROFILE_METRICS.slice(0, 4).map((key, index) => (
          <Metric
            key={key}
            index={index}
            icon={BadgeCheck}
            label={METRIC_LABEL[key] ? t(METRIC_LABEL[key]) : key}
            value={<CountUp value={metricValue(profile.metrics, key)} />}
          />
        ))}
      </MetricGrid>

      {editing && isOwn ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t('profile.identity')} hint={t('profile.identityHint')}>
            <div className="space-y-2.5">
              <label className="block space-y-1">
                <span className="hud-label">{t('profile.displayNameLabel')}</span>
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-9 text-sm')}
                  value={displayName}
                  maxLength={32}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="hud-label">{t('profile.handleLabel')}</span>
                <input
                  className={cn(INPUT_CLASS, 'no-drag h-9 font-mono text-sm')}
                  value={handle}
                  maxLength={32}
                  onChange={(event) => setHandle(event.target.value)}
                />
                <span className="text-[10px] text-mute">{t('profile.handleHint')}</span>
              </label>
              <label className="block space-y-1">
                <span className="hud-label">{t('profile.bioLabel')}</span>
                <textarea
                  className={cn(INPUT_CLASS, 'no-drag text-sm')}
                  rows={4}
                  maxLength={600}
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                />
                <span className="text-[10px] text-mute">{t('profile.bioHint', { count: bio.trim().length })}</span>
              </label>
              <Row className="gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  busy={saveIdentity.isPending}
                  disabled={!dirty || handle.trim().length < 3}
                  onClick={() => saveIdentity.mutate()}
                >
                  <Save size={13} />
                  {t('common.save')}
                </Button>
                {dirty ? (
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() => {
                      setDisplayName(profile.displayName ?? '')
                      setHandle(profile.handle)
                      setBio(profile.bio ?? '')
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                ) : null}
              </Row>
            </div>
          </Section>

          <Section title={t('profile.media')} hint={t('profile.mediaHint')}>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line/70 bg-base/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-ink">{t('profile.avatar')}</p>
                  <p className="text-[10px] text-mute">{t('profile.avatarHint')}</p>
                </div>
                <Row className="gap-1.5">
                  <input
                    ref={avatarInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (file) upload.mutate({ kind: 'avatar', file })
                    }}
                  />
                  <Button size="sm" variant="ghost" busy={upload.isPending && upload.variables?.kind === 'avatar'} onClick={() => avatarInput.current?.click()}>
                    <Camera size={13} />
                    {t('profile.upload')}
                  </Button>
                  {profile.avatarPath ? (
                    <Button
                      size="sm"
                      variant="subtle"
                      busy={removeMedia.isPending && removeMedia.variables?.kind === 'avatar'}
                      onClick={() => removeMedia.mutate({ kind: 'avatar', path: profile.avatarPath as string })}
                    >
                      <Trash2 size={13} />
                      {t('profile.remove')}
                    </Button>
                  ) : null}
                </Row>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border border-line/70 bg-base/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                    {t('profile.banner')}
                    {!profile.bannerUnlocked ? <Lock size={11} className="text-warn" /> : null}
                  </p>
                  <p className="text-[10px] text-mute">
                    {profile.bannerUnlocked ? t('profile.bannerHint') : t('profile.bannerLockedHint')}
                  </p>
                </div>
                <Row className="gap-1.5">
                  <input
                    ref={bannerInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (file) upload.mutate({ kind: 'banner', file })
                    }}
                  />
                  {profile.bannerUnlocked ? (
                    <>
                      <Button size="sm" variant="ghost" busy={upload.isPending && upload.variables?.kind === 'banner'} onClick={() => bannerInput.current?.click()}>
                        <ImagePlus size={13} />
                        {t('profile.upload')}
                      </Button>
                      {profile.bannerPath ? (
                        <Button
                          size="sm"
                          variant="subtle"
                          busy={removeMedia.isPending && removeMedia.variables?.kind === 'banner'}
                          onClick={() => removeMedia.mutate({ kind: 'banner', path: profile.bannerPath as string })}
                        >
                          <Trash2 size={13} />
                          {t('profile.remove')}
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <Button size="sm" variant="primary" busy={unlockBanner.isPending} disabled={!bannerItem} onClick={() => unlockBanner.mutate()}>
                      <Lock size={13} />
                      {t('profile.unlockBanner')}
                      {bannerItem ? <CoinAmount value={bannerItem.price} size="sm" /> : null}
                    </Button>
                  )}
                </Row>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border border-line/70 bg-base/40 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  {backgroundPreview ? (
                    <span className="size-9 shrink-0 overflow-hidden rounded-md border border-line bg-base">
                      <img src={backgroundPreview} alt="" className="size-full object-cover" />
                    </span>
                  ) : null}
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                      <Crown size={11} className="text-warn" />
                      {t('profile.background')}
                      {!profile.vip ? <Lock size={11} className="text-warn" /> : null}
                    </p>
                    <p className="text-[10px] text-mute">
                      {profile.vip ? t('profile.backgroundHint') : t('profile.backgroundLocked')}
                    </p>
                  </div>
                </div>
                <Row className="gap-1.5">
                  {profile.vip ? (
                    <>
                      <input
                        ref={backgroundInput}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          event.target.value = ''
                          if (file) upload.mutate({ kind: 'background', file })
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        busy={upload.isPending && upload.variables?.kind === 'background'}
                        onClick={() => backgroundInput.current?.click()}
                      >
                        <ImagePlus size={13} />
                        {t('profile.upload')}
                      </Button>
                      {profile.customBackgroundPath ? (
                        <Button
                          size="sm"
                          variant="subtle"
                          busy={removeMedia.isPending && removeMedia.variables?.kind === 'background'}
                          onClick={() => removeMedia.mutate({ kind: 'background', path: profile.customBackgroundPath as string })}
                        >
                          <Trash2 size={13} />
                          {t('profile.remove')}
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <Button size="sm" variant="primary" onClick={() => navigate('/market')}>
                      <Crown size={13} />
                      {t('profile.vipCta')}
                      {vipItem ? <CoinAmount value={vipItem.price} size="sm" /> : null}
                    </Button>
                  )}
                </Row>
              </div>

              <div>
                <p className="hud-label mb-1.5">{t('profile.themeTitle')}</p>
                <p className="mb-2 text-[10px] leading-relaxed text-mute">{t('profile.themeHint')}</p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {themeRows.map((row) => {
                    const active = profile.themeKey === row.key
                    return (
                      <button
                        key={row.key}
                        type="button"
                        disabled={!row.owned || themeChoice.isPending}
                        onClick={() => themeChoice.mutate(row.key)}
                        className={cn(
                          'no-drag rounded-lg border p-1.5 text-left transition-colors',
                          active ? 'border-brand bg-brand/10' : 'border-line bg-base/40 hover:border-brand/50',
                          !row.owned && 'cursor-not-allowed opacity-50'
                        )}
                      >
                        <ThemePreview value={row.key} className="h-9 w-full" detailed={false} />
                        <span className="mt-1 block truncate text-[10px] text-ink">{t(SKIN_NAME_KEYS[row.key])}</span>
                        <span className="block text-[9px] text-mute">{active ? t('wallet.inUse') : row.owned ? t('wallet.use') : t('profile.themeLocked')}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </Section>
        </div>
      ) : null}

      <Section title={t('profile.badges')} hint={t('profile.showcaseHint')}>
        {profile.badges.length === 0 ? (
          <EmptyState title={t('profile.noBadges')} body={t('profile.noBadgesHint')} />
        ) : (
          <RevealList className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" count={profile.badges.length}>
            {profile.badges.map((badge) => (
              <RevealItem key={badge.code} className="h-full">
                <BadgeTile
                  badge={badge}
                  inShowcase={showcase.includes(badge.code)}
                  onToggle={isOwn ? () => setShowcase((prev) => toggleShowcaseCode(prev, badge.code).codes) : null}
                />
              </RevealItem>
            ))}
          </RevealList>
        )}
        {isOwn && (saveBadges.isPending || dirtyBadges) ? (
          <Row className="mt-3 gap-2">
            <Button variant="primary" size="sm" busy={saveBadges.isPending} onClick={() => saveBadges.mutate()}>
              {t('profile.saveShowcase')}
            </Button>
            {saveBadges.isSuccess && !dirtyBadges ? <Banner tone="good">{t('profile.saved')}</Banner> : null}
            {saveBadges.isError ? <Banner tone="danger" title={t('common.errorTitle')}>{saveBadges.error.message}</Banner> : null}
          </Row>
        ) : null}
      </Section>

      <Section title={t('profile.strategies')}>
        {profile.strategies.length === 0 ? (
          <StateEmpty icon={Sparkles} title={t('profile.noStrategies')} />
        ) : (
          <RevealList className="divide-y divide-panel-soft" count={profile.strategies.length}>
            {profile.strategies.map((strategy) => (
              <RevealItem key={strategy.id}>
                <button
                  type="button"
                  className="no-drag flex w-full items-center justify-between gap-2 py-2 text-left hover:text-brand"
                  onClick={() => navigate(`/strategy/${strategy.id}`)}
                >
                  <span className="min-w-0 truncate text-[13px]">{strategy.name}</span>
                  <span className="hud-num shrink-0 text-[11px] text-mute">{t('detail.usedCount', { count: strategy.timesUsed })}</span>
                </button>
              </RevealItem>
            ))}
          </RevealList>
        )}
      </Section>
    </div>
  )
}
