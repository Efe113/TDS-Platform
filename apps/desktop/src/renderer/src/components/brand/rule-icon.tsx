import type { ReactNode } from 'react'
import {
  Activity,
  Award,
  BadgeCheck,
  Bookmark,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Coins,
  Flag,
  Flame,
  Gauge,
  Gift,
  Handshake,
  Heart,
  History,
  Image as ImageIcon,
  Landmark,
  Languages,
  Link,
  Megaphone,
  MessageSquare,
  MonitorPlay,
  Palette,
  Rocket,
  Scale,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Timer,
  TrendingUp,
  Trophy,
  Upload,
  Users,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { RULE_ICON_NAMES, type CurrencyRuleKind } from '@tds/shared'

/**
 * `currency_rules.icon` is stored as a name, not a component, so the database can describe a rule
 * without shipping a bundle. The map is deliberately a fixed vocabulary: an admin picks from what
 * exists rather than typing an icon name that renders nothing.
 */
export const RULE_ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  award: Award,
  'badge-check': BadgeCheck,
  bookmark: Bookmark,
  building: Building2,
  'calendar-clock': CalendarClock,
  'clipboard-check': ClipboardCheck,
  coins: Coins,
  flag: Flag,
  flame: Flame,
  gauge: Gauge,
  gift: Gift,
  handshake: Handshake,
  heart: Heart,
  history: History,
  image: ImageIcon,
  landmark: Landmark,
  languages: Languages,
  link: Link,
  megaphone: Megaphone,
  'message-square': MessageSquare,
  'monitor-play': MonitorPlay,
  palette: Palette,
  rocket: Rocket,
  scale: Scale,
  'shield-check': ShieldCheck,
  sparkles: Sparkles,
  star: Star,
  target: Target,
  timer: Timer,
  'trending-up': TrendingUp,
  trophy: Trophy,
  upload: Upload,
  users: Users,
  zap: Zap
}

/**
 * The shared list is the contract; this throws at import time if a name reaches the database without a
 * component behind it. Cheaper than a silent gap in an admin picker, and it keeps both lists in one
 * place instead of a copy that can drift.
 */
const missing = RULE_ICON_NAMES.filter((name) => RULE_ICONS[name] === undefined)
if (missing.length > 0) {
  throw new Error(`rule icon registry is missing: ${missing.join(', ')}`)
}

/** Names sorted for the picker, so the grid reads as a list instead of a hash order. */
export const RULE_ICON_NAMES_SORTED: string[] = [...RULE_ICON_NAMES].sort()

const KIND_FALLBACK: Record<CurrencyRuleKind, LucideIcon> = {
  usage: MonitorPlay,
  publish: Upload,
  approval: ShieldCheck,
  badge: Award,
  event: Flag,
  streak: Flame,
  milestone: Target,
  community: Users,
  referral: Link,
  challenge: Rocket,
  support: Heart,
  grant: Gift
}

/** Unknown names fall back by kind rather than blanking the row, so old data still renders. */
export function ruleIconFor(name: string | null | undefined, kind: CurrencyRuleKind): LucideIcon {
  if (name) {
    const found = RULE_ICONS[name]
    if (found) return found
  }
  return KIND_FALLBACK[kind] ?? Coins
}

export function RuleIcon({
  name,
  kind,
  size = 15,
  className
}: {
  name: string | null | undefined
  kind: CurrencyRuleKind
  size?: number
  className?: string
}): ReactNode {
  const Icon = ruleIconFor(name, kind)
  return <Icon size={size} className={className} aria-hidden />
}
