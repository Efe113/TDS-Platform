import type { CSSProperties, ReactNode } from 'react'
import { motion } from 'framer-motion'
import { TOKEN_VARS, themeSkin, type ThemeSkin } from '@tds/shared'
import { cn } from '../../lib/utils'
import { SkinLayers } from './theme-backdrop'

/**
 * A miniature of the app wearing the skin. The token custom properties are written on this element
 * only, so the preview shows its own palette even while a different theme is active - and the scene
 * inside it is the real one, clamped to this machine's budget. On a low tier a paid scene shows as
 * still, which is the honest answer to "should I buy this for this computer".
 */
export function skinStyle(skin: ThemeSkin): CSSProperties {
  const vars: Record<string, string> = {}
  for (const [token, cssVar] of Object.entries(TOKEN_VARS)) {
    vars[cssVar] = skin.tokens[token as keyof typeof skin.tokens]
  }
  vars['--skin-glow-a'] = skin.glow[0]
  vars['--skin-glow-b'] = skin.glow[1]
  return vars as CSSProperties
}

const CHART_BARS = [6, 9, 5, 12, 8, 10] as const

/** A one-pixel signature for the accent seams, so each skin's miniature moves like its full window. */
function signatureLine(skin: ThemeSkin): string {
  switch (skin.signature) {
    case 'rise':
      return `linear-gradient(90deg, transparent, ${skin.tokens.brand}, ${skin.tokens.warn}, transparent)`
    case 'pulse':
      return `repeating-linear-gradient(90deg, ${skin.tokens.brand} 0 4px, transparent 4px 8px)`
    case 'flow':
      return `linear-gradient(90deg, transparent, ${skin.tokens.brand}, ${skin.tokens.good}, transparent)`
    case 'bloom':
      return `linear-gradient(90deg, transparent, ${skin.tokens.brand}, transparent)`
    default:
      return 'transparent'
  }
}

function CardAccent({ skin }: { skin: ThemeSkin }): ReactNode {
  if (skin.signature === 'pulse') {
    return <span aria-hidden className="absolute inset-x-1 bottom-0 h-px" style={{ background: signatureLine(skin) }} />
  }
  if (skin.signature === 'rise') {
    return (
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-3"
        style={{ background: `linear-gradient(to top, ${skin.glow[0]}, transparent)`, opacity: 0.55 }}
      />
    )
  }
  if (skin.signature === 'flow') {
    return (
      <span
        aria-hidden
        className="absolute inset-x-0 top-1/3 h-2 -rotate-3 opacity-40"
        style={{ background: `linear-gradient(90deg, transparent, ${skin.tokens.brand}, transparent)`, filter: 'blur(3px)' }}
      />
    )
  }
  if (skin.signature === 'bloom') {
    return (
      <>
        <span aria-hidden className="absolute top-1.5 right-1.5 size-[2px] rounded-full" style={{ background: skin.tokens.ink, opacity: 0.7 }} />
        <span aria-hidden className="absolute top-3 right-4 size-[2px] rounded-full" style={{ background: skin.tokens.brand, opacity: 0.8 }} />
        <span aria-hidden className="absolute right-3 bottom-1.5 size-[2px] rounded-full" style={{ background: skin.tokens.ink, opacity: 0.45 }} />
      </>
    )
  }
  return null
}

