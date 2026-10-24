import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useT } from '../../i18n/use-t'
import { useId } from 'react'
import { cn } from '../../lib/utils'
import { Reveal } from '../../motion/primitives/Reveal'

/**
 * The shared visual vocabulary. Screens are not allowed to invent their own header, filter bar,
 * counter card or chip: those four shapes are the reason two pages feel like one product, and every
 * one of them is tier-aware through the motion engine rather than through a local animation.
 */

/* ---------------------------------------------------------------- Segmented control */

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
  count?: number
}

/**
 * One sliding indicator per instance: the layout id is scoped with `useId`, so two segmented controls
 * on the same screen never fight over the same pill.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  label,
  className
}: {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (next: T) => void
  size?: 'sm' | 'md'
  label?: string
  className?: string
}): ReactNode {
  const groupId = useId()
  const compact = size === 'sm'

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? <span className="text-[10px] font-semibold uppercase tracking-widest text-mute/70">{label}</span> : null}
      <div role="tablist" className={cn('inline-flex gap-0.5 self-start rounded-xl border border-line bg-panel-soft p-0.5')}>
        {options.map((option) => {
          const active = option.value === value
          const Icon = option.icon
          return (
            <button
              key={option.value}
              role="tab"
              type="button"
              data-press
              aria-selected={active}
              onClick={() => onChange(option.value)}
              className={cn(
                'no-drag relative rounded-lg transition-colors',
                compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
                active ? 'font-semibold text-ink' : 'text-mute hover:text-ink'
              )}
            >
              {active ? (
                <motion.span
                  layoutId={`segment-${groupId}`}
                  transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                  className="absolute inset-0 rounded-lg bg-brand/20 ring-1 ring-inset ring-brand/30"
                />
              ) : null}
              <span className="relative flex items-center gap-1.5">
                {Icon ? <Icon size={compact ? 12 : 13} /> : null}
                {option.label}
                {option.count !== undefined ? <span className="tabular-nums text-mute/80">{String(option.count)}</span> : null}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Chip */

const CHIP_TONE: Record<'neutral' | 'brand' | 'good' | 'warn' | 'danger', string> = {
  neutral: 'border-line bg-panel-soft text-mute',
  brand: 'border-brand/40 bg-brand/12 text-brand',
  good: 'border-good/40 bg-good/12 text-good',
  warn: 'border-warn/40 bg-warn/12 text-warn',
  danger: 'border-danger/40 bg-danger/12 text-danger'
}

export function Chip({
  children,
  tone = 'neutral',
  icon: Icon,
  className
}: {
  children: ReactNode
  tone?: keyof typeof CHIP_TONE
  icon?: LucideIcon
  className?: string
}): ReactNode {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-medium', CHIP_TONE[tone], className)}>
      {Icon ? <Icon size={11} /> : null}
      {children}
    </span>
  )
}

export function ChipRow({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return <div className={cn('flex flex-wrap items-center gap-1.5', className)}>{children}</div>
}

/** A chip the user can take back off. Used by every active-filter strip. */
export function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }): ReactNode {
  const t = useT()
  return (
    <button
      type="button"
      data-press
      onClick={onRemove}
      className="no-drag inline-flex items-center gap-1 rounded-lg border border-brand/40 bg-brand/12 py-0.5 pl-2 pr-1 text-[11px] font-medium text-ink transition-colors hover:border-danger/50 hover:bg-danger/12"
    >
      {label}
      <span className="grid size-4 place-items-center rounded-md text-mute" aria-label={t('common.close')}>
        <X size={10} />
      </span>
    </button>
  )
}

/* ---------------------------------------------------------------- Metric */

export function Metric({
  icon: Icon,
  label,
  value,
  hint,
  delta,
  index = 0
}: {
  icon?: LucideIcon
  label: string
  value: ReactNode
  hint?: ReactNode
  /** Percentage change; the colour and the arrow come from the sign, not from the caller. */
  delta?: number | null
  index?: number
}): ReactNode {
  const up = (delta ?? 0) >= 0
  return (
    <div
      data-lift
      style={{ ['--i' as string]: String(index) }}
      className="hud-panel px-3.5 py-3"
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-mute/70">
        {Icon ? <Icon size={12} className="text-brand" /> : null}
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-1.5 flex items-baseline gap-2 text-xl leading-none font-semibold tabular-nums text-ink">
        {value}
        {delta !== undefined && delta !== null ? (
          <span className={cn('text-xs font-medium', up ? 'text-good' : 'text-danger')}>{`${up ? '+' : ''}${String(delta)}%`}</span>
        ) : null}
      </p>
      {hint ? <p className="mt-1 truncate text-[11px] text-mute">{hint}</p> : null}
    </div>
  )
}

export function MetricGrid({ children, columns = 4 }: { children: ReactNode; columns?: 2 | 3 | 4 }): ReactNode {
  return (
    <div
      className={cn(
        'grid gap-2.5',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
        columns === 4 && 'sm:grid-cols-2 lg:grid-cols-4'
      )}
    >
      {children}
    </div>
  )
}

/* ---------------------------------------------------------------- Page header */

/**
 * Every screen opens with the same block: what this is, what state it is in, and what the user can do
 * about it right here. Actions live next to the title rather than at the bottom of a card.
 */
export function PageHeader({
  title,
  subtitle,
  badges,
  actions,
  back
}: {
  title: ReactNode
  subtitle?: ReactNode
  badges?: ReactNode
  actions?: ReactNode
  back?: ReactNode
}): ReactNode {
  return (
    <Reveal className="space-y-3">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle ? <p className="mt-1 text-[13px] text-mute">{subtitle}</p> : null}
          {badges ? <ChipRow className="mt-2.5">{badges}</ChipRow> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </Reveal>
  )
}

/* ---------------------------------------------------------------- Section */

export function Section({
  title,
  hint,
  aside,
  children,
  className
}: {
  title: ReactNode
  hint?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <section
      className={cn('hud-panel p-4', className)}
    >
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-wide text-ink">{title}</h2>
          {hint ? <p className="mt-0.5 text-[11px] leading-relaxed text-mute">{hint}</p> : null}
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

/* ---------------------------------------------------------------- Animated counter row */

/** Cross-fades between two states of the same slot, so numbers arriving late do not snap. */
export function Swap({ show, children, placeholder }: { show: boolean; children: ReactNode; placeholder?: ReactNode }): ReactNode {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={show ? 'value' : 'empty'}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.16 }}
        className="inline-flex"
      >
        {show ? children : (placeholder ?? null)}
      </motion.span>
    </AnimatePresence>
  )
}
