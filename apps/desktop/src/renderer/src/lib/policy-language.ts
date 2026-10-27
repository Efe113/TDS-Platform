import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { POLICY_LANGUAGES, pickLanguage, type PolicyLanguage } from '@tds/shared'

/**
 * Legal documents are read in the interface language, but a member who has the UI in Turkish and reads
 * contracts better in English must be able to flip just these pages. `null` means "follow the
 * interface"; a chosen language is remembered on this machine, because a policy you already read should
 * not switch back under you on the next launch.
 */
const KEY = 'tds.…cale'

function readStored(): PolicyLanguage | null {
  try {
    const value = window.localStorage.getItem(KEY)
    return POLICY_LANGUAGES.includes(value as PolicyLanguage) ? (value as PolicyLanguage) : null
  } catch {
    return null
  }
}

export interface PolicyLanguageChoice {
  /** The language actually rendered. */
  language: PolicyLanguage
  /** Whether the member picked it, or it is following the interface. */
  explicit: boolean
  choose: (next: PolicyLanguage | null) => void
}

export function usePolicyLanguage(): PolicyLanguageChoice {
  const { i18n } = useTranslation()
  const [stored, setStored] = useState<PolicyLanguage | null>(readStored)

  const choose = useCallback((next: PolicyLanguage | null) => {
    setStored(next)
    try {
      if (next === null) window.localStorage.removeItem(KEY)
      else window.localStorage.setItem(KEY, next)
    } catch {
      // Storage can be unavailable; the choice then simply does not survive the session.
    }
  }, [])

  return {
    language: stored ?? pickLanguage(i18n.language),
    explicit: stored !== null,
    choose
  }
}
