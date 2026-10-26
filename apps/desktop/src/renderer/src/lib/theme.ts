import { TOKEN_VARS, themeSkin, type ThemeSkin } from '@tds/shared'

/**
 * Tailwind v4 emits its theme tokens as real custom properties, so writing them on <html> re-tints
 * every utility that uses them - including the /15 and /40 variants, which are color-mix over the
 * same variable. data-theme is set as well so the stylesheet can carry per-skin details (scrollbar,
 * selection, card sheen) that are not colors.
 */
export function applyTheme(value: string | null | undefined): ThemeSkin {
  const skin = themeSkin(value)
  const root = document.documentElement

  for (const [token, cssVar] of Object.entries(TOKEN_VARS) as Array<[keyof typeof TOKEN_VARS, string]>) {
    root.style.setProperty(cssVar, skin.tokens[token as keyof typeof skin.tokens])
  }

  root.style.setProperty('--skin-glow-a', skin.glow[0])
  root.style.setProperty('--skin-glow-b', skin.glow[1])
  root.style.setProperty('--skin-cycle', `${String(skin.motion.cycleSeconds)}s`)
  root.dataset.theme = skin.key
  // Two more hooks so the stylesheet can treat card edges and motion signatures per skin without a
  // component having to know which skin is active.
  root.dataset.edge = skin.cardEdge
  root.dataset.signature = skin.signature
  // Renewed skins get the heavy chrome (molten card seams, rail trails, name burn). The flag is on
  // the root so the stylesheet keys off capability, not off a list of theme names it would drift from.
  root.dataset.renewed = skin.renewed ? 'on' : 'off'

  return skin
}
