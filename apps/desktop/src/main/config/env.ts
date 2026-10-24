import { readSupabaseEnv, type SupabaseEnv } from '@tds/shared'

// electron-vite's `define` only substitutes direct `process.env.VITE_*` member expressions, so
// the properties are lifted here rather than handing the whole `process.env` object to a helper.
export const supabaseEnv: SupabaseEnv | null = readSupabaseEnv({
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY
})

export const isSupabaseConfigured = (): boolean =>
  Boolean(supabaseEnv?.url && supabaseEnv?.anonKey)
