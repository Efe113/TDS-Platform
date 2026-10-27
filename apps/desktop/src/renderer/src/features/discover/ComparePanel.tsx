import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { ArrowRight, X } from 'lucide-react'
import { formatWaveRange, formatLeaderboardScore, type SearchRow } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { navigate } from '../../lib/router'
import { relativeTime } from '../../lib/text'
import { useCatalogLanguage, difficultyEntry } from '../../lib/catalog-labels'
import { Button, cn } from '../../components/ui'
import { Chip } from '../../components/ui/system'

/**
 * Side-by-side comparison. The point is to answer "which of these do I actually run" without opening
 * three tabs: same rows for every column, so the eye compares values rather than layouts.
 */
export function ComparePanel({
  rows,
  mapNames,
  onRemove,
  onClose
}: {
  rows: SearchRow[]
  mapNames: Map<string, string>
  onRemove: (id: string) => void
  onClose: () => void
}): ReactNode {
  const t = useT()
  const language = useCatalogLanguage()

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rowsMeta = [
    {
      label: t('discover.cmpDifficulty'),
      value: (row: SearchRow): string => {
        const difficulty = difficultyEntry(row.difficulty)
        return difficulty.labelKey ? t(difficulty.labelKey) : row.difficulty
      }
    },
    { label: t('discover.cmpMode'), value: (row: SearchRow): string => (row.game_mode === 'unknown' ? '—' : row.game_mode) },
    { label: t('discover.cmpPlayers'), value: (row: SearchRow): string => row.player_count || '—' },
    { label: t('discover.cmpWaves'), value: (row: SearchRow): string => formatWaveRange(row.wave_from, row.wave_to) ?? '—' },
    {
      label: t('discover.cmpRating'),
      value: (row: SearchRow): string =>
        row.rating_count > 0 && row.rating_avg !== null ? `${row.rating_avg.toFixed(1)} · ${String(row.rating_count)}` : '—'
    },
    { label: t('discover.cmpUses'), value: (row: SearchRow): string => formatLeaderboardScore(row.times_used) },
    { label: t('discover.cmpTrend'), value: (row: SearchRow): string => `+${String(row.trend_7d ?? 0)}` },
    { label: t('discover.cmpUpdated'), value: (row: SearchRow): string => relativeTime(row.updated_at, language) }
  ]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('discover.compareTitle')}
      onClick={onClose}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/78 p-4 sm:items-center"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="hud-panel max-h-[85vh] w-full max-w-4xl overflow-y-auto p-4"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{t('discover.compareTitle')}</h2>
            <p className="text-[11px] text-mute">{t('discover.compareHint')}</p>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="no-drag grid size-7 place-items-center rounded-md border border-line text-mute transition-colors hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>

        {rows.length < 2 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11px] text-mute">{t('discover.compareEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr>
                  <th className="w-32 pb-2 text-[10px] font-semibold uppercase tracking-widest text-mute/70">{t('discover.results')}</th>
                  {rows.map((row) => (
                    <th key={row.id} className="min-w-44 px-2 pb-2 align-bottom">
                      <div className="flex items-start justify-between gap-1">
                        <button
                          type="button"
                          className="no-drag min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-ink hover:text-brand"
                          onClick={() => navigate(`/strategy/${row.id}`)}
                        >
                          {row.name}
                        </button>
                        <button
                          type="button"
                          aria-label={t('discover.remove')}
                          onClick={() => onRemove(row.id)}
                          className="no-drag grid size-5 shrink-0 place-items-center rounded text-mute hover:text-danger"
                        >
                          <X size={11} />
                        </button>
                      </div>
                      {row.map_key ? <span className="mt-1 block"><Chip>{mapNames.get(row.map_key) ?? row.map_key}</Chip></span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsMeta.map((meta, index) => (
                  <tr key={meta.label} className={cn(index % 2 === 0 ? 'bg-panel-soft/40' : undefined)}>
                    <td className="py-1.5 pl-1 text-[10px] font-medium uppercase tracking-widest text-mute/70">{meta.label}</td>
                    {rows.map((row) => (
                      <td key={row.id} className="hud-num px-2 py-1.5 text-ink">
                        {meta.value(row)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td />
                  {rows.map((row) => (
                    <td key={row.id} className="px-2 pt-2">
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/strategy/${row.id}`)}>
                        {t('discover.cmpOpen')}
                        <ArrowRight size={12} />
                      </Button>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
