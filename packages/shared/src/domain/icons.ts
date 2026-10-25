/**
 * `currency_rules.icon` and `badge_definitions.icon_path` both store one of these names when the mark is
 * drawn rather than uploaded (0038, 0040). The renderer owns the name to component map, and the pickers
 * offer exactly this list, so a value written by the admin can always be drawn.
 *
 * Names are kebab-case, matching how the icon library exports them, so a database row stays readable in
 * the SQL console without a component import in front of it.
 */
export const RULE_ICON_NAMES = [
  'activity',
  'award',
  'badge-check',
  'bookmark',
  'building',
  'calendar-clock',
  'clipboard-check',
  'coins',
  'flag',
  'flame',
  'gauge',
  'gift',
  'handshake',
  'heart',
  'history',
  'image',
  'languages',
  'landmark',
  'link',
  'megaphone',
  'message-square',
  'monitor-play',
  'palette',
  'rocket',
  'scale',
  'shield-check',
  'sparkles',
  'star',
  'target',
  'timer',
  'trending-up',
  'trophy',
  'upload',
  'users',
  'zap'
] as const

export type RuleIconName = (typeof RULE_ICON_NAMES)[number]

export function isRuleIconName(value: string | null | undefined): value is RuleIconName {
  return typeof value === 'string' && (RULE_ICON_NAMES as readonly string[]).includes(value)
}

/** Rules earn a mark by default; an unknown stored name falls here instead of rendering nothing. */
export const RULE_ICON_FALLBACK = 'coins' satisfies RuleIconName
