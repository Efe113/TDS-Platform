import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Button, Row, cn } from '../../components/ui'
import { StateError } from '../../components/ui/states'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { isNotConfigured } from '../../lib/discovery-api'
import { SkeletonRow } from '../../motion/primitives/Shimmer'
import { formatJson } from './admin-api'

export function rawMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }): ReactNode {
  const t = useT()
  return (
    <StateError
      detail={isNotConfigured(error) ? t('admin.notConfigured') : rawMessage(error)}
      onRetry={onRetry}
    />
  )
}

export function LoadingBanner({ rows = 3 }: { rows?: number }): ReactNode {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_unused, index) => (
        <SkeletonRow key={index} />
      ))}
    </div>
  )
}

export interface TabItem<K extends string> {
  id: K
  labelKey: MessageKey
}

interface TabBarProps<K extends string> {
  items: readonly TabItem<K>[]
  active: K
  onSelect: (id: K) => void
  className?: string
}

export function TabBar<K extends string>({ items, active, onSelect, className }: TabBarProps<K>): ReactNode {
  const t = useT()
  // Scoped per instance: two tab bars on one screen must not fight over the same sliding indicator.
  const groupId = useId()
  return (
    <Row className={cn('gap-1', className)}>
      {items.map((item) => {
        const selected = item.id === active
        return (
          <button
            key={item.id}
            type="button"
            data-press
            onClick={() => onSelect(item.id)}
            className={cn(
              'no-drag relative rounded-lg px-3 py-1.5 text-sm transition-colors',
              selected ? 'font-medium text-ink' : 'text-mute hover:text-ink'
            )}
          >
            {selected ? (
              <motion.span
                layoutId={`tab-bar-${groupId}`}
                transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                className="absolute inset-0 rounded-lg border border-brand/60 bg-brand/15"
              />
            ) : null}
            <span className="relative">{t(item.labelKey)}</span>
          </button>
        )
      })}
    </Row>
  )
}

/** `undefined` marks a malformed value so the caller can reject the save instead of storing 0. */
export function parseIntField(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  if (!/^-?\d+$/.test(trimmed)) return undefined
  return Number.parseInt(trimmed, 10)
}

export function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

interface JsonDetailsProps {
  label: string
  value: unknown
}

export function JsonDetails({ label, value }: JsonDetailsProps): ReactNode {
  const t = useT()
  const [open, setOpen] = useState(false)
  const isEmpty = value === null || value === undefined
  return (
    <div className="space-y-1">
      <Row>
        <Button variant="subtle" disabled={isEmpty} onClick={() => setOpen((current) => !current)}>
          {isEmpty ? label : `${label} · ${t(open ? 'common.hide' : 'common.show')}`}
        </Button>
      </Row>
      {open && !isEmpty ? (
        <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-base px-3 py-2 text-[11px] leading-relaxed text-mute">
          {formatJson(value)}
        </pre>
      ) : null}
    </div>
  )
}
