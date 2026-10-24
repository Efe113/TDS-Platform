import type { OverlayGeometry } from '@tds/shared'
import type { Display } from 'electron'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface CardCss {
  left: string
  right: string
  top: string
  bottom: string
  transform?: string
}

/** The overlay window spans the whole work area; only the card is painted, positioned by CSS. */
export function resolveWindowBounds(display: Display): WindowBounds {
  const area = display.workArea
  return { x: area.x, y: area.y, width: area.width, height: area.height }
}

export function resolveCardCss(geometry: OverlayGeometry): CardCss {
  const marginX = `${geometry.marginX}px`
  const marginY = `${geometry.marginY}px`
  const anchoredLeft = geometry.anchor.endsWith('left')
  const anchoredRight = geometry.anchor.endsWith('right')
  const anchoredBottom = geometry.anchor.startsWith('bottom')

  return {
    left: anchoredLeft ? marginX : anchoredRight ? 'auto' : '50%',
    right: anchoredRight ? marginX : 'auto',
    top: anchoredBottom ? 'auto' : marginY,
    bottom: anchoredBottom ? marginY : 'auto',
    transform: geometry.anchor.includes('center') ? 'translateX(-50%)' : undefined
  }
}

export function clampBounds(bounds: WindowBounds, display: Display): WindowBounds {
  const area = display.workArea
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  return {
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
    width,
    height
  }
}
