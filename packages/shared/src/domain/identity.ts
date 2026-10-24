/**
 * Identity for the shell.
 *
 * `sessionSummary()` is a JWT projection and its `handle` is always null - the user name lives in the
 * `profiles` row, which the app reads through profile_showcase. Before this existed every surface
 * rendered `summary.handle ?? 'signed out'`, so a signed-in user with a null handle was told they
 * were not signed in. The rule this module enforces: signed-in-ness is never inferred from a string
 * being present, and the display name has an ordered fallback chain instead of a single field.
 */

export type IdentitySource = 'profile' | 'email' | 'id' | 'anon'

export interface IdentityInput {
  signedIn: boolean
  handle: string | null
  displayName: string | null
  email: string | null
  userId: string | null
  role: string | null
  provider: string | null
  /** Avatar the OAuth provider handed us in the token metadata. */
  avatarUrl?: string | null
  /** Avatar stored on the profile row, which wins over the provider's once the user uploads one. */
  profileAvatarUrl?: string | null
}

export interface Identity {
  signedIn: boolean
  source: IdentitySource
  /** The raw handle when the profile has one; null otherwise, so links can still point at a profile. */
  handle: string | null
  /** Never empty while signed in. */
  display: string
  initials: string
  email: string | null
  userId: string | null
  role: string | null
  provider: string | null
  avatarUrl: string | null
}

export function emailLocalName(email: string | null | undefined): string | null {
  const value = (email ?? '').trim()
  if (value.length === 0) return null
  const local = value.split('@')[0] ?? ''
  return local.length > 0 ? local : null
}

export function initialsFrom(value: string | null | undefined): string {
  const text = (value ?? '').trim()
  if (text.length === 0) return '?'
  const parts = text.split(/[\s._@-]+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const second = parts.length > 1 ? (parts[1]?.[0] ?? '') : ''
  return (first + second).toLocaleUpperCase()
}

export function buildIdentity(input: IdentityInput): Identity {
  if (!input.signedIn) {
    return {
      signedIn: false,
      source: 'anon',
      handle: null,
      display: '',
      initials: '?',
      email: null,
      userId: null,
      role: null,
      provider: null,
      avatarUrl: null
    }
  }

  const handle = input.handle?.trim() || null
  const displayName = input.displayName?.trim() || null
  const localName = emailLocalName(input.email)
  const shortId = input.userId ? input.userId.slice(0, 6) : null

  const display = displayName ?? handle ?? localName ?? shortId ?? ''
  const source: IdentitySource = displayName !== null || handle !== null ? 'profile' : localName !== null ? 'email' : 'id'

  return {
    signedIn: true,
    source,
    handle,
    display,
    initials: initialsFrom(displayName ?? handle ?? localName ?? shortId),
    email: input.email,
    userId: input.userId,
    role: input.role,
    provider: input.provider,
    // The profile row wins once an uploaded avatar exists; the OAuth one is the fallback.
    avatarUrl: input.profileAvatarUrl ?? input.avatarUrl ?? null
  }
}

/** The subtitle under the name: never a name-shaped guess, always what the account actually is. */
export function identitySubtitle(identity: Identity): string {
  const provider = identity.provider ?? 'email'
  const role = identity.role ?? 'user'
  return `${provider} · ${role}`
}
