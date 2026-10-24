import { profileShowcaseSchema, type ProfileShowcase } from '@tds/shared'
import { supabase } from './supabase'
import { whenSessionReady } from './session'
import { NotConfiguredError } from './discovery-api'

/** Public fields only; the server refuses to recompute the rollup for anonymous browsing. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function fetchShowcase(userId: string): Promise<ProfileShowcase> {
  // A slug or an empty string in the route would otherwise reach PostgREST as an invalid uuid and come
  // back as a bare 400, which looks like a server fault.
  if (!UUID.test(userId)) throw new Error('NOT_FOUND: invalid profile id')
  await whenSessionReady()
  if (!supabase) throw new NotConfiguredError()
  const client = supabase

  const read = async (): Promise<ProfileShowcase> => {
    const { data, error } = await client.rpc('profile_showcase', { p_user: userId })
    if (error) throw new Error(error.message)
    return profileShowcaseSchema.parse(data ?? {})
  }

  try {
    return await read()
  } catch (error) {
    // A wiped profile (data reset) leaves the JWT valid but the row gone; repair once, then read again.
    if (!/NOT_FOUND/i.test(error instanceof Error ? error.message : String(error))) throw error
    const repair = await client.rpc('ensure_profile')
    if (repair.error) throw new Error(repair.error.message)
    return read()
  }
}

export async function setPublicBadges(codes: string[]): Promise<number> {
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase.rpc('set_public_badges', { p_codes: codes })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

/** Editable identity fields. Empty strings clear a field; the server trims and validates. */
export async function updateProfile(input: {
  displayName: string
  handle: string
  bio: string
}): Promise<ProfileShowcase> {
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase.rpc('update_profile', {
    p_display_name: input.displayName,
    p_handle: input.handle,
    p_bio: input.bio
  })
  if (error) throw new Error(error.message)
  return profileShowcaseSchema.parse(data ?? {})
}

/** `path` is a storage path inside the user's own prefix; null clears the image. */
export async function setProfileMedia(kind: 'avatar' | 'banner' | 'background', path: string | null): Promise<ProfileShowcase> {
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase.rpc('set_profile_media', { p_kind: kind, p_path: path })
  if (error) throw new Error(error.message)
  return profileShowcaseSchema.parse(data ?? {})
}

/** Equips an owned title or frame. Passing null removes it; ownership is checked server-side. */
export async function equipCosmetic(kind: 'title' | 'frame', ref: string | null): Promise<{ kind: string; ref: string | null }> {
  if (!supabase) throw new NotConfiguredError()
  const { data, error } = await supabase.rpc('equip_cosmetic', { p_kind: kind, p_ref: ref })
  if (error) throw new Error(error.message)
  return (data ?? { kind, ref }) as { kind: string; ref: string | null }
}
