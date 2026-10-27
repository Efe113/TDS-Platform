import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, CheckCheck } from 'lucide-react'
import { motion } from 'framer-motion'
import { useT } from '../../i18n/use-t'
import { navigate } from '../../lib/router'
import { fetchWatchUpdates, markWatchSeen } from '../../lib/intelligence-api'
import { selectSignedIn, useAuth } from '../../store/auth-store'
import { useMotion } from '../../motion/context'
import { Menu, MenuContent, MenuDivider, MenuFooter, MenuHeader, MenuItem, MenuTrigger } from '../../components/ui/menu'

/**
 * Watch updates used to live only on the home tile, so a member who opened the app straight into
 * Discover never saw that a strategy they run got a new version. The bell is the same 0023 read with
 * a shell-wide position, and opening an entry marks it seen so the count is honest.
 */
export function WatchBell(): ReactNode {
  const t = useT()
  const signedIn = useAuth(selectSignedIn)
  const { reduced } = useMotion()
  const queryClient = useQueryClient()

  const updates = useQuery({
    queryKey: ['watch', 'updates'],
    queryFn: fetchWatchUpdates,
    enabled: signedIn,
    retry: 1,
    staleTime: 60_000
  })
  const rows = updates.data ?? []

  const seen = useMutation({
    mutationFn: async (strategyIds: string[]) => {
      for (const id of strategyIds) await markWatchSeen(id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['watch'] })
    }
  })

  if (!signedIn || rows.length === 0) return null

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          title={t('shell.watchUpdatesTitle')}
          className="no-drag relative flex items-center gap-1 rounded-none px-2 text-mute transition-colors hover:bg-panel-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          <BellRing size={13} className="text-brand" />
          <span className="hud-num text-[11px] text-ink">{String(rows.length)}</span>
          {!reduced ? (
            <motion.span
              aria-hidden
              initial={false}
              animate={{ opacity: [0.9, 0.2, 0.9] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-brand"
            />
          ) : null}
        </button>
      </MenuTrigger>

      <MenuContent align="end" side="bottom" className="w-80">
        <MenuHeader>
          <span className="block text-sm font-semibold text-ink">{t('shell.watchUpdatesTitle')}</span>
          <span className="block text-[11px] text-mute">{t('shell.watchUpdatesHint')}</span>
        </MenuHeader>
        <MenuDivider />
        {rows.slice(0, 6).map((entry, index) => (
          <MenuItem
            key={entry.strategyId}
            icon={BellRing}
            index={index}
            aside={`v${String(entry.fromVersion ?? '?')} → v${String(entry.toVersion ?? '?')}`}
            onSelect={() => {
              navigate(`/strategy/${entry.strategyId}`)
              seen.mutate([entry.strategyId])
            }}
          >
            {entry.name}
          </MenuItem>
        ))}
        {rows.length > 1 ? (
          <MenuItem
            icon={CheckCheck}
            index={6}
            disabled={seen.isPending}
            onSelect={() => seen.mutate(rows.map((entry) => entry.strategyId))}
          >
            {t('shell.watchAllSeen')}
          </MenuItem>
        ) : null}
        <MenuFooter>{t('detail.watchCount', { count: rows.length })}</MenuFooter>
      </MenuContent>
    </Menu>
  )
}
