import { useTranslation } from 'react-i18next'
import type { Difficulty, PlayerCount, RequirementEntry, WaveSkipRule } from '@tds/shared'
import type { MessageKey } from '../i18n/resources'

export type BadgeTone = 'neutral' | 'accent' | 'warn' | 'danger' | 'good'

export type CatalogLanguage = 'tr' | 'en'

export interface LocalizedName {
  name_tr: string
  name_en: string
}

const DIFFICULTY_KEYS: Record<Difficulty, MessageKey> = {
  easy: 'difficulty.easy',
  medium: 'difficulty.medium',
  hard: 'difficulty.hard',
  nightmare: 'difficulty.nightmare'
}

const DIFFICULTY_TONES: Record<Difficulty, BadgeTone> = {
  easy: 'good',
  medium: 'neutral',
  hard: 'warn',
  nightmare: 'danger'
}

const PLAYER_COUNT_KEYS: Record<PlayerCount, MessageKey> = {
  solo: 'playerCount.solo',
  duo: 'playerCount.duo',
  trio: 'playerCount.trio',
  quad: 'playerCount.quad',
  unknown: 'playerCount.unknown'
}

const REQUIREMENT_KEYS: Record<RequirementEntry['kind'], MessageKey> = {
  'skill-tree': 'requirement.skill-tree',
  timescale: 'requirement.timescale',
  group: 'requirement.group',
  consumable: 'requirement.consumable',
  'tower-xp': 'requirement.tower-xp'
}

const WAVE_SKIP_KEYS: Record<WaveSkipRule['kind'], MessageKey> = {
  'skip-until': 'waveSkip.skip-until',
  conditional: 'waveSkip.conditional',
  never: 'waveSkip.never'
}

/**
 * Enum-shaped columns are guarded instead of cast: an unexpected value falls back to the raw string
 * on screen rather than to a wrong translation.
 */
function safeKey<T extends string>(table: Record<T, MessageKey>, value: string): MessageKey | null {
  return Object.prototype.hasOwnProperty.call(table, value) ? table[value as T] : null
}

export function difficultyEntry(value: string): { labelKey: MessageKey | null; tone: BadgeTone } {
  const labelKey = safeKey(DIFFICULTY_KEYS, value)
  const known = Object.prototype.hasOwnProperty.call(DIFFICULTY_TONES, value)
  return { labelKey, tone: known ? DIFFICULTY_TONES[value as Difficulty] : 'neutral' }
}

export function playerCountKey(value: string): MessageKey | null {
  return safeKey(PLAYER_COUNT_KEYS, value)
}

export function requirementKey(value: string): MessageKey | null {
  return safeKey(REQUIREMENT_KEYS, value)
}

export function waveSkipKey(value: string): MessageKey | null {
  return safeKey(WAVE_SKIP_KEYS, value)
}

/** Catalog rows ship both languages; the interface language decides which one the UI shows. */
export function useCatalogLanguage(): CatalogLanguage {
  const { i18n } = useTranslation()
  const raw = i18n.resolvedLanguage ?? i18n.language ?? 'tr'
  return raw.toLowerCase().startsWith('en') ? 'en' : 'tr'
}

export function catalogName(entity: LocalizedName | null | undefined, language: CatalogLanguage): string | null {
  if (!entity) return null
  const value = language === 'en' ? entity.name_en : entity.name_tr
  return value.trim().length > 0 ? value : null
}

/**
 * Server-owned text that exists in both languages (0040: titles, badge names). Falls back to the other
 * column when a row was written with only one, so an English interface never shows an empty mark.
 */
export function pickLocalized(
  turkish: string | null | undefined,
  english: string | null | undefined,
  language: CatalogLanguage
): string | null {
  const preferred = language === 'en' ? english : turkish
  const fallback = language === 'en' ? turkish : english
  const value = (preferred ?? '').trim().length > 0 ? preferred : fallback
  return value && value.trim().length > 0 ? value : null
}