function DetailedPreview({ skin }: { skin: ThemeSkin }): ReactNode {
  const brand = skin.tokens.brand
  const ink = skin.tokens.ink

  return (
    <>
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        {/* A renewed skin is judged by its stack, so the miniature paints the stack rather than a
            two-layer taste of it. */}
        <SkinLayers skin={skin} cap={skin.renewed ? 4 : 2} />
      </div>
      <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-base/65 via-base/5 to-base/25" />
      {skin.signature === 'pulse' ? <span aria-hidden className="theme-preview-scan" /> : null}

      <div className="relative flex h-full gap-1.5 p-1.5">
        <span className="flex w-7 flex-col gap-1 rounded-md border border-line/60 bg-panel/80 p-1">
          <span className="flex items-center gap-1">
            <span className="theme-preview-dot size-1.5 rounded-full" style={{ background: brand }} />
            <span className="h-0.5 w-2.5 rounded-full bg-ink/30" />
          </span>
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="flex h-2 items-center justify-center rounded-[2px] border"
              style={
                index === 0
                  ? { borderColor: `${brand}66`, background: `${brand}22` }
                  : { borderColor: 'transparent', background: `${ink}0d` }
              }
            >
              <span className="size-0.5 rounded-full" style={{ background: index === 0 ? brand : skin.tokens.mute }} />
            </span>
          ))}
          <span className="mt-auto h-1.5 rounded-[2px]" style={{ background: `${ink}0d` }} />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="relative flex items-center gap-1 overflow-hidden rounded-md border border-line/50 bg-panel/80 px-1.5 py-1">
            <span className="size-1.5 rounded-full" style={{ background: brand }} />
            <span className="h-1 w-8 rounded-sm bg-ink/25" />
            <span className="ml-auto h-2 w-6 rounded-sm border" style={{ borderColor: `${brand}55`, background: `${brand}1f` }} />
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-px" style={{ background: signatureLine(skin), opacity: 0.8 }} />
          </span>

          <span className="relative flex min-h-0 flex-1 items-stretch gap-1 overflow-hidden rounded-md border border-line/50 bg-card/75 p-1.5">
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="h-1 w-2/3 rounded-sm bg-ink/25" />
              <span className="h-1 w-1/2 rounded-sm bg-mute/35" />
              <span className="mt-auto flex items-end gap-0.5">
                {CHART_BARS.map((height, index) => (
                  <span
                    key={index}
                    className="w-1 rounded-t-[1px]"
                    style={{ height: `${String(height)}px`, background: index === 3 ? skin.tokens.warn : `${brand}99` }}
                  />
                ))}
              </span>
            </span>
            <span
              className="relative grid size-7 shrink-0 place-items-center self-center rounded-full border"
              style={{ borderColor: `${brand}55` }}
            >
              <span
                className="absolute inset-[3px] rounded-full border-2"
                style={{ borderColor: brand, borderRightColor: 'transparent', transform: 'rotate(-32deg)' }}
              />
              <span className="size-1 rounded-full" style={{ background: brand }} />
            </span>
            <CardAccent skin={skin} />
          </span>

          <span className="flex items-center gap-1 rounded-md border border-line/50 bg-panel/80 px-1.5 py-1">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-panel-soft">
              <motion.span
                className="block h-full rounded-full"
                style={{ background: brand }}
                initial={{ width: '24%' }}
                animate={{ width: ['24%', '78%', '24%'] }}
                transition={{ duration: skin.motion.cycleSeconds / 3, repeat: Infinity, ease: 'easeInOut' }}
              />
            </span>
            <span className="size-1 rounded-full" style={{ background: skin.tokens.warn }} />
          </span>
        </span>
      </div>
    </>
  )
}

function CompactPreview({ skin }: { skin: ThemeSkin }): ReactNode {
  const brand = skin.tokens.brand
  return (
    <>
      <span
        aria-hidden
        className="absolute inset-0"
        style={{ background: `linear-gradient(120deg, ${skin.tokens.panelSoft}, ${skin.tokens.base})` }}
      />
      <span
        aria-hidden
        className="absolute -top-3 -right-2 size-10 rounded-full"
        style={{ background: `radial-gradient(circle, ${skin.glow[0]}, transparent 68%)` }}
      />
      <span className="relative flex h-full items-center gap-1.5 px-2">
        <span
          className="grid size-4 shrink-0 place-items-center rounded-[4px] border"
          style={{ borderColor: `${brand}66`, background: `${brand}22` }}
        >
          <span className="size-1.5 rounded-full" style={{ background: brand }} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="h-1 w-2/3 rounded-full" style={{ background: skin.tokens.ink, opacity: 0.35 }} />
          <span className="h-1 w-1/3 rounded-full" style={{ background: brand, opacity: 0.65 }} />
        </span>
        <span
          className="grid size-4 shrink-0 place-items-center rounded-full border"
          style={{ borderColor: `${brand}77` }}
        >
          <span className="size-1.5 rounded-full" style={{ background: brand }} />
        </span>
      </span>
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-px" style={{ background: signatureLine(skin), opacity: 0.7 }} />
    </>
  )
}

export function ThemePreview({
  value,
  active,
  detailed,
  className
}: {
  value: string | null | undefined
  active?: boolean
  /** Full scene. Off for the compact rows in menus, where a gradient is enough. */
  detailed?: boolean
  className?: string
}): ReactNode {
  const skin = themeSkin(value)
  const full = detailed !== false

  return (
    <div
      className={cn(
        'relative overflow-hidden border bg-base',
        full ? 'h-24 rounded-xl' : 'h-9 rounded-lg',
        active ? 'border-brand ring-1 ring-brand/40' : 'border-line',
        skin.renewed && 'theme-preview--renewed',
        className
      )}
      style={skinStyle(skin)}
    >
      {full ? <DetailedPreview skin={skin} /> : <CompactPreview skin={skin} />}
    </div>
  )
}
