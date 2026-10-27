import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, HardDrive, WifiOff } from 'lucide-react'
import type { StrategyCacheRow } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { useCatalogLanguage } from '../../lib/catalog-labels'
import { relativeTime } from '../../lib/text'
import { clearStrategyCache, fetchCachedStrategies, loadCachedStrategy } from '../../lib/strategy-cache'
import { useAppStore } from '../../store/app-store'
import { Banner, Button } from '../../components/ui'
import { Chip } from '../../components/ui/system'

/**
 * The documents main kept on disk (0.3.8). The list is the whole value of the feature: a member who lost
 * the connection mid-run has to be able to pick the run back up without the database answering.
 */

const QUERY_KEY = ['strategy-cache']

function useShelf(): { rows: StrategyCacheRow[]; isPending: boolean; error: unknown } {
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: fetchCachedStrategies, retry: 1, staleTime: 30_000 })
  return { rows: query.data ?? [], isPending: query.isPending, error: query.error }
}

function ShelfRow({ row, busy, onPick }: { row: StrategyCacheRow; busy: boolean; onPick: (key: string) => void }): ReactNode {
  const t = useT()
  const locale = useCatalogLanguage()

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel-soft px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-ink">{row.name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-mute">
          <span>{`${String(row.steps)} · ${relativeTime(new Date(row.savedAt).toISOString(), locale)}`}</span>
          {row.mapName ? <span className="truncate">{row.mapName}</span> : null}
          {row.isEventStrategy ? <Chip tone="warn">{t('overlay.eventRibbon')}</Chip> : null}
        </p>
      </div>
      <Button size="sm" variant="subtle" busy={busy} disabled={busy} onClick={() => onPick(row.key)}>
        <Download size={12} />
        {t('shelf.load')}
      </Button>
    </li>
  )
}

export function OfflineShelfTile(): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()
  const applyOverlayState = useAppStore((state) => state.applyOverlayState)
  const setOverlayVisible = useAppStore((state) => state.setOverlayVisible)
  const { rows, isPending, error } = useShelf()
  const [pickedName, setPickedName] = useState<string | null>(null)

  const load = useMutation({
    mutationFn: (key: string) => loadCachedStrategy(key),
    onSuccess: (state) => {
      applyOverlayState(state)
      setOverlayVisible(true)
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    }
  })

  if (!isPending && rows.length === 0 && error === null && !load.isError) return null

  return (
    <div className="space-y-2 rounded-xl border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="hud-label flex items-center gap-1.5">
          <WifiOff size={12} />
          {t('shelf.title')}
        </span>
        {rows.length > 0 ? <Chip tone="neutral">{t('shelf.count', { count: rows.length })}</Chip> : null}
      </div>

      {isPending ? <p className="text-[11px] text-mute">{t('common.loading')}</p> : null}
      {error instanceof Error ? <p className="text-[11px] text-danger">{error.message}</p> : null}
      {load.isError ? (
        <Banner tone="danger" title={t('common.errorTitle')}>
          {load.error instanceof Error ? load.error.message : String(load.error)}
        </Banner>
      ) : null}
      {load.isSuccess && pickedName !== null ? <p className="text-[11px] text-good">{t('shelf.loaded', { name: pickedName })}</p> : null}

      {rows.length > 0 ? (
        <ul className="space-y-1.5">
          {rows.slice(0, 4).map((row) => (
            <ShelfRow
              key={row.key}
              row={row}
              busy={load.isPending}
              onPick={(key) => {
                setPickedName(row.name)
                load.mutate(key)
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="text-[11px] leading-relaxed text-mute">{t('shelf.empty')}</p>
      )}
    </div>
  )
}

/** Privacy in the same place as every other erase: what this machine kept, and how to stop keeping it. */
export function OfflineShelfSection(): ReactNode {
  const t = useT()
  const queryClient = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const { rows } = useShelf()

  const clear = useMutation({
    mutationFn: clearStrategyCache,
    onSuccess: () => {
      setConfirm(false)
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    }
  })

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="hud-label flex items-center gap-1.5">
          <HardDrive size={12} />
          {t('shelf.title')}
        </span>
        <Chip tone={rows.length > 0 ? 'brand' : 'neutral'}>{t('shelf.count', { count: rows.length })}</Chip>
      </div>
      <p className="text-[10px] leading-relaxed text-mute">{t('shelf.hint')}</p>
      <Button size="sm" variant={confirm ? 'danger' : 'ghost'} busy={clear.isPending} disabled={rows.length === 0} onClick={() => setConfirm(true)}>
        {confirm ? t('shelf.clearConfirm') : t('shelf.clear')}
      </Button>
      {clear.isSuccess ? <p className="text-[10px] text-good">{t('shelf.cleared', { count: clear.data })}</p> : null}
      {clear.isError ? <p className="text-[10px] text-danger">{clear.error instanceof Error ? clear.error.message : String(clear.error)}</p> : null}
    </div>
  )
}

/** The staleness marker the rail and the card draw when the tracked document came off the disk. */
export function CachedBadge({ savedAt }: { savedAt: number }): ReactNode {
  const t = useT()
  const locale = useCatalogLanguage()
  return <Chip tone="warn">{t('shelf.cached', { when: relativeTime(new Date(savedAt).toISOString(), locale) })}</Chip>
}
