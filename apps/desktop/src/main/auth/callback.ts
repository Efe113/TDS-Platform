export const AUTH_RETURN_TO = 'tdsapp://auth-callback'

export interface ParsedCallback {
  code?: string
  accessToken?: string
  refreshToken?: string
  error?: string
  errorDescription?: string
}

/** Handles both the PKCE (`?code=`) and implicit (`#access_token=`) callback shapes. */
export function parseAuthCallback(rawUrl: string): ParsedCallback | null {
  if (!rawUrl.startsWith('tdsapp://')) return null

  const outcome: ParsedCallback = {}
  const withoutScheme = rawUrl.replace(/^tdsapp:\/\/[^?#]*/i, '')

  const query = withoutScheme.includes('?') ? withoutScheme.slice(withoutScheme.indexOf('?') + 1) : ''
  const fragment = withoutScheme.includes('#') ? withoutScheme.slice(withoutScheme.indexOf('#') + 1) : ''

  for (const source of [query, fragment]) {
    if (!source) continue
    const params = new URLSearchParams(source)
    const code = params.get('code')
    const error = params.get('error') ?? params.get('error_description')
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')

    if (code) outcome.code = code
    if (accessToken) outcome.accessToken = accessToken
    if (refreshToken) outcome.refreshToken = refreshToken
    if (error) {
      outcome.error = params.get('error') ?? 'provider_error'
      outcome.errorDescription = params.get('error_description') ?? error
    }
  }

  if (!outcome.code && !outcome.accessToken && !outcome.error) return null
  return outcome
}

export function looksLikeAuthCallback(argument: string): boolean {
  return argument.startsWith('tdsapp://auth-callback')
}
