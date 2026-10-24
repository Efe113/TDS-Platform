import { describe, expect, it } from 'vitest'
import { buildIdentity, emailLocalName, identitySubtitle, initialsFrom } from '../src/domain/identity'

const base = { signedIn: true, handle: null, displayName: null, email: null, userId: null, role: null, provider: null }

describe('shell identity', () => {
  it('never reads "signed in" from the presence of a name', () => {
    // This is the bug the screenshot showed: a signed-in session whose handle was null rendered the
    // signed-out label, because the UI asked a string instead of the session.
    const identity = buildIdentity({ ...base, userId: 'f3983eb8-293d-4f4b-9494-01295884e792', provider: 'email', role: 'admin' })
    expect(identity.signedIn).toBe(true)
    expect(identity.display).toBe('f3983e')
    expect(identity.source).toBe('id')
  })

  it('prefers the profile name, then the handle, then the email local part', () => {
    expect(buildIdentity({ ...base, displayName: 'Efe', handle: 'efe' }).display).toBe('Efe')
    expect(buildIdentity({ ...base, handle: 'efe' }).display).toBe('efe')
    expect(buildIdentity({ ...base, email: 'efe@example.com' }).display).toBe('efe')
    expect(buildIdentity({ ...base, email: 'efe@example.com' }).source).toBe('email')
  })

  it('reports an anonymous identity without inventing one', () => {
    const identity = buildIdentity({ ...base, signedIn: false, email: 'x@y.co', handle: 'x' })
    expect(identity.signedIn).toBe(false)
    expect(identity.source).toBe('anon')
    expect(identity.display).toBe('')
    expect(identity.initials).toBe('?')
  })

  it('builds initials from the two leading words', () => {
    expect(initialsFrom('efe demir')).toBe('ED')
    expect(initialsFrom('efe_demir')).toBe('ED')
    expect(initialsFrom('efe')).toBe('E')
    expect(initialsFrom('   ')).toBe('?')
    expect(initialsFrom('efe@orn.')).toBe('EO')
  })

  it('keeps the subtitle about the account, not the name', () => {
    const identity = buildIdentity({ ...base, handle: 'efe', provider: 'discord', role: 'moderator' })
    expect(identitySubtitle(identity)).toBe('discord · moderator')
    expect(identitySubtitle(buildIdentity({ ...base, handle: 'efe' }))).toBe('email · user')
  })

  it('treats a malformed email as no email at all', () => {
    expect(emailLocalName('@example.com')).toBeNull()
    expect(emailLocalName('')).toBeNull()
    expect(emailLocalName(null)).toBeNull()
    expect(emailLocalName('a@b.c')).toBe('a')
  })

  it('prefers the uploaded avatar over the provider one', () => {
    expect(buildIdentity({ ...base, handle: 'efe', avatarUrl: 'https://cdn.discordapp.com/avatars/1/2.png' }).avatarUrl).toBe(
      'https://cdn.discordapp.com/avatars/1/2.png'
    )
    expect(
      buildIdentity({
        ...base,
        handle: 'efe',
        avatarUrl: 'https://cdn.discordapp.com/avatars/1/2.png',
        profileAvatarUrl: 'https://x.supabase.co/storage/v1/object/public/avatars/3.png'
      }).avatarUrl
    ).toBe('https://x.supabase.co/storage/v1/object/public/avatars/3.png')
    expect(buildIdentity(base).avatarUrl).toBeNull()
    expect(buildIdentity({ ...base, signedIn: false, avatarUrl: 'https://cdn.discordapp.com/a/b.png' }).avatarUrl).toBeNull()
  })
})
