import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, BadgeCheck, CalendarDays, Crown, MapPin, Star, Trophy, Users } from 'lucide-react'
import type { ProfileShowcase } from '@tds/shared'
import { profileThemeSkin } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { pickLocalized, useCatalogLanguage } from '../../lib/catalog-labels'
import { SUPABASE_BASE_URL } from '../../lib/storage-base'
import { storageUrl } from '@tds/shared'
import { fetchShowcase } from '../../lib/profile-api'
import { showcaseQueryKey } from '../../lib/identity'
import { navigate } from '../../lib/router'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Button, cn } from '../ui'
import { Chip } from '../ui/system'
import { VerifiedBadge } from '../brand/verified-badge'
import { TitleBadge } from '../brand/title-badge'
import { FrameRing, frameStyle } from '../brand/frame'
import { BadgeGlyph } from '../brand/badge-glyph'
import { ProfileThemeSky } from '../brand/profile-theme'
import { Menu, MenuContent, MenuTrigger } from '../ui/menu'

/**
 * The profile as one card, painted the same way everywhere it appears — the owner's screen, someone
 * else's profile, a leaderboard row, a comment author (0043). Discord's structure is the shape: the
 * ground and banner first, the avatar breaking out of it, then name → pronouns → handle → the marks
 * the account earned, then what the account actually does.
 *
 * The theme is the layer under all of that: a purchased or tier-granted `profile_theme_key` read from
 * the server, so a profile looks the same to everybody who opens it.
 */

function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return SUPABASE_BASE_URL.length > 0 ? storageUrl(SUPABASE_BASE_URL, path) : null
}

/** "Mart 2026'da katıldı" — a month and a year, which is what a profile date is worth. */
function joinedLabel(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'tr-TR', { month: 'long', year: 'numeric' }).format(date)
}

interface ProfileCardProps {
  profile: ProfileShowcase
  /** The hover card drops the strategy list and the long bio to stay a card, not a page. */
  compact?: boolean
  actions?: ReactNode
  className?: string
}

