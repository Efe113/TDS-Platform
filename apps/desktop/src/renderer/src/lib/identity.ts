import { useQuery } from '@tanstack/react-query'
import { buildIdentity, type Identity } from '@tds/shared'
import { selectSignedIn, selectUserId, useAuth } from '../store/auth-store'
import { fetchShowcase } from './profile-api'
import { supabase } from './supabase'

/**
 * One cache key for the profile card, used by the shell, the sidebar and the profile page itself.
 * It used to be two keys ('profile', id) and ('profile', id, 'showcase'), which meant the same RPC
 * ran twice and an invalidation from the sidebar missed the profile page.
 */
export function showcaseQueryKey(userId: string | null): readonly ['profile', string | null, 'showcase'] {
  return ['profile', userId, 'showcase'] as const
}

/**
 * The name the shell shows. `summary.handle` is always null (the JWT has no user name), so the
 * profile row is the source and the email local part is the fallback - and "am I signed in" comes
 * from the session, never from whether a name was found.
 */
export function useIdentity(): Identity {
  const signedIn = useAuth(selectSignedIn)
  const userId = useAuth(selectUserId)
  const summary = useAuth((state) => state.payload.summary)

  const showcase = useQuery({
    queryKey: showcaseQueryKey(userId),
    queryFn: () => fetchShowcase(userId ?? ''),
    enabled: signedIn && userId !== null && supabase !== null,
    staleTime: 60_000,
    retry: 1
  })

  return buildIdentity({
    signedIn,
    handle: showcase.data?.handle ?? null,
    displayName: showcase.data?.displayName ?? null,
    email: summary.email,
    userId,
    role: summary.role,
    provider: summary.provider,
    avatarUrl: summary.avatarUrl
  })
}
