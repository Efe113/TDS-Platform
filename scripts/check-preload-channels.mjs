import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const contract = readFileSync(join(root, 'packages/shared/src/ipc/contract.ts'), 'utf8')
const preloadMain = readFileSync(join(root, 'apps/desktop/src/preload/main.ts'), 'utf8')
const preloadOverlay = readFileSync(join(root, 'apps/desktop/src/preload/overlay.ts'), 'utf8')

const block = (source, name, openChar = '{', closeChar = '}') => {
  const start = source.indexOf(name)
  if (start === -1) throw new Error(`could not find ${name}`)
  const open = source.indexOf(openChar, start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === openChar) depth += 1
    if (source[index] === closeChar) {
      depth -= 1
      if (depth === 0) return source.slice(open, index)
    }
  }
  throw new Error(`unbalanced braces after ${name}`)
}

// `readonly string[] = [` means the first `[` after the name belongs to the TYPE annotation,
// so the array body is located from the assignment instead.
const arrayBlock = (source, name) => {
  const start = source.indexOf(name)
  if (start === -1) throw new Error(`could not find ${name}`)
  const open = source.indexOf('= [', start)
  if (open === -1) throw new Error(`${name} is not an array literal`)
  const close = source.indexOf(']', open)
  return source.slice(open + 2, close)
}

const channels = new Set([...block(contract, 'export const IPC_CHANNELS').matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]))

const eventKeys = [...arrayBlock(contract, 'IPC_EVENT_CHANNELS').matchAll(/IPC_CHANNELS\.(\w+)/g)].map((m) => m[1])

const contractEventChannels = new Set(
  eventKeys.map((key) => {
    const table = block(contract, 'export const IPC_CHANNELS')
    const found = new RegExp(`${key}:\\s*'([^']+)'`).exec(table)
    if (!found) throw new Error(`IPC_CHANNELS has no key ${key}`)
    return found[1]
  })
)

const contractInvocable = new Set([...channels].filter((channel) => !contractEventChannels.has(channel)))

const setOf = (source, label) => {
  const start = source.indexOf(label)
  if (start === -1) throw new Error(`preload is missing ${label}`)
  const open = source.indexOf('[', start)
  const close = source.indexOf(']', open)
  return new Set([...source.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]))
}

const preloadInvocable = setOf(preloadMain, 'const INVOCABLE')
const preloadSubscribable = setOf(preloadMain, 'const SUBSCRIBABLE')
const overlayChannels = new Set(
  [...block(preloadOverlay, 'const CHANNEL').matchAll(/:\s*'([^']+)'/g)].map((m) => m[1])
)

const problems = []
const warnings = []

const registerSource = readFileSync(join(root, 'apps/desktop/src/main/ipc/register.ts'), 'utf8')
const handledKeys = new Set(
  [...registerSource.matchAll(/IPC_CHANNELS\.(\w+)/g)].map((m) => m[1])
)
const keyOfChannel = (channel) => {
  const table = block(contract, 'export const IPC_CHANNELS')
  return [...table.matchAll(/(\w+):\s*'([^']+)'/g)].find((m) => m[2] === channel)?.[1]
}

for (const channel of contractInvocable) {
  const key = keyOfChannel(channel)
  if (key && !handledKeys.has(key)) problems.push(`invocable channel has no ipcMain handler: ${channel}`)
}

// Anything under src/main may emit an event (the updater service does, the tray does), so the emit
// check reads the whole tree rather than a hand-picked list of files.
const mainSource = (() => {
  const walk = (directory) =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? walk(path) : path.endsWith('.ts') ? [readFileSync(path, 'utf8')] : []
    })
  return walk(join(root, 'apps/desktop/src/main')).join('\n')
})()
for (const channel of contractEventChannels) {
  const key = keyOfChannel(channel)
  if (key && !handledKeys.has(key) && !mainSource.includes(`IPC_CHANNELS.${key}`)) {
    warnings.push(`event channel is declared but never emitted yet: ${channel}`)
  }
}

for (const channel of [...preloadInvocable, ...preloadSubscribable, ...overlayChannels]) {
  if (!channels.has(channel)) problems.push(`preload uses an unknown channel: ${channel}`)
}
for (const channel of contractInvocable) {
  if (!preloadInvocable.has(channel)) problems.push(`invocable channel not exposed by preload: ${channel}`)
}
for (const channel of preloadInvocable) {
  if (!contractInvocable.has(channel)) problems.push(`preload exposes a non-invocable channel: ${channel}`)
}
for (const channel of contractEventChannels) {
  if (!preloadSubscribable.has(channel) && !overlayChannels.has(channel)) {
    problems.push(`event channel not subscribed by any preload: ${channel}`)
  }
}

console.log(`contract channels: ${channels.size} | invocable: ${contractInvocable.size} | events: ${contractEventChannels.size}`)
console.log(`preload invocable: ${preloadInvocable.size} | subscribable: ${preloadSubscribable.size} | overlay: ${overlayChannels.size}`)

if (warnings.length) {
  console.log('\nNOTES:')
  for (const warning of warnings) console.log(`  ~ ${warning}`)
}

if (problems.length) {
  console.log('\nDRIFT:')
  for (const problem of problems) console.log(`  - ${problem}`)
  process.exit(1)
}
console.log('\npreload channel lists match the shared contract')
