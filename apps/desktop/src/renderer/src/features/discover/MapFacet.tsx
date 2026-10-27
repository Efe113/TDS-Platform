import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { useT } from '../../i18n/use-t'
import { cn } from '../../lib/utils'
import { INPUT_CLASS } from '../../components/ui'

/** A map row: its catalogue key, how many published strategies use it, and the label the user reads. */
interface MapRow {
  key: string
  label: string
  count: number
}

/** How many rows a group shows before the reader has to ask for the rest. */
const VISIBLE = 10

function FacetRow({ row, active, onClick }: { row: MapRow; active: boolean; onClick: () => void }): ReactNode {
  return (
    <button
      type="button"
      data-press
      onClick={onClick}
      className={cn(
        'no-drag flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[12px] transition-colors',
        active ? 'bg-brand/15 text-ink' : 'text-mute hover:bg-panel-soft hover:text-ink',
        !active && row.count === 0 && 'text-mute/55'
      )}
    >
      <span className="truncate">{row.label}</span>
      <span className={cn('hud-num shrink-0 text-[10px]', row.count === 0 ? 'text-mute/40' : 'text-mute/80')}>{String(row.count)}</span>
    </button>
  )
}

function GroupToggle({ label, count, open, onToggle }: { label: string; count: number; open: boolean; onToggle: () => void }): ReactNode {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="no-drag flex w-full items-center gap-1.5 px-2 pt-1.5 text-[10px] font-semibold uppercase tracking-widest text-mute/70 transition-colors hover:text-ink"
    >
      <ChevronDown size={11} className={cn('shrink-0 transition-transform duration-200', !open && '-rotate-90')} />
      {label}
      <span className="hud-num ml-auto text-[10px] text-mute/60">{String(count)}</span>
    </button>
  )
}

/**
 * The map filter used to be one flat list of every map in the catalogue — 134 rows, most of them with
 * zero published strategies, which turned the filter panel into a scroll that buried every other filter.
 *
 * So the list is now searched, grouped and capped: maps that actually have results first (count order),
 * the empty catalogue entries behind a toggle, and a bounded height so the panel never outgrows the
 * screen. The selected map stays pinned where the eye left it.
 */
export function MapFacet({
  keys,
  names,
  buckets,
  selected,
  total,
  onSelect
}: {
  keys: string[]
  names: Map<string, string>
  buckets: Array<{ key: string; count: number }>
  selected: string | null
  total: number
  onSelect: (next: string | null) => void
}): ReactNode {
  const t = useT()
  const [needle, setNeedle] = useState('')
  const [showEmpty, setShowEmpty] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const rows = useMemo<MapRow[]>(() => {
    const counts = new Map(buckets.map((bucket) => [bucket.key, bucket.count]))
    const every = new Set([...keys, ...counts.keys()])
    const list: MapRow[] = []
    for (const key of every) {
      const label = names.get(key) ?? key
      if (needle.length > 0 && !label.toLocaleLowerCase('tr').includes(needle.toLocaleLowerCase('tr'))) continue
      list.push({ key, label, count: counts.get(key) ?? 0 })
    }
    return list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'tr'))
  }, [buckets, keys, names, needle])

  const filled = rows.filter((row) => row.count > 0 || row.key === selected)
  const empty = rows.filter((row) => row.count === 0 && row.key !== selected)
  const visible = showAll || needle.length > 0 ? filled : filled.slice(0, VISIBLE)
  const pinned = selected !== null && !visible.some((row) => row.key === selected) ? rows.find((row) => row.key === selected) ?? null : null

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
        <input
          className={cn(INPUT_CLASS, 'no-drag h-7 py-0.5 pl-7 pr-7 text-[11px]')}
          placeholder={t('discover.mapSearch')}
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
        />
        {needle.length > 0 ? (
          <button
            type="button"
            aria-label={t('discover.clearFilters')}
            onClick={() => setNeedle('')}
            className="no-drag absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-mute hover:text-ink"
          >
            <X size={10} />
          </button>
        ) : null}
      </div>

      <div className="max-h-80 space-y-0.5 overflow-y-auto pr-0.5">
        <FacetRow
          row={{ key: '', label: t('discover.allMaps'), count: total }}
          active={selected === null}
          onClick={() => onSelect(null)}
        />
        {pinned ? (
          <FacetRow row={pinned} active onClick={() => onSelect(selected)} />
        ) : null}
        {visible.map((row) => (
          <FacetRow key={row.key} row={row} active={row.key === selected} onClick={() => onSelect(row.key === selected ? null : row.key)} />
        ))}

        {needle.length === 0 && filled.length > VISIBLE ? (
          <button
            type="button"
            onClick={() => setShowAll((current) => !current)}
            className="no-drag w-full rounded-md px-2 py-1 text-left text-[11px] text-brand transition-colors hover:text-ink"
          >
            {showAll ? t('discover.showFewer') : t('discover.showAllMaps', { count: String(filled.length) })}
          </button>
        ) : null}

        {empty.length > 0 && needle.length === 0 ? (
          <>
            <GroupToggle label={t('discover.mapNoStrategies')} count={empty.length} open={showEmpty} onToggle={() => setShowEmpty((current) => !current)} />
            {showEmpty
              ? empty.map((row) => <FacetRow key={row.key} row={row} active={row.key === selected} onClick={() => onSelect(row.key === selected ? null : row.key)} />)
              : null}
          </>
        ) : null}

        {rows.length === 0 ? <p className="px-2 py-1 text-[11px] text-mute">{t('discover.mapNoMatch')}</p> : null}
      </div>
    </div>
  )
}
