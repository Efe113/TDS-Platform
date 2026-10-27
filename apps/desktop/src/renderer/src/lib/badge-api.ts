import { badgeCatalogSchema, type BadgeCatalog } from '@tds/shared'
import { supabase } from './supabase'
import { NotConfiguredError } from './discovery-api'

/**
 * The member's own badge shelf (0053). One round trip carries the catalogue, the criteria and the
 * caller's rollup, so the page cannot show a progress bar that disagrees with what the award engine
 * reads — both numbers come from the same SELECT.
 */
export async function fetchBadgeCatalog(): Promise<BadgeCatalog> {
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase.rpc('badge_catalog')
  if (error) throw new Error(error.message)
  return badgeCatalogSchema.parse(data ?? {})
}
