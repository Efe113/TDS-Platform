import type { ButtonHTMLAttributes, ReactNode } from 'react'

// One implementation for the whole app; the shadcn components under components/ui/* use the same one.
export { cn } from '../lib/utils'
import { cn } from '../lib/utils'

type ButtonVariant = 'primary' | 'ghost' | 'subtle' | 'danger'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  // `text-primary-foreground` rather than `text-base`: with --color-base defined, Tailwind's text-*
  // utility is ambiguous between the font-size scale and that color.
  primary: 'bg-brand text-primary-foreground font-medium hover:brightness-110',
  ghost: 'border border-line bg-panel-soft hover:border-brand/60',
  subtle: 'text-mute hover:text-ink',
  danger: 'border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20'
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  busy?: boolean
  size?: 'sm' | 'md'
}

export function Button({ variant = 'ghost', busy, size = 'md', className, children, disabled, ...rest }: ButtonProps): ReactNode {
  return (
    <button
      type="button"
      data-slot="button"
      data-variant={variant}
      data-press
      disabled={disabled || busy}
      className={cn(
        'no-drag inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'px-2.5 py-1.5 text-xs',
        VARIANT_CLASS[variant],
        className
      )}
      {...rest}
    >
      {busy ? <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {children}
    </button>
  )
}

export function Card({
  title,
  hint,
  children,
  className,
  lift
}: {
  title?: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
  /** Hover raise + brand edge: for cards that are actually destinations, not for static panels. */
  lift?: boolean
}): ReactNode {
  return (
    <section data-lift={lift ? '' : undefined} className={cn('hud-panel p-4', className)}>
      {title ? (
        <header className="mb-3 flex items-start justify-between gap-2">
          <h2 className="text-[13px] font-semibold tracking-wide text-ink">{title}</h2>
          <span aria-hidden className="mt-1 h-px w-6 shrink-0 bg-brand/60" />
        </header>
      ) : null}
      {hint ? <p className="mb-3 text-[11px] leading-relaxed text-mute">{hint}</p> : null}
      {children}
    </section>
  )
}

export function PageTitle({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }): ReactNode {
  return (
    <header className="mb-5">
      <h1 className="text-xl font-semibold">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-mute">{subtitle}</p> : null}
    </header>
  )
}

export function Badge({
  children,
  tone = 'neutral',
  className
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'warn' | 'danger' | 'good'
  className?: string
}): ReactNode {
  const tones: Record<'neutral' | 'accent' | 'warn' | 'danger' | 'good', string> = {
    neutral: 'border-line bg-panel-soft text-mute',
    accent: 'border-brand/40 bg-brand/15 text-brand',
    warn: 'border-warn/40 bg-warn/15 text-warn',
    danger: 'border-danger/40 bg-danger/15 text-danger',
    good: 'border-good/40 bg-good/15 text-good'
  }
  return <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs', tones[tone], className)}>{children}</span>
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium uppercase tracking-wide text-mute">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-mute">{hint}</span> : null}
    </label>
  )
}

export const INPUT_CLASS =
  'w-full rounded-lg border border-line bg-base px-3 py-2 text-sm outline-none placeholder:text-mute/60 focus:border-brand'

export function Row({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>
}

export function EmptyState({ title, body }: { title: ReactNode; body?: ReactNode }): ReactNode {
  return (
    <div className="rounded-lg border border-dashed border-line bg-panel-soft/60 px-4 py-6 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-mute">{body}</p> : null}
    </div>
  )
}

export function Banner({ tone, title, children }: { tone: 'danger' | 'warn' | 'info' | 'good'; title?: ReactNode; children?: ReactNode }): ReactNode {
  const tones: Record<'danger' | 'warn' | 'info' | 'good', string> = {
    danger: 'border-danger/40 bg-danger/10',
    warn: 'border-warn/40 bg-warn/10',
    info: 'border-brand/40 bg-brand/10',
    good: 'border-good/40 bg-good/10'
  }
  return (
    <div className={cn('rounded-lg border px-3 py-2 text-sm', tones[tone])}>
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className="mt-1 text-xs leading-relaxed text-ink/80">{children}</div> : null}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: ReactNode }): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="no-drag flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-panel-soft px-3 py-2 text-left text-sm hover:border-brand/60"
    >
      <span>{label}</span>
      <span className={cn('relative h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-brand' : 'bg-line')}>
        <span className={cn('absolute top-0.5 size-4 rounded-full bg-ink transition-all', checked ? 'left-4.5' : 'left-0.5')} />
      </span>
    </button>
  )
}

export function KeyValue({ label, children }: { label: ReactNode; children: ReactNode }): ReactNode {
  return (
    <div className="border-b border-line/60 py-1.5 last:border-b-0">
      <p className="text-[11px] uppercase tracking-wide text-mute">{label}</p>
      <div className="mt-0.5 text-sm text-ink">{children}</div>
    </div>
  )
}
