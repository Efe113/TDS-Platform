import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseClient, sessionStorageAction, sessionSummary, type AuthSessionPayload, type SessionSummary } from '@tds/shared'
import { isSupabaseConfigured, supabaseEnv } from '../config/env'
import { clearSession, loadSession, saveSession } from './storage'
import { AUTH_RETURN_TO, parseAuthCallback } from './callback'
import { logger } from '../log'

const REFRESH_AHEAD_MS = 5 * 60 * 1000

export type AuthOutcome =
  | { ok: true; session: SessionSummary }
  | { ok: false; error: string }

export interface AuthManagerDeps {
  broadcast: (payload: AuthSessionPayload) => void
}

export class AuthManager {
  private client: SupabaseClient | null = null
  private timer: NodeJS.Timeout | null = null
  private unsubscribe: (() => void) | null = null
  private payload: AuthSessionPayload = { summary: sessionSummary(null), tokens: null }
  private _lastError: string | null = null
  private deps: AuthManagerDeps = { broadcast: () => undefined }

  get configured(): boolean {
    return isSupabaseConfigured()
  }

  get lastError(): string | null {
    return this._lastError
  }

  /**
   * The authenticated client, or null before init/when unconfigured. The usage service needs it and
   * must degrade to "not counted" rather than throw, so this is a nullable getter instead of the
   * throwing private requireClient().
   */
  get db(): SupabaseClient | null {
    return this.client
  }

  init(deps: AuthManagerDeps): void {
    this.deps = deps
    if (!this.configured) {
      logger.warn('Supabase is not configured; sign-in is disabled')
      return
    }

    this.client = createSupabaseClient(supabaseEnv as NonNullable<typeof supabaseEnv>, { persist: false })

    // Subscribe only after the stored session has been restored. The state-change callback always
    // delivers an INITIAL_SESSION for whatever is in memory right now, and with persistence off that is
    // null at boot — so subscribing first used to delete session.bin before the asynchronous file read
    // had even finished, and every launch started signed out.
    void this.restoreStoredSession().finally(() => this.subscribeToState())
  }

  private subscribeToState(): void {
    if (!this.client) return
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      const action = sessionStorageAction(event, session !== null)
      if (action === 'persist' && session) {
        this.persist(session)
        this.scheduleRefresh(session)
      } else if (action === 'clear') {
        clearSession()
      }
      this.publish()
    })
    this.unsubscribe = () => data.subscription.unsubscribe()
  }

  private async restoreStoredSession(): Promise<void> {
    if (!this.client) return
    const stored = await loadSession()
    if (!stored) return

    let parsed: { access_token?: string; refresh_token?: string }
    try {
      parsed = JSON.parse(stored) as typeof parsed
    } catch {
      // A truncated session file must never block app startup.
      clearSession()
      return
    }
    if (!parsed.access_token || !parsed.refresh_token) {
      logger.warn('stored session has no tokens; it was written by an older shape and is dropped')
      clearSession()
      return
    }

    try {
      await this.client.auth.setSession({
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token
      })
      await this.publish()
    } catch (error) {
      logger.warn('stored session could not be restored', error)
      clearSession()
    }
  }

  current(): AuthSessionPayload {
    return this.payload
  }

  async signIn(email: string, password: string): Promise<AuthOutcome> {
    const client = this.requireClient()
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (error) return this.fail(error.message)
    this.persist(data.session)
    this.publish()
    this.scheduleRefresh(data.session)
    return { ok: true, session: sessionSummary(data.session) }
  }

  async signUp(email: string, password: string, displayName?: string): Promise<AuthOutcome> {
    const client = this.requireClient()
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName ?? null } }
    })
    if (error) return this.fail(error.message)
    if (!data.session) return { ok: false, error: 'CONFIRMATION_REQUIRED' }
    this.persist(data.session)
    this.publish()
    return { ok: true, session: sessionSummary(data.session) }
  }

  async startOAuth(provider: 'discord'): Promise<AuthOutcome & { url?: string }> {
    const client = this.requireClient()
    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: AUTH_RETURN_TO, skipBrowserRedirect: true }
    })
    if (error || !data?.url) return { ok: false, error: error?.message ?? 'NO_AUTH_URL' } as AuthOutcome & { url?: string }
    return { ok: true, session: sessionSummary(null), url: data.url }
  }

  async handleCallback(rawUrl: string): Promise<AuthOutcome> {
    const client = this.requireClient()
    const parsed = parseAuthCallback(rawUrl)
    if (!parsed) return this.fail('Bu bağlantı bir doğrulama geri dönüşü değil.')
    if (parsed.error) return this.fail(parsed.errorDescription ?? parsed.error)

    if (parsed.code) {
      const { data, error } = await client.auth.exchangeCodeForSession(parsed.code)
      if (error) return this.fail(error.message)
      this.persist(data.session)
      this.publish()
      this.scheduleRefresh(data.session)
      return { ok: true, session: sessionSummary(data.session) }
    }

    if (parsed.accessToken && parsed.refreshToken) {
      const { data, error } = await client.auth.setSession({
        access_token: parsed.accessToken,
        refresh_token: parsed.refreshToken
      })
      if (error) return this.fail(error.message)
      this.persist(data.session)
      this.publish()
      return { ok: true, session: sessionSummary(data.session) }
    }

    return this.fail('Geri dönüş bağlantısında kod bulunamadı.')
  }

  async signOut(): Promise<AuthOutcome> {
    if (!this.client) return { ok: true, session: sessionSummary(null) }
    const { error } = await this.client.auth.signOut({ scope: 'local' })
    clearSession()
    this.publish()
    if (error) return this.fail(error.message)
    return { ok: true, session: sessionSummary(null) }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new Error('Supabase yapılandırılmamış; .env.local içine VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY yaz.')
    return this.client
  }

  private fail(message: string): AuthOutcome {
    this._lastError = message
    logger.warn(`auth failed: ${message}`)
    return { ok: false, error: message }
  }

  private persist(session: Session | null): void {
    if (!session) {
      clearSession()
      return
    }
    void saveSession(JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token })).catch(
      (error) => logger.warn('could not persist session', error)
    )
  }

  private publish(): void {
    const build = (session: Session | null): AuthSessionPayload => ({
      summary: sessionSummary(session),
      tokens: session ? { accessToken: session.access_token, refreshToken: session.refresh_token } : null
    })

    if (!this.client) {
      this.payload = build(null)
      this.deps.broadcast(this.payload)
      return
    }

    void this.client.auth
      .getSession()
      .then(({ data }) => {
        this.payload = build(data.session)
        this.deps.broadcast(this.payload)
      })
      .catch(() => {
        this.payload = build(null)
        this.deps.broadcast(this.payload)
      })
  }

  private scheduleRefresh(session: Session | null): void {
    if (this.timer) clearTimeout(this.timer)
    if (!session?.expires_at || !this.client) return
    const delay = Math.max(30_000, session.expires_at * 1000 - Date.now() - REFRESH_AHEAD_MS)
    this.timer = setTimeout(() => {
      void this.client
        ?.auth.refreshSession()
        .then(({ data }) => {
          this.persist(data.session)
          this.publish()
          this.scheduleRefresh(data.session)
        })
        .catch((error) => logger.warn('token refresh failed', error))
    }, delay)
    this.timer.unref?.()
  }
}

export const authManager = new AuthManager()
