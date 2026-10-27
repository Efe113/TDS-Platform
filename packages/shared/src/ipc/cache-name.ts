/**
 * The file name the offline shelf writes a tracked document under (0.3.8).
 *
 * The key is a database uuid or `local:<document name>`, and a document name is typed by a person — it
 * can contain slashes, dots or nothing but emoji. So the name is built here, in one pure function with no
 * `node:` imports, and the caller has to be able to trust it: the main process joins it straight onto its
 * data directory.
 */

/** FNV-1a, 32 bit. Not for secrets: it only has to keep two long names from landing on one file. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

const SAFE_NAME = /^[a-z0-9-]+\.json$/

export function strategyCacheFileName(key: string): string {
  const slug = key
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const digest = fnv1a(key).toString(16).padStart(8, '0')
  const candidate = `${slug.length > 0 ? slug : 'strategy'}-${digest}.json`
  // Belt and braces: if a slug ever slips through the filter, the digest alone still names the file.
  return SAFE_NAME.test(candidate) ? candidate : `strategy-${digest}.json`
}
