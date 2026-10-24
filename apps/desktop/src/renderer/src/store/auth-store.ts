import { create } from 'zustand'
import {
  IPC_CHANNELS,
  authSessionPayloadSchema,
  sessionSummary,
  type AuthSessionPayload
} from '@tds/shared'
import { call, subscribe } from '../lib/ipc'
import { supabase } from '../lib/supabase'
import type { MessageKey } from '../i18n/resources'

const EMPTY: AuthSessionPayload = { summary: sessionSummary(null), tokens: null }

interface AuthState {
  payload: AuthSessionPayload
  ready: boolean
  /** True only after the access token is installed in the renderer's Supabase client. */
  clientReady: boolean
  busy: boolean
  errorKey: MessageKey | null
  applyPayload: (payload: AuthSessionPayload) => void
  signIn: (email: string, password: string) => Promise<boolean>
  signUp: (email: string, password: string, displayName?: string) => Promise<boolean>
  signOut: () => Promise<void>
  startDiscord: () => Promise<boolean>
}

interface AuthResult {
  ok: boolean
  error?: string
}

let installedAccessToken: string | null = null

async function installIntoClient(payload: AuthSessionPayload): Promise<void> {
  if (!supabase) return
  const token = payload.tokens?.accessToken ?? null
  if (token === installedAccessToken) return
  installedAccessToken = token
  if (!payload.tokens) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    return
  }
  await supabase.auth
    .setSession({ access_token: payload.tokens.accessToken, refresh_token: payload.tokens.refreshToken })
    .catch(() => undefined)
}

export async function refreshFromMain(): Promise<void> {
  try {
    const payload = authSessionPayloadSchema.parse(await call(IPC_CHANNELS.authGetSession))
    useAuth.getState().applyPayload(payload)
  } catch {
    useAuth.setState({ ready: true })
  }
}

export const useAuth = create<AuthState>((set) => ({
  payload: EMPTY,
  ready: false,
  clientReady: false,
  busy: false,
  errorKey: null,

  applyPayload: (payload) => {
    // The summary can render immediately, but reads must wait for the token (see lib/session.ts).
    set({ payload, ready: true, clientReady: payload.tokens === null })
    void installIntoClient(payload).then(() => set({ clientReady: true }))
  },

  signIn: async (email, password) => {
    set({ busy: true, errorKey: null })
    const result = await call<AuthResult>(IPC_CHANNELS.authSignIn, { email, password }).catch(
      (): AuthResult => ({ ok: false })
    )
    set({ busy: false })
    if (!result.ok) {
      set({ errorKey: /invalid|incorrect/i.test(result.error ?? '') ? 'auth.errorInvalid' : 'auth.errorUnknown' })
      return false
    }
    await refreshFromMain()
    return true
  },

  signUp: async (email, password, displayName) => {
    set({ busy: true, errorKey: null })
    const result = await call<AuthResult>(IPC_CHANNELS.authSignUp, { email, password, displayName }).catch(
      (): AuthResult => ({ ok: false })
    )
    set({ busy: false })
    if (!result.ok) {
      set({
        errorKey: result.error === 'CONFIRMATION_REQUIRED' ? 'auth.confirmEmailHint' : 'auth.errorUnknown'
      })
      return false
    }
    await refreshFromMain()
    return true
  },

  signOut: async () => {
    set({ busy: true, errorKey: null })
    await call(IPC_CHANNELS.authSignOut).catch(() => undefined)
    installedAccessToken = null
    // Supabase answers 403 when there is no valid JWT to revoke; that is already the desired state.
    try {
      const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
      if (data.session) await supabase?.auth.signOut({ scope: 'local' })
    } catch {
      // ignore: the local state is cleared below either way
    }
    set({ busy: false, payload: EMPTY, clientReady: true })
    await refreshFromMain()
  },

  startDiscord: async () => {
    set({ busy: true, errorKey: null })
    const result = await call<AuthResult>(IPC_CHANNELS.authOauthStart, { provider: 'discord' }).catch(
      (): AuthResult => ({ ok: false })
    )
    set({ busy: false })
    if (!result.ok) {
      set({ errorKey: result.error === 'NO_AUTH_URL' ? 'auth.notConfigured' : 'auth.discordUnavailable' })
      return false
    }
    return true
  }
}))

export function initAuth(): () => void {
  const unsubscribe = subscribe(IPC_CHANNELS.authTokenChanged, (raw) => {
    const parsed = authSessionPayloadSchema.safeParse(raw)
    if (parsed.success) useAuth.getState().applyPayload(parsed.data)
  })
  void refreshFromMain()
  return unsubscribe
}

export const selectSignedIn = (state: AuthState): boolean => state.payload.summary.userId !== null
export const selectUserId = (state: AuthState): string | null => state.payload.summary.userId
export const selectRole = (state: AuthState): string | null => state.payload.summary.role
