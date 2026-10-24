import { readSupabaseEnv } from '@tds/shared'

/**
 * The same env pair lib/supabase.ts uses, so a storage path can never resolve against a different
 * project than the queries do. Empty string means "not configured": storageUrl stays unused.
 */
export const SUPABASE_BASE_URL: string =
  readSupabaseEnv({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL as string | undefined,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  })?.url ?? ''
