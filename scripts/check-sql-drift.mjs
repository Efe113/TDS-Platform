#!/usr/bin/env node
// Static drift check for the migration line: does a re-declared RPC still return every field the
// previous version returned?
//
// This exists because 0040 rewrote `profile_showcase` to add the corporate fields and quietly dropped
// `frameKey`; 0043 re-declared the same function from 0040's text and carried the loss forward. The
// client schema defaults that field to null, so nothing threw — the equipped frame simply stopped
// appearing anywhere, and it was reported as "equipping is broken". A reader that loses one key is
// invisible until a human notices a missing pixel, so this checks it instead.
//
// Run: npm run check:sql:drift   (also part of npm run verify)

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')

const FN_START = /create (?:or replace )?function (?:public|app)\.([a-z_]+)/g

/** The argument list of a call, matched by paren depth — quotes and comments may contain parentheses. */
function balancedArgs(text, openIndex) {
  let depth = 0
  let quote = null
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (quote !== null) {
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === '-' && next === '-') {
      const newline = text.indexOf('\n', index)
      index = newline < 0 ? text.length : newline
      continue
    }
    if (char === '/' && next === '*') {
      const close = text.indexOf('*/', index)
      index = close < 0 ? text.length : close + 1
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return text.slice(openIndex + 1, index)
    }
  }
  return null
}

/**
 * Split on commas at depth zero, outside quotes — and outside `--` / block comments, because a comment
 * inside the object literal carries commas of its own and would shift every key/value pair after it.
 */
function topLevelParts(args) {
  const parts = []
  let depth = 0
  let quote = null
  let current = ''
  for (let index = 0; index < args.length; index += 1) {
    const char = args[index]
    const next = args[index + 1]

    if (quote !== null) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }
    if (char === '-' && next === '-') {
      const newline = args.indexOf('\n', index)
      index = newline < 0 ? args.length : newline
      current += ' '
      continue
    }
    if (char === '/' && next === '*') {
      const close = args.indexOf('*/', index)
      index = close < 0 ? args.length : close + 1
      current += ' '
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

/**
 * The literal keys of the outermost `return jsonb_build_object(...)` of a body. Only odd positions can
 * be keys, and only a literal counts: an expression-built key is not something we can compare.
 */
function outputKeys(body) {
  const marker = body.lastIndexOf('return jsonb_build_object')
  if (marker < 0) return null
  const open = body.indexOf('(', marker + 'return jsonb_build_object'.length - 1)
  if (open < 0) return null
  const args = balancedArgs(body, open)
  if (args === null) return null
  const parts = topLevelParts(args)
  const keys = new Set()
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const match = /^\s*'([^']+)'/.exec(parts[index] ?? '')
    if (match && typeof match[1] === 'string') keys.add(match[1])
  }
  return keys
}

const files = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort()

/** fn name -> list of { file, keys } in declaration order. */
const declarations = new Map()

for (const name of files) {
  const text = readFileSync(join(migrationsDir, name), 'utf8')
  const starts = []
  for (const match of text.matchAll(FN_START)) {
    if (typeof match[1] === 'string') starts.push({ fn: match[1], index: match.index })
  }
  starts.forEach((entry, position) => {
    const end = position + 1 < starts.length ? (starts[position + 1]?.index ?? text.length) : text.length
    const body = text.slice(entry.index, end)
    const keys = outputKeys(body)
    if (keys === null || keys.size === 0) return
    const list = declarations.get(entry.fn) ?? []
    list.push({ file: name, keys })
    declarations.set(entry.fn, list)
  })
}

const problems = []
for (const [fn, versions] of declarations) {
  if (versions.length < 2) continue
  // Only the newest declaration of a function can be wrong: a field dropped by an old version that a
  // later one restored is not a bug.
  const last = versions[versions.length - 1]
  const historical = new Set()
  for (const version of versions.slice(0, -1)) for (const key of version.keys) historical.add(key)
  const lost = [...historical].filter((key) => !last.keys.has(key))
  if (lost.length > 0) problems.push({ fn, from: versions[0]?.file ?? '?', to: last.file, lost })
}

console.log(`checked ${declarations.size} jsonb-returning rpc declarations across ${files.length} migrations`)

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`DRIFT ${problem.fn}: ${problem.lost.join(', ')} returned as of ${problem.from} but not by ${problem.to}`)
  }
  console.error('A re-declared reader lost output fields. Re-add them, or delete the field from the client contract too.')
  process.exit(1)
}

console.log('no reader lost an output field between re-declarations')
