import { useQuery } from '@tanstack/react-query'
import { towerCatalogRowSchema } from '@tds/shared'
import { supabase } from './supabase'
import { NotConfiguredError } from './discovery-api'

/**
 * The tower catalogue in the member's language (0038).
 *
 * The overlay card has carried a `towerLabelTr` field since the overlay existed and nobody ever
 * produced it, so a Turkish member tracking a Turkish strategy still saw the prettified English
 * catalog key. The main process has no database connection — it only draws what the renderer hands it —
 * so the map has to travel with the strategy when tracking starts.
 *
 * One read for the whole session: ~70 rows, cached by react-query, and the overlay is the only place
 * that pays for it.
 */
export async function fetchTowerNamesTr(): Promise<Record<string, string>> {
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase.from('towers').select('key,name_en,name_tr').order('key')
  if (error) throw new Error(error.message)
  const rows = towerCatalogRowSchema.array().parse(data ?? [])
  const out: Record<string, string> = {}
  for (const row of rows) {
    const name = row.name_tr.trim()
    if (name.length > 0) out[row.key] = name
  }
  return out
}

export function useTowerNamesTr(): Record<string, string> {
  const query = useQuery({
    queryKey: ['catalog', 'tower-names-tr'],
    queryFn: fetchTowerNamesTr,
    staleTime: 30 * 60_000,
    retry: 1,
    enabled: supabase !== null
  })
  return query.data ?? {}
}
