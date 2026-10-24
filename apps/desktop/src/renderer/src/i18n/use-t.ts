import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { MessageKey } from './resources'

export type TranslateOptions = Record<string, string | number | undefined>

export type Translate = (key: MessageKey, options?: TranslateOptions) => string

export function useT(): Translate {
  const { t } = useTranslation()
  return useCallback((key: MessageKey, options?: TranslateOptions) => String(t(key, options)), [t])
}
