import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { RULE_ICONS, RULE_ICON_NAMES_SORTED } from './rule-icon'
import { cn } from '../../lib/utils'

/**
 * `currency_rules.icon` is a name, so the admin chooses from what the app can actually draw instead of
 * typing a string and hoping. An empty value is a real choice: the row then falls back by kind.
 */
export function IconPicker({
  value,
  onChange,
  disabled = false,
  label
}: {
  value: string | null | undefined
  onChange: (next: string | null) => void
  disabled?: boolean
  label?: string
}): ReactNode {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {label ? <span className="hud-label">{label}</span> : null}
        {value ? (
          <button
            type="button"
            data-press
            disabled={disabled}
            onClick={() => onChange(null)}
            className="no-drag inline-flex items-center gap-1 rounded-md border border-line bg-panel-soft px-1.5 py-0.5 text-[10px] text-mute hover:border-danger/50 hover:text-ink disabled:opacity-40"
          >
            <X size={10} />
            {`· ${value}`}
          </button>
        ) : (
          <span className="text-[10px] text-mute">—</span>
        )}
      </div>

      <div className="grid max-h-36 grid-cols-[repeat(auto-fill,minmax(2.1rem,1fr))] gap-1 overflow-y-auto rounded-lg border border-line/60 bg-base/40 p-1.5">
        {RULE_ICON_NAMES_SORTED.map((name) => {
          const Icon = RULE_ICONS[name]
          if (!Icon) return null
          const active = value === name
          return (
            <button
              key={name}
              type="button"
              data-press
              disabled={disabled}
              title={name}
              aria-pressed={active}
              onClick={() => onChange(active ? null : name)}
              className={cn(
                'no-drag grid place-items-center rounded-md border px-1 py-1 transition-colors',
                active
                  ? 'border-brand/60 bg-brand/15 text-ink'
                  : 'border-transparent text-mute hover:border-line hover:bg-panel-soft hover:text-ink',
                disabled && 'cursor-not-allowed opacity-40'
              )}
            >
              <Icon size={15} aria-hidden />
            </button>
          )
        })}
      </div>
    </div>
  )
}
