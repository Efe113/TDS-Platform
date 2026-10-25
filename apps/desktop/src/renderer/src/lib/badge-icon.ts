import { SUPABASE_BASE_URL } from './storage-base'

/**
 * `badge_definitions.icon_path` stores either an absolute https URL or a `strategy-media` object path
 * (0038). Resolve both without the usual "env must exist" gate, because a pasted URL has to preview
 * even in a build with no Supabase configured — that is exactly when an admin is testing one.
 */
export function badgeIconSrc(path: string | null | undefined): string | null {
  if (!path) return null
  const value = path.trim()
  if (value.length === 0) return null
  if (/^https:\/\//i.test(value)) return value
  if (/^storage\/v1\/object\/public\//i.test(value) && /^https:\/\//i.test(SUPABASE_BASE_URL)) {
    return `${SUPABASE_BASE_URL.replace(/\/$/, '')}/${value.replace(/^\//, '')}`
  }
  if (/^http:\/\//i.test(value)) return null // the page CSP only allows https images
  if (SUPABASE_BASE_URL.length === 0) return null
  return `${SUPABASE_BASE_URL.replace(/\/$/, '')}/storage/v1/object/public/strategy-media/${value.replace(/^\//, '')}`
}
