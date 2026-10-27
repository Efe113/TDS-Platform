export * from './ir/strategy-ir'
export * from './domain/discovery'
export * from './domain/publish'
export * from './domain/leaderboard'
export * from './domain/wallet'
export * from './domain/account'
export * from './domain/profile'
export * from './domain/social'
export * from './domain/intelligence'
export * from './domain/themes'
export * from './domain/identity'
export * from './domain/cosmetics'
export * from './domain/icons'
export * from './domain/maintenance'
export * from './domain/campaign'
export * from './domain/announcement'
export * from './domain/motion'
export * from './usage/outbox'
export * from './ipc/contract'
export * from './ipc/cache-name'
export * from './import/markdown'
export * from './import/document'
export * from './import/step-grammar'
export * from './import/tower-dict'
export * from './import/report'
export * from './import/gdocs'
export * from './import/build-ir'
export * from './import/unmatched'
export { tr, type TranslationKey } from './i18n/tr'
export { en } from './i18n/en'
export * from './supabase/client'
export {
  POLICY_VERSION,
  POLICY_EFFECTIVE_DATE,
  SUPPORT_EMAIL,
  POLICY_LANGUAGES,
  POLICY_KINDS,
  ABOUT_DOCUMENT,
  PRIVACY_DOCUMENT,
  TERMS_DOCUMENT,
  ABOUT_FAQ,
  LEGAL_DOCUMENTS,
  POLICY_DOCUMENTS,
  DEFAULT_POLICY_DOCUMENT,
  pickLanguage,
  text,
  policyDocument,
  policyToMarkdown,
  type PolicyKind,
  type PolicyLanguage,
  type PolicyDocument,
  type PolicySection,
  type LocalizedText,
  type FaqEntry
} from './legal/policies'
