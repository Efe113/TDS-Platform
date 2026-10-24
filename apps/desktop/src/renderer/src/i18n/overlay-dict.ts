// Leaf imports keep the overlay bundle free of the shared barrel (and therefore of zod).
import { tr } from '../../../../../../packages/shared/src/i18n/tr'
import { extraTr } from './extra-tr'

const DICT: Record<string, string> = { ...tr, ...extraTr }

/** i18next is too heavy for the tiny overlay renderer; interpolation matches its {{var}} syntax. */
export function translate(key: string, vars?: Record<string, string | number>): string {
  const template = DICT[key] ?? key
  if (!vars) return template
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}
