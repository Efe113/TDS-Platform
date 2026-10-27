import { useCallback, useState } from 'react'

/**
 * "Don't show this again", stored on the device (0.3.6).
 *
 * A campaign or a notice is operator content the member cannot unsubscribe from server-side, and
 * re-opening the same modal on every launch is the fastest way to make people close the app instead of
 * the dialog. So the dismissal is local, and it is keyed by the row's own expiry stamp: an operator who
 * extends a campaign or edits a notice gets a fresh `id + stamp` pair, the entry no longer matches, and
 * the item is shown again — which is the behaviour everyone expects and no one has to think about.
 *
 * The map is trimmed to the newest entries, because this key outlives accounts on a shared install.
 */

const STORAGE_KEY = 'tds.dismissals.v1'
const MAX_ENTRIES = 40

type Dismissals = Record<string, string>

function read(): Dismissals {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: Dismissals = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

function write(next: Dismissals): void {
  try {
    const entries = Object.entries(next)
    const kept = entries.length > MAX_ENTRIES ? Object.fromEntries(entries.slice(entries.length - MAX_ENTRIES)) : next
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(kept))
  } catch {
    // Private mode, a full profile, a locked-down install: the band still shows, which is the safe side.
  }
}

export function isDismissed(id: string, stamp: string): boolean {
  return read()[id] === stamp
}

export function markDismissed(id: string, stamp: string): void {
  write({ ...read(), [id]: stamp })
}

/**
 * `stamp` should change whenever the content changes meaningfully — a campaign's `endsAt`, a notice's
 * `updatedAt`. Dismissing something that was then edited is not the same as dismissing it again.
 */
export function useDismissal(id: string | null, stamp: string | null): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(() => id !== null && stamp !== null && isDismissed(id, stamp))

  const dismiss = useCallback(() => {
    if (id === null || stamp === null) return
    markDismissed(id, stamp)
    setDismissed(true)
  }, [id, stamp])

  return [dismissed, dismiss]
}
