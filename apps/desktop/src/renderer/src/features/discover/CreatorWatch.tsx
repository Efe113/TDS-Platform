import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Check, UserRound } from 'lucide-react'
import { useT } from '../../i18n/use-t'
import { navigate } from '../../lib/router'
import { relativeTime } from '../../lib/text'
import { useCatalogLanguage } from '../../lib/catalog-labels'
import { fetchCreatorFeed, fetchCreatorWatchList, markCreatorSeen, toggleCreatorWatch } from '../../lib/intelligence-api'
import { selectSignedIn, useAuth } from '../../store/auth-store'
import { supabase } from '../../lib/supabase'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { Button } from '../../components/ui'
import { Chip } from '../../components/ui/system'
import { SUPABASE_BASE_URL } from '../../lib/storage-base'
import { storageUrl } from '@tds/shared'

const WATCH_KEY = ['creator-watch']

/**
 * Following a person (0054). A strategy watch answers "did this run change?"; this answers "did this
 * author publish?", which is the question that actually brings someone back to Discover.
 */
export function CreatorFollowButton({ creatorId, own }: { creatorId: string | null; own: boolean }): ReactNode {
  const t = useT()
  const signedIn = useAuth(selectSignedIn)
  const queryClient = useQueryClient()

  const watchQuery = useQuery({
    queryKey: WATCH_KEY,
    queryFn: fetchCreatorWatchList,
    enabled: signedIn && supabase !== null,
    retry: 1,
    staleTime: 60_000
  })
  const toggle = useMutation({
    mutationFn: (id: string) => toggleCreatorWatch(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WATCH_KEY })
      void queryClient.invalidateQueries({ queryKey: ['creator-feed'] })
    }
  })

  if (!signedIn || own || creatorId === null || supabase === null) return null

  const following = (watchQuery.data ?? []).some((entry) => entry.creatorId === creatorId)

  return (
    <Button
      size="sm"
      variant={following ? 'primary' : 'ghost'}
      busy={toggle.isPending}
      title={following ? t('creator.unfollow') : t('creator.follow')}
      onClick={() => toggle.mutate(creatorId)}
    >
      <UserRound size={13} />
      {following ? t('creator.following') : t('creator.follow')}
    </Button>
  )
}

export function CreatorFeedTile(): ReactNode {
  const t = useT()
  const locale = useCatalogLanguage()
  const signedIn = useAuth(selectSignedIn)
  const queryClient = useQueryClient()

  const feedQuery = useQuery({
    queryKey: ['creator-feed'],
    queryFn: () => fetchCreatorFeed(9),
    enabled: signedIn && supabase !== null,
    retry: 1,
    staleTime: 60_000
  })
  const watchQuery = useQuery({
    queryKey: WATCH_KEY,
    queryFn: fetchCreatorWatchList,
    enabled: signedIn && supabase !== null,
    retry: 1,
    staleTime: 60_000
  })

  const seen = useMutation({
    mutationFn: (creatorId: string) => markCreatorSeen(creatorId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['creator-feed'] })
      void queryClient.invalidateQueries({ queryKey: WATCH_KEY })
    }
  })

  if (!signedIn || supabase === null) return null

  const rows = feedQuery.data ?? []
  const followed = watchQuery.data ?? []
  const newTotal = followed.reduce((sum, entry) => sum + entry.newSinceLastSeen, 0)

  if (followed.length === 0) {
    return (
      <div className="space-y-1.5 rounded-xl border border-line bg-panel p-3">
        <span className="hud-label flex items-center gap-1.5">
          <BellRing size={12} />
          {t('creator.feedTitle')}
        </span>
        <p className="text-[11px] leading-relaxed text-mute">{t('creator.empty')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="hud-label flex items-center gap-1.5">
          <BellRing size={12} />
          {t('creator.feedTitle')}
        </span>
        {newTotal > 0 ? <Chip tone="brand">{t('creator.newCount', { count: newTotal })}</Chip> : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-mute">{t('creator.feedHint')}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((item) => {
            const avatarSrc = item.avatarPath && SUPABASE_BASE_URL.length > 0 ? storageUrl(SUPABASE_BASE_URL, item.avatarPath) : null
            return (
            <li key={item.strategyId} className="flex items-center gap-2">
              <span className="relative shrink-0">
                <Avatar size="sm">
                  {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
                  <AvatarFallback className="bg-brand/15 text-[10px] font-semibold text-brand">
                    {item.creator.slice(0, 1).toLocaleUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {item.fresh ? <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-brand" /> : null}
              </span>
              <button
                type="button"
                className="no-drag min-w-0 flex-1 text-left"
                onClick={() => navigate(`/strategy/${item.strategyId}`)}
              >
                <span className="block truncate text-[12px] text-ink hover:text-brand">{item.name}</span>
                <span className="block truncate text-[10px] text-mute">
                  {`${item.creator} · ${relativeTime(item.createdAt, locale)}`}
                </span>
              </button>
              <button
                type="button"
                title={t('creator.markSeen')}
                onClick={() => seen.mutate(item.creatorId)}
                className="no-drag grid size-6 shrink-0 place-items-center rounded-md text-mute transition-colors hover:bg-panel-soft hover:text-ink"
              >
                <Check size={12} />
              </button>
            </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
