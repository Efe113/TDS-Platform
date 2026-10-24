import { publishErrorKey, type StrategyIr, type TranslationKey } from '@tds/shared'
import type { PostgrestError } from '@supabase/supabase-js'
import { NotConfiguredError } from './discovery-api'
import { supabase } from './supabase'

export class PublishError extends Error {
  constructor(
    readonly messageKey: TranslationKey,
    readonly rawMessage: string
  ) {
    super(rawMessage)
    this.name = 'PublishError'
  }
}

/**
 * PostgREST puts the server's DETAIL/HINT (and often the PL/pgSQL CONTEXT line naming the failing
 * statement) in fields beside `message`. Dropping them turns every real bug into a guess.
 */
function describe(error: PostgrestError): string {
  const parts = [error.message]
  if (error.code) parts.push(`code=${error.code}`)
  if (error.details) parts.push(`details=${error.details}`)
  if (error.hint) parts.push(`hint=${error.hint}`)
  return parts.join(' | ')
}

/**
 * One server call, one transaction: submit_strategy() creates the owned row plus draft snapshot
 * and immediately versions it as submitted. Two separate calls used to leave a committed
 * 'imported' row behind whenever the second half failed, and the retry then collided with that
 * row on strategies_slug_key. Slug uniqueness and owner binding stay server-side either way.
 */
export async function submitForReview(
  ir: StrategyIr,
  source: { sha256?: string; url?: string } = {}
): Promise<string> {
  if (!supabase) throw new NotConfiguredError()

  const submitted = await supabase.rpc('submit_strategy', {
    p_ir: ir,
    p_source_sha256: source.sha256 ?? null,
    p_source_url: source.url ?? null
  })
  if (submitted.error) throw new PublishError(publishErrorKey(submitted.error.message), describe(submitted.error))

  return submitted.data as string
}

export async function listOwnStrategies(): Promise<Array<{ id: string; name: string; status: string; slug: string }>> {
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase
    .from('strategies')
    .select('id,name,status,slug')
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? (data as Array<{ id: string; name: string; status: string; slug: string }>) : []
}
