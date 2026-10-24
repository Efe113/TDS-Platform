import { createSupabaseClient, readSupabaseEnv } from '@tds/shared'

const env = readSupabaseEnv({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
})

/**
 * In-memory only: the main process owns token storage and refresh, so this client must never
 * persist or refresh on its own — two refreshers on one refresh token cause signed-outs.
 */
export const supabase = env ? createSupabaseClient(env, { persist: false }) : null

export const isSupabaseConfigured = (): boolean => supabase !== null
