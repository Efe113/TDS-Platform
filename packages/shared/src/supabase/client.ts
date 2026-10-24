import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js'
import type { SessionSummary } from '../ipc/contract'

export interface SupabaseEnv {
  url: string
  anonKey: string
}

export function readSupabaseEnv(source: Record<string, string | undefined> = process.env): SupabaseEnv | null {
  const url = source.VITE_SUPABASE_URL ?? source.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = source.VITE_SUPABASE_ANON_KEY ?? source.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return { url, anonKey }
}

export function isSupabaseConfigured(source?: Record<string, string | undefined>): boolean {
  return readSupabaseEnv(source) !== null
}

/**
 * Only the publishable anon key belongs in a desktop build. The service-role key must never be
 * reachable from this process tree; every privileged write goes through a definer RPC.
 */
export function createSupabaseClient(env: SupabaseEnv, opts: { persist?: boolean } = {}): SupabaseClient {
  return createClient(env.url, env.anonKey, {
    auth: {
      persistSession: opts.persist ?? true,
      autoRefreshToken: opts.persist ?? true,
      detectSessionInUrl: false,
      flowType: 'pkce'
    }
  })
}

/**
 * `app_metadata.provider` keeps whatever wrote the account last, so an email account that later
 * links Discord can still report `email`. The identity list is the trustworthy source.
 */
function resolveProvider(user: Session['user']): string | null {
  const metadata = (user.app_metadata ?? {}) as { provider?: string }
  const identities = (user as unknown as { identities?: { provider?: string }[] }).identities
  const amr = (user as unknown as { amr?: (string | { method?: string; provider?: string })[] }).amr

  const nonPasswordMethods = ['password', 'otp', 'refresh']
  const fromAmr = (amr ?? [])
    .map((entry) => (typeof entry === 'string' ? entry : (entry.provider ?? entry.method)))
    .filter((value): value is string => typeof value === 'string' && !nonPasswordMethods.includes(value))

  const linked = (identities ?? []).map((identity) => identity.provider).filter((value): value is string => Boolean(value))

  if (metadata.provider && metadata.provider !== 'email') return metadata.provider
  return linked[0] ?? fromAmr[0] ?? metadata.provider ?? null
}

/** Providers disagree on the key name: Discord sends `avatar_url`, most others `picture`. */
function readAvatarUrl(user: Session['user']): string | null {
  const metadata = (user.user_metadata ?? {}) as { avatar_url?: string; picture?: string }
  const value = (metadata.avatar_url ?? metadata.picture ?? '').trim()
  // The string lands in an <img src>, and the page's CSP only allows https, so anything else is null.
  return /^https:\/\//i.test(value) ? value : null
}

export function sessionSummary(session: Session | null): SessionSummary {
  if (!session) return { userId: null, email: null, provider: null, expiresAt: null, role: null, handle: null, avatarUrl: null }
  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    provider: resolveProvider(session.user),
    expiresAt: session.expires_at ?? null,
    role: session.user.app_metadata.role ?? null,
    handle: null,
    // OAuth avatars ride in on the token's own metadata, unlike the handle, which lives in `profiles`.
    avatarUrl: readAvatarUrl(session.user)
  }
}