export function ProfileCard({ profile, compact = false, actions, className }: ProfileCardProps): ReactNode {
  const t = useT()
  const language = useCatalogLanguage()
  const skin = profileThemeSkin(profile.profileTheme)
  const avatar = mediaUrl(profile.avatarPath)
  const banner = mediaUrl(profile.bannerPath)
  const initials = (profile.displayName ?? profile.handle).slice(0, 2).toLocaleUpperCase()
  const titleName = pickLocalized(profile.titleName, profile.titleNameEn, language)
  const metrics = profile.metrics

  const marks: { key: string; node: ReactNode }[] = []
  if (profile.corporate) marks.push({ key: 'corporate', node: <Chip key="corporate" tone="warn" icon={Crown}>{t('corporate.title')}</Chip> })
  if (profile.vip) marks.push({ key: 'vip', node: <Chip key="vip" tone="brand" icon={Crown}>VIP</Chip> })
  if (profile.verified) marks.push({ key: 'verified', node: <Chip key="verified" tone="good" icon={BadgeCheck}>{t('verified.title')}</Chip> })

  return (
    <div
      className={cn(
        'profile-card relative overflow-hidden rounded-2xl border border-line/70 bg-panel',
        skin !== null && 'profile-card--themed',
        className
      )}
      style={
        skin === null
          ? undefined
          : ({
              ['--pt-a']: skin.accent,
              ['--pt-r']: skin.ring,
              ['--pt-1']: skin.stops[0],
              ['--pt-2']: skin.stops[1],
              ['--pt-3']: skin.stops[2]
            } as CSSProperties)
      }
    >
      {/* The member's banner first, the theme ON TOP of it: screen blending lets the gold rays, sparks
          and horizon add light instead of hiding the picture underneath. Painting the theme below the
          banner made it invisible for everyone who had a banner — which is the whole point of one. */}
      <div className={cn('relative', compact ? 'h-20' : 'h-28 sm:h-36')}>
        {banner !== null ? (
          <img src={banner} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
        ) : null}
        <ProfileThemeSky skin={skin} over={banner !== null} />
        <span className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-panel to-transparent" />
      </div>

      <div className={cn('relative px-4', compact ? 'pb-3' : 'pb-4')}>
        <div className={cn('relative -mt-9 mb-2 flex items-end gap-3', compact && '-mt-7')}>
          <span className="profile-card__avatar relative inline-flex rounded-2xl">
            <FrameRing value={profile.frameKey} />
            <Avatar
              size={compact ? 'sm' : 'lg'}
              className={cn('rounded-2xl border-4 border-panel', compact ? 'size-14' : 'size-[88px]')}
              style={frameStyle(profile.frameKey)}
            >
              {avatar !== null ? <AvatarImage src={avatar} alt="" /> : null}
              <AvatarFallback className="rounded-2xl bg-brand/15 text-lg font-semibold text-brand">{initials}</AvatarFallback>
            </Avatar>
          </span>

          {profile.profileThemeName !== null && !compact ? (
            <span className="mb-1 truncate text-[10px] uppercase tracking-widest text-mute">
              {pickLocalized(profile.profileThemeName, profile.profileThemeNameEn, language)}
            </span>
          ) : null}
        </div>

        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('min-w-0 break-words font-semibold text-ink', compact ? 'text-[14px]' : 'text-lg leading-tight')}>
            {profile.displayName ?? `@${profile.handle}`}
          </span>
          {profile.pronouns ? <span className="text-[11px] text-mute">{profile.pronouns}</span> : null}
          <VerifiedBadge show={profile.verified} tier={profile.corporate ? 'corporate' : 'verified'} size="sm" label={t(profile.corporate ? 'discover.corporate' : 'discover.verified')} />
          {titleName !== null ? <TitleBadge label={titleName} refCode={profile.titleKey} size="sm" /> : null}
        </p>

        <p className="truncate font-mono text-[11px] text-mute">{`@${profile.handle}`}</p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {marks.map((mark) => mark.node)}
          <Chip tone="neutral" icon={CalendarDays}>{joinedLabel(profile.joinedAt, language === 'en' ? 'en' : 'tr')}</Chip>
        </div>

        {profile.bio && !compact ? (
          <div className="mt-3 rounded-xl border border-line/60 bg-base/50 px-3 py-2">
            <span className="hud-label">{t('profile.aboutTitle')}</span>
            <p className="mt-1 whitespace-pre-line break-words text-[12px] leading-relaxed text-ink/85">{profile.bio}</p>
          </div>
        ) : null}

        {/* What the account does, in one strip — the numbers a profile is actually judged by. */}
        <div className={cn('mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-mute', compact && 'gap-x-3')}>
          <span className="flex items-center gap-1.5"><Star size={12} className="text-brand" /><span className="hud-num text-ink">{metrics.strategies_published}</span>{t('profile.metricPublished')}</span>
          <span className="flex items-center gap-1.5"><Activity size={12} className="text-brand" /><span className="hud-num text-ink">{metrics.sessions_qualified}</span>{t('profile.metricSessions')}</span>
          <span className="flex items-center gap-1.5"><MapPin size={12} className="text-brand" /><span className="hud-num text-ink">{metrics.distinct_maps}</span>{t('profile.metricMaps')}</span>
          {!compact ? <span className="flex items-center gap-1.5"><Trophy size={12} className="text-brand" /><span className="hud-num text-ink">{metrics.steps_completed}</span>{t('profile.metricSteps')}</span> : null}
          {!compact ? <span className="flex items-center gap-1.5"><Users size={12} className="text-brand" /><span className="hud-num text-ink">{metrics.active_days}</span>{t('profile.metricDays')}</span> : null}
        </div>

        {profile.badges.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {(compact ? profile.badges.slice(0, 5) : profile.badges.slice(0, 12)).map((badge) => (
              <span
                key={badge.code}
                title={pickLocalized(badge.name, badge.nameEn, language) ?? badge.code}
                className="flex items-center gap-1.5 rounded-lg border border-line/70 bg-base/50 px-1.5 py-1 text-[10px] text-mute"
              >
                <BadgeGlyph path={badge.iconPath} size={14} />
                <span className="max-w-28 truncate">{pickLocalized(badge.name, badge.nameEn, language) ?? badge.code}</span>
              </span>
            ))}
            {profile.badges.length > (compact ? 5 : 12) ? (
              <span className="text-[10px] text-mute">{t('leaderboard.badgeMore', { count: profile.badges.length - (compact ? 5 : 12) })}</span>
            ) : null}
          </div>
        ) : null}

        {!compact && profile.strategies.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {profile.strategies.map((strategy) => (
              <li key={strategy.id}>
                <button
                  type="button"
                  className="no-drag flex w-full items-center gap-2 rounded-lg border border-line/60 bg-base/40 px-2.5 py-1.5 text-left text-[12px] transition-colors hover:border-brand/50 hover:text-brand"
                  onClick={() => navigate(`/strategy/${strategy.id}`)}
                >
                  <span className="min-w-0 flex-1 truncate">{strategy.name}</span>
                  <span className="hud-num text-[10px] text-mute">{t('detail.usedCount', { count: strategy.timesUsed })}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}

/**
 * The same card, anchored to whatever names a row or a comment. It reads on demand and stays silent
 * when the profile cannot be resolved — a broken hover card is worse than no hover card.
 */
export function ProfileHoverCard({ userId, children }: { userId: string | null; children: ReactNode }): ReactNode {
  const t = useT()
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: showcaseQueryKey(userId),
    queryFn: () => fetchShowcase(userId ?? ''),
    enabled: open && userId !== null,
    staleTime: 60_000,
    retry: false
  })

  if (userId === null) return children

  const openProfile = (): void => {
    setOpen(false)
    navigate(`/profile/${userId}`)
  }

  return (
    <Menu onOpenChange={setOpen}>
      <MenuTrigger asChild>
        <button type="button" className="no-drag text-left">
          {children}
        </button>
      </MenuTrigger>
      <MenuContent align="start" side="right" className="w-[24rem] max-w-[86vw]">
        {query.isPending ? (
          <p className="px-2 py-6 text-center text-[11px] text-mute">{t('common.loading')}</p>
        ) : query.isError || query.data === undefined ? (
          <p className="px-2 py-6 text-center text-[11px] text-mute">
            {query.error instanceof Error ? query.error.message : t('profile.notFound')}
          </p>
        ) : (
          <>
            <ProfileCard profile={query.data} compact />
            <div className="mt-1.5 px-1 pb-1">
              <Button size="sm" variant="subtle" className="w-full" onClick={openProfile}>
                {t('profile.openFull')}
              </Button>
            </div>
          </>
        )}
      </MenuContent>
    </Menu>
  )
}
