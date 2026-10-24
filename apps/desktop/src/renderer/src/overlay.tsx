import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { TOKEN_VARS, themeSkin, type OverlayState } from '@tds/shared'
import type { OverlayCssPayload } from './types/bridge'
import { OverlayCard } from './features/overlay/OverlayCard'
import { initRendererTelemetry } from './lib/telemetry'
import './styles/global.css'

// The overlay is a separate window with its own error surface: a throw here would otherwise die
// silently, and this window is the one the user is looking at while playing.
initRendererTelemetry()

const IDLE_AFTER_MS = 6000

const FALLBACK_STYLE: CSSProperties = { position: 'fixed', top: 16, right: 16, width: 340, opacity: 0.92 }

function OverlayRoot(): ReactNode {
  const [state, setState] = useState<OverlayState | null>(null)
  const [css, setCss] = useState<OverlayCssPayload | null>(null)
  const [dimmed, setDimmed] = useState(false)
  const [interactive, setInteractive] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    document.documentElement.classList.add('overlay-root')
    const bridge = window.overlay
    if (!bridge) return
    const offState = bridge.onStateChanged((payload) => setState(payload))
    const offCss = bridge.onCss((payload) => setCss(payload))
    return () => {
      offState()
      offCss()
    }
  }, [])

  // Any state change wakes the card up, then it fades back down after an idle stretch.
  useEffect(() => {
    setDimmed(false)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setDimmed(true), IDLE_AFTER_MS)
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [state])

  const handleHover = useCallback((hovered: boolean) => {
    setInteractive(hovered)
    // The window is click-through, so the card has to ask for the mouse when it is hovered.
    window.overlay?.setInteractive(hovered)
  }, [])

  // Free prefs and paid cosmetics arrive together; the skin tokens are applied here so the overlay can
  // follow the purchased theme without ever reading the profile itself.
  useEffect(() => {
    if (!css) return
    const root = document.documentElement
    root.style.setProperty('--ov-font-scale', String(css.fontScale))
    if (css.themeBound && css.themeKey) {
      const skin = themeSkin(css.themeKey)
      for (const [token, cssVar] of Object.entries(TOKEN_VARS)) {
        root.style.setProperty(cssVar, skin.tokens[token as keyof typeof skin.tokens])
      }
      root.dataset.overlayTheme = skin.key
    } else {
      root.dataset.overlayTheme = 'plain'
    }
  }, [css])

  const style: CSSProperties = css
    ? {
        position: 'fixed',
        left: css.css.left,
        right: css.css.right,
        top: css.css.top,
        bottom: css.css.bottom,
        transform: css.css.transform,
        width: css.width,
        opacity: css.opacity
      }
    : FALLBACK_STYLE

  return (
    <div style={style}>
      <OverlayCard
        state={state}
        dimmed={dimmed}
        interactive={interactive}
        prefs={
          css
            ? { cardStyle: css.cardStyle, showCounter: css.showCounter, upcomingCount: css.upcomingCount }
            : { cardStyle: 'classic', showCounter: false, upcomingCount: 2 }
        }
        onHover={handleHover}
        onStep={(action) => window.overlay?.step(action)}
        onHide={() => window.overlay?.hide()}
      />
    </div>
  )
}

const container = document.getElementById('overlay-root')
if (container) createRoot(container).render(<OverlayRoot />)
