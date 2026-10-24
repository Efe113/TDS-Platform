import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const env = Object.fromEntries(
  readFileSync(join(process.cwd(), '.env.local'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()])
)

const base = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY

const headers = { apikey: key, Authorization: `Bearer ${key}` }

const settings = await fetch(`${base}/auth/v1/settings`, { headers })
const json = await settings.json().catch(() => ({}))

console.log('settings http:', settings.status)
console.log('signup enabled:', json.disable_signup === false)
console.log('mailer autoconfirm:', json.mailer_autoconfirm === true ? 'ON (no email click needed)' : 'OFF (confirmation required)')
console.log('site_url:', json.site_url || '(unset)')
console.log('redirect allowlist size:', Array.isArray(json.URI_CONFIG?.allowed_urls) ? json.URI_CONFIG.allowed_urls.length : '(unknown)')

// /settings does not expose provider config on current GoTrue builds, so each provider is
// probed through /authorize: enabled providers 302 to their own consent URL.
const PROVIDER_HOSTS = {
  discord: 'discord.com',
  google: 'accounts.google.com',
  github: 'github.com',
  apple: 'appleid.apple.com'
}

for (const [provider, host] of Object.entries(PROVIDER_HOSTS)) {
  const response = await fetch(
    `${base}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent('tdsapp://auth-callback')}`,
    { headers, redirect: 'manual' }
  )
  const location = response.headers.get('location') ?? ''
  const enabled = response.status >= 300 && response.status < 400 && location.includes(host)
  const clientId = /client_id=([^&]+)/.exec(location)?.[1]
  console.log(`provider ${provider}:`, enabled ? `ENABLED${clientId ? ` (client id ${clientId})` : ''}` : `disabled (${response.status})`)
}

const callbackRedirect = /redirect_uri=([^&]+)/.exec(
  (await fetch(`${base}/auth/v1/authorize?provider=discord&redirect_to=${encodeURIComponent('tdsapp://auth-callback')}`, { headers, redirect: 'manual' }))
    .headers.get('location') ?? ''
)
console.log('provider callback:', callbackRedirect ? decodeURIComponent(callbackRedirect[1]) : '(unknown)')
console.log('note: tdsapp://auth-callback must also be listed under Auth → URL Configuration → Redirect URLs.')
process.exit(0)
