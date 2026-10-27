import type { CSSProperties, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from './dropdown-menu'

/**
 * The app's menu language, layered on the Radix primitive: the animation itself is CSS (see
 * global.css, keyed on data-state and the per-row --i index), so a row cascade and a closing
 * animation both work without framer-motion's mounting tricks.
 *
 * `index` is a prop rather than read from context because a menu mixes groups and separators; the
 * caller knows the visible order, and passing it keeps the cascade honest.
 */

const rowIndex = (index: number): CSSProperties => ({ ['--i' as string]: String(index) } as CSSProperties)

export function Menu({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }): ReactNode {
  return <DropdownMenu onOpenChange={onOpenChange}>{children}</DropdownMenu>
}

export const MenuTrigger = DropdownMenuTrigger

export function MenuContent({
  children,
  align = 'start',
  side = 'top',
  className
}: {
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}): ReactNode {
  return (
    <DropdownMenuContent
      align={align}
      side={side}
      sideOffset={8}
      className={cn('hud-panel w-72 bg-popover p-1.5', className)}
    >
      {children}
    </DropdownMenuContent>
  )
}

export function MenuHeader({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return (
    <DropdownMenuLabel className={cn('space-y-0.5 px-2 py-2 font-normal', className)}>{children}</DropdownMenuLabel>
  )
}

export function MenuSection({ label, className }: { label: string; className?: string }): ReactNode {
  return (
    <DropdownMenuLabel
      className={cn('px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-mute/70', className)}
    >
      {label}
    </DropdownMenuLabel>
  )
}

export const MenuDivider = DropdownMenuSeparator

interface MenuItemProps {
  children: ReactNode
  icon?: LucideIcon
  index?: number
  tone?: 'default' | 'destructive'
  disabled?: boolean
  onSelect?: () => void
  /** Right-aligned hint, e.g. a keyboard shortcut or a price. */
  aside?: ReactNode
}

export function MenuItem({ children, icon: Icon, index = 0, tone = 'default', disabled, onSelect, aside }: MenuItemProps): ReactNode {
  return (
    <DropdownMenuItem
      data-menu-row
      style={rowIndex(index)}
      disabled={disabled}
      onSelect={onSelect ? () => onSelect() : undefined}
      variant={tone === 'destructive' ? 'destructive' : 'default'}
      className={cn('gap-2.5 rounded-md px-2 py-1.5 text-[13px]', tone === 'destructive' && 'text-destructive focus:text-destructive')}
    >
      {Icon ? (
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md transition-colors',
            tone === 'destructive' ? 'bg-destructive/15 text-destructive' : 'bg-brand/12 text-brand'
          )}
        >
          <Icon size={14} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {aside ? <span className="shrink-0 text-[11px] text-mute">{aside}</span> : null}
    </DropdownMenuItem>
  )
}

interface MenuRadioRowProps {
  value: string
  children: ReactNode
  index?: number
  disabled?: boolean
  /** Anything rendered before the label - a preview swatch, an avatar. */
  leading?: ReactNode
  aside?: ReactNode
}

export function MenuRadioRow({ value, children, index = 0, disabled, leading, aside }: MenuRadioRowProps): ReactNode {
  return (
    <DropdownMenuRadioItem data-menu-row style={rowIndex(index)} value={value} disabled={disabled} className="gap-2.5 rounded-md py-1.5">
      {leading}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {aside ? <span className="shrink-0 text-[10px] text-mute">{aside}</span> : null}
    </DropdownMenuRadioItem>
  )
}

export const MenuRadioList = DropdownMenuRadioGroup

/**
 * A fact rather than an action: it joins the row cascade but is deliberately not selectable, so the
 * hover affordance never promises something that cannot happen.
 */
const STAT_TONE_CLASS: Record<'default' | 'idle' | 'good' | 'warn' | 'danger', string> = {
  default: 'text-ink',
  idle: 'text-mute',
  good: 'text-good',
  warn: 'text-warn',
  danger: 'text-danger'
}

export function MenuStat({
  icon: Icon,
  label,
  value,
  index = 0,
  tone = 'default'
}: {
  icon?: LucideIcon
  label: ReactNode
  value: ReactNode
  index?: number
  tone?: 'default' | 'idle' | 'good' | 'warn' | 'danger'
}): ReactNode {
  return (
    <div data-menu-row style={rowIndex(index)} className="flex items-center gap-2.5 px-2 py-1.5 text-xs">
      {Icon ? (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-panel-soft text-mute">
          <Icon size={14} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-mute">{label}</span>
      <span className={cn('shrink-0 font-medium', STAT_TONE_CLASS[tone])}>{value}</span>
    </div>
  )
}

export function MenuSubmenu({
  trigger,
  icon,
  index = 0,
  children
}: {
  trigger: string
  icon?: LucideIcon
  index?: number
  children: ReactNode
}): ReactNode {
  const Icon = icon
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-menu-row style={rowIndex(index)} className="gap-2.5 rounded-md px-2 py-1.5 text-[13px]">
        {Icon ? (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand/12 text-brand">
            <Icon size={14} />
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{trigger}</span>
      </DropdownMenuSubTrigger>
      {/*
        The generated SubContent is not portalled, so without this the submenu stays a DOM child of the
        parent panel - and the panel's own clip-path clips the submenu, however it is positioned.
      */}
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="hud-panel w-72 bg-popover p-1.5">
          {children}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}

export function MenuFooter({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return <div className={cn('mt-1.5 border-t border-line/70 px-2 pb-1 pt-1.5', className)}>{children}</div>
}
