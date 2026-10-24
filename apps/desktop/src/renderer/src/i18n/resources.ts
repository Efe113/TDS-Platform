import { en, tr, type TranslationKey } from '@tds/shared'
import { extraEn } from './extra-en'
import { extraTr, type ExtraKey } from './extra-tr'

export type MessageKey = TranslationKey | ExtraKey

const trMessages: Record<MessageKey, string> = { ...tr, ...extraTr }
const enMessages: Record<MessageKey, string> = { ...en, ...extraEn }

export const RESOURCES: Record<'tr' | 'en', { translation: Record<MessageKey, string> }> = {
  tr: { translation: trMessages },
  en: { translation: enMessages }
}

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: Record<MessageKey, string> }
  }
}
