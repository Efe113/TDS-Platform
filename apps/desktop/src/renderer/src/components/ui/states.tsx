import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { CloudOff, Inbox, RotateCw, TriangleAlert } from 'lucide-react'
import { useT } from '../../i18n/use-t'
import { cn } from '../../lib/utils'
import { Button } from '../ui'
import { Reveal } from '../../motion/primitives/Reveal'
import { SkeletonCard, SkeletonRow } from '../../motion/primitives/Shimmer'

/**
 * The three non-content states, in one place. Before this every page invented its own "Yükleniyor…"
 * banner, an empty card or a raw Postgres message, which is why the app read as unfinished wherever a
 * request was slow or failed. Each surface says what happened and what the user can do about it.
 */

function Shell({
  icon: Icon,
  tone,
  title,
  children,
  action
}: {
  icon: LucideIcon
  tone: 'danger' | 'warn' | 'mute'
  title: string
  children?: ReactNode
  action?: ReactNode
}): ReactNode {
  return (
    <Reveal>
      <div
        className={cn(
          'flex items-start gap-3 rounded-2xl border px-4 py-4',
          tone === 'danger' && 'border-danger/35 bg-danger/[0.06]',
          tone === 'warn' && 'border-warn/35 bg-warn/[0.06]',
          tone === 'mute' && 'border-dashed border-line bg-panel-soft/40'
        )}
      >
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            tone === 'danger' && 'bg-danger/15 text-danger',
            tone === 'warn' && 'bg-warn/15 text-warn',
            tone === 'mute' && 'bg-brand/12 text-brand'
          )}
        >
          <Icon size={17} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-ink">{title}</p>
          {children ? <div className="space-y-1 text-xs leading-relaxed text-mute">{children}</div> : null}
          {action ? <div className="pt-1.5">{action}</div> : null}
        </div>
      </div>
    </Reveal>
  )
}

export function StateEmpty({
  icon = Inbox,
  title,
  body,
  action
}: {
  icon?: LucideIcon
  title: string
  body?: string
  action?: ReactNode
}): ReactNode {
  return (
    <Shell icon={icon} tone="mute" title={title} action={action}>
      {body}
    </Shell>
  )
}

/**
 * `detail` is what actually came back from the server; it stays visible but secondary, so a support
 * screenshot has the real message without the user having to read a stack trace first.
 */
export function StateError({
  detail,
  hint,
  onRetry,
  busy
}: {
  detail?: string | null
  hint?: string
  onRetry?: () => void
  busy?: boolean
}): ReactNode {
  const t = useT()
  return (
    <Shell
      icon={CloudOff}
      tone="danger"
      title={t('state.errorTitle')}
      action={
        onRetry ? (
          <Button className="px-2.5 py-1.5 text-xs" busy={busy} onClick={onRetry}>
            <RotateCw size={14} />
            {t('common.retry')}
          </Button>
        ) : null
      }
    >
      <p>{hint ?? t('state.errorHint')}</p>
      {detail ? <p className="break-words font-mono text-[11px] text-mute/80">{detail}</p> : null}
    </Shell>
  )
}

/** A validation/permission notice: same shape as the error, without the alarm colour. */
export function StateNotice({ title, children }: { title: string; children?: ReactNode }): ReactNode {
  return (
    <Shell icon={TriangleAlert} tone="warn" title={title}>
      {children}
    </Shell>
  )
}

export function StateLoading({ variant = 'rows', count = 3 }: { variant?: 'rows' | 'cards'; count?: number }): ReactNode {
  const items = Array.from({ length: count }, (_unused, index) => index)
  if (variant === 'cards') {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((index) => (
          <SkeletonCard key={index} lines={4} />
        ))}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {items.map((index) => (
        <SkeletonRow key={index} />
      ))}
    </div>
  )
}
