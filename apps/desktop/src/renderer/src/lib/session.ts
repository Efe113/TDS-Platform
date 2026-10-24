import { useAuth } from '../store/auth-store'

/**
 * Every Supabase read must wait until the in-memory client actually holds the token from main.
 * Without this, `signedIn` flips true a tick before `setSession()` resolves and the first burst of
 * queries (wallet, profile, consent) goes out unauthenticated - the 401/400 stack in the console.
 */
export function whenSessionReady(): Promise<void> {
  if (useAuth.getState().clientReady) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = useAuth.subscribe((state) => {
      if (!state.clientReady) return
      unsubscribe()
      resolve()
    })
    // A missing bridge must not hang a page forever; the caller will surface its own error.
    window.setTimeout(() => {
      unsubscribe()
      resolve()
    }, 4000)
  })
}
