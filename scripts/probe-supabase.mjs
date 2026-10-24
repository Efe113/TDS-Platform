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
if (!base || !key) {
  console.error('.env.local missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const headers = { apikey: key, Authorization: `Bearer ${key}` }

// Supabase restricts the OpenAPI root to service_role for anon keys, so each relation is
// probed directly instead of listing the schema.
const tables = [
  'profiles',
  'user_settings',
  'app_consents',
  'legal_documents',
  'app_flags',
  'maps',
  'towers',
  'mutators',
  'events',
  'classes',
  'tags',
  'strategies',
  'strategy_versions',
  'strategy_steps',
  'strategy_inventory',
  'strategy_modifiers',
  'strategy_placements',
  'strategy_media',
  'strategy_requirements',
  'strategy_wave_skip_rules',
  'strategy_troubleshooting',
  'strategy_proofs',
  'strategy_hof',
  'strategy_tags',
  'strategy_drafts',
  'import_jobs',
  'import_unmatched',
  'admin_audit_log',
  'overlay_sessions',
  'usage_events',
  'strategy_usage_daily',
  'leaderboard_config',
  'leaderboard_snapshots',
  'currency_ledger',
  'currency_rules',
  'spend_catalog',
  'spend_orders',
  'profile_themes',
  'user_themes',
  'strategy_boosts',
  'badge_metrics',
  'badge_definitions',
  'user_badges',
  'public_badges',
  'stat_user_rollup'
]

const rpcs = [
  'submit_strategy',
  'publish_strategy',
  'admin_review_strategy',
  'admin_set_role',
  'accept_consent',
  'has_consented',
  'start_overlay_session',
  'flush_usage',
  'award_currency',
  'spend_currency',
  'get_leaderboard',
  'verify_balance',
  'toggle_favorite',
  'search_strategies'
]

// Rows these tables should already contain, so "exists but empty" can be told apart
// from "seed never ran".
const expectedRows = { leaderboard_config: 3 }

let missing = []
let blocked = []
let seeded = []

for (const table of tables) {
  const response = await fetch(`${base}/rest/v1/${table}?select=*&limit=1`, {
    headers: { ...headers, Prefer: 'count=exact' }
  })
  const range = response.headers.get('content-range') ?? ''
  const total = range.includes('/') ? Number.parseInt(range.split('/')[1], 10) : Number.NaN

  if (response.status === 200 || response.status === 206) {
    if (Number.isFinite(total)) seeded.push(`${table}(${total})`)
    if (expectedRows[table] !== undefined && total < expectedRows[table]) {
      blocked.push(`SEED MISSING: ${table} has ${total}, expected >= ${expectedRows[table]}`)
    }
    continue
  }

  const body = await response.text()
  if (/PGRST205|Could not find the relation|not exposed/i.test(body)) missing.push(table)
  else blocked.push(`${table} -> ${response.status} ${body.slice(0, 140)}`)
}

console.log(`tables ok: ${seeded.length}/${tables.length}`)
console.log('counts:', seeded.join(' '))
if (missing.length) console.log('MISSING tables:', missing.join(', '))
if (blocked.length) console.log('ISSUES:', blocked.join('\n  '))

// PostgREST matches functions by arity: calling with `{}` searches a zero-argument variant and
// reports PGRST202 even when the real function exists. Each RPC is probed with its own argument
// shape. Every one of these raises before it can write anything when called as `anon`.
const ZERO = '00000000-0000-0000-0000-000000000000'
const rpcArgs = {
  submit_strategy: { p_ir: { meta: { name: 'probe' }, steps: [], inventory: [] } },
  publish_strategy: { p_strategy_id: ZERO },
  admin_review_strategy: { p_strategy_id: ZERO, p_decision: 'approve' },
  admin_set_role: { p_user: ZERO, p_role: 'user' },
  accept_consent: { p_kind: 'tos', p_policy_version: 'probe' },
  has_consented: { p_kind: 'tos', p_policy_version: 'probe' },
  start_overlay_session: { p_strategy_id: ZERO, p_display_id: 'probe', p_app_version: '0', p_hook_backend: 'probe' },
  flush_usage: { p_session_id: ZERO, p_nonce: ZERO, p_events: [] },
  award_currency: {
    p_user: ZERO,
    p_rule_code: 'usage_session',
    p_amount: 1,
    p_ref_type: 'probe',
    p_ref_id: 'probe',
    p_idempotency_key: 'probe-1'
  },
  spend_currency: { p_sku: 'theme_ember', p_idempotency_key: 'probe-2' },
  get_leaderboard: {},
  verify_balance: { p_user: ZERO },
  toggle_favorite: { p_strategy_id: ZERO },
  search_strategies: { p_sort: 'new', p_limit: 5 }
}

for (const rpc of rpcs) {
  const response = await fetch(`${base}/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(rpcArgs[rpc] ?? {})
  })
  const body = await response.text()
  let state
  if (response.status === 200) state = `EXECUTED ${body.slice(0, 60)}`
  else if (/PGRST202/.test(body)) state = `TRULY MISSING: ${body.slice(0, 100)}`
  else if (/FORBIDDEN|ANONYMOUS|INSUFFICIENT|NOT_PUBLISHED|BAD_|null value|permission denied|violates/i.test(body))
    state = `EXISTS (guard fired): ${body.slice(0, 90)}`
  else state = `EXISTS? (${response.status}) ${body.slice(0, 110)}`
  console.log(`rpc ${rpc}: ${state}`)
}

process.exit(missing.length > 0 ? 1 : 0)
