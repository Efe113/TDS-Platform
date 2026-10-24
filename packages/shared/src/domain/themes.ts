import type { MotionTier, ParticleScene } from './motion'

/**
 * Theme skins.
 *
 * The database stores only which skin a user owns and which one they picked (`profiles.theme_key`,
 * validated by select_theme). Everything that makes a skin - tokens, the canvas scene, the ambient
 * layers and the motion signature - lives here, because a jsonb color blob cannot express keyframes
 * and a stored string inside a custom property would let database content restyle the app.
 *
 * A skin is judged by what it *does*, not its hue: `ember` moves heat upward, `toxic` scans and
 * pulses, `aurora` flows in ribbons, `void` has depth parallax. That is also why the prices differ.
 */

export const THEME_KEYS = ['default', 'ember', 'toxic', 'aurora', 'void'] as const
export type ThemeKey = (typeof THEME_KEYS)[number]

export type SkinSignature = 'drift' | 'rise' | 'pulse' | 'flow' | 'bloom'
export type AmbientLayer = 'mesh' | 'ribbons' | 'grain' | 'vignette' | 'scanline' | 'hazard' | 'grid' | 'flames' | 'bubbles' | 'smoke'
export type CardEdge = 'none' | 'heat' | 'acid' | 'conic' | 'star'

export interface ThemeTokens {
  base: string
  panel: string
  panelSoft: string
  line: string
  ink: string
  mute: string
  brand: string
  brandSoft: string
  danger: string
  warn: string
  good: string
}

export interface ThemeSkin {
  key: ThemeKey
  moodKey: 'theme.moodCalm' | 'theme.moodWarm' | 'theme.moodAcid' | 'theme.moodAurora' | 'theme.moodVoid'
  signature: SkinSignature
  ambient: 'aurora' | 'ember' | 'acid'
  glow: [string, string]
  layers: AmbientLayer[]
  cardEdge: CardEdge
  /** Pointer parallax in pixels, before the tier clamps it. */
  parallax: number
  scene: ParticleScene | null
  /** What the tier still allows on a weak machine, so the skin keeps its identity without particles. */
  minimumTierForScene: MotionTier
  tokens: ThemeTokens
  motion: {
    cycleSeconds: number
    spring: { stiffness: number; damping: number }
    travel: number
  }
}

export const THEME_SKINS: Record<ThemeKey, ThemeSkin> = {
  // Kurumsal Gece, rebuilt as a blueprint: a much deeper ink base, a colder steel panel, a grid you
  // can actually see, and a slow cyan cast in the glow. Still the free skin, so it stays calm - no
  // particle scene - but it no longer reads as "the default that nobody designed".
  default: {
    key: 'default',
    moodKey: 'theme.moodCalm',
    signature: 'drift',
    ambient: 'aurora',
    glow: ['rgba(76, 141, 255, 0.30)', 'rgba(56, 189, 248, 0.12)'],
    layers: ['grid', 'mesh', 'vignette'],
    cardEdge: 'none',
    parallax: 10,
    scene: null,
    minimumTierForScene: 'medium',
    tokens: {
      base: '#060a12',
      panel: '#0d1522',
      panelSoft: '#141f31',
      line: '#223049',
      ink: '#e9f0fb',
      mute: '#8fa2bf',
      brand: '#4c8dff',
      brandSoft: '#16294a',
      danger: '#ff6b6b',
      warn: '#ffb347',
      good: '#3ecf8e'
    },
    motion: { cycleSeconds: 26, spring: { stiffness: 320, damping: 34 }, travel: 7 }
  },
  ember: {
    key: 'ember',
    moodKey: 'theme.moodWarm',
    signature: 'rise',
    ambient: 'ember',
    glow: ['rgba(255, 106, 43, 0.3)', 'rgba(255, 179, 71, 0.18)'],
    layers: ['flames', 'smoke', 'vignette', 'mesh'],
    cardEdge: 'heat',
    parallax: 12,
    // The flame veil is the layer, not the particles: on the low tier the window still burns.
    scene: { kind: 'ember', density: 130, palette: ['#ff5a1f', '#ffd88a'], speed: 1.35, size: 2.4, gravity: 0.7, twinkle: true },
    minimumTierForScene: 'medium',
    tokens: {
      base: '#100a07',
      panel: '#1a110b',
      panelSoft: '#241711',
      line: '#3b2418',
      ink: '#f7ece4',
      mute: '#c2a291',
      brand: '#ff7a45',
      brandSoft: '#3a1c0e',
      danger: '#ff5c5c',
      warn: '#ffc061',
      good: '#7fd08c'
    },
    motion: { cycleSeconds: 12, spring: { stiffness: 260, damping: 24 }, travel: 10 }
  },
  toxic: {
    key: 'toxic',
    moodKey: 'theme.moodAcid',
    signature: 'pulse',
    ambient: 'acid',
    glow: ['rgba(126, 217, 87, 0.28)', 'rgba(45, 212, 191, 0.18)'],
    // Hazard is the signature; bubbles are the next thing a medium machine can afford.
    layers: ['hazard', 'bubbles', 'scanline', 'vignette'],
    cardEdge: 'acid',
    parallax: 12,
    scene: { kind: 'spore', density: 110, palette: ['#a3e635', '#2dd4bf'], speed: 0.55, size: 3, gravity: -0.08, twinkle: true },
    minimumTierForScene: 'medium',
    tokens: {
      base: '#07120b',
      panel: '#0c1c12',
      panelSoft: '#122819',
      line: '#1e3d28',
      ink: '#e8fbe9',
      mute: '#93b89b',
      brand: '#7ed957',
      brandSoft: '#173d21',
      danger: '#ff7a7a',
      warn: '#f5d76e',
      good: '#4ade80'
    },
    motion: { cycleSeconds: 8, spring: { stiffness: 380, damping: 26 }, travel: 11 }
  },
  aurora: {
    key: 'aurora',
    moodKey: 'theme.moodAurora',
    signature: 'flow',
    ambient: 'aurora',
    glow: ['rgba(56, 189, 248, 0.24)', 'rgba(129, 140, 248, 0.22)'],
    layers: ['ribbons', 'mesh', 'vignette'],
    cardEdge: 'conic',
    parallax: 14,
    scene: { kind: 'ribbon', density: 6, palette: ['#38bdf8', '#818cf8'], speed: 0.45, size: 1.6, gravity: 0, twinkle: false },
    minimumTierForScene: 'medium',
    tokens: {
      base: '#060a18',
      panel: '#0c1327',
      panelSoft: '#131c34',
      line: '#22304f',
      ink: '#e9f1ff',
      mute: '#93a6c9',
      brand: '#38bdf8',
      brandSoft: '#0f2b44',
      danger: '#fb7185',
      warn: '#fcd34d',
      good: '#34d399'
    },
    motion: { cycleSeconds: 20, spring: { stiffness: 240, damping: 22 }, travel: 10 }
  },
  void: {
    key: 'void',
    moodKey: 'theme.moodVoid',
    signature: 'bloom',
    ambient: 'aurora',
    glow: ['rgba(148, 163, 255, 0.16)', 'rgba(88, 28, 135, 0.22)'],
    layers: ['grain', 'vignette', 'mesh'],
    cardEdge: 'star',
    parallax: 18,
    scene: { kind: 'star', density: 140, palette: ['#e2e8ff', '#a78bfa'], speed: 0.25, size: 1.5, gravity: 0, twinkle: true },
    minimumTierForScene: 'medium',
    tokens: {
      base: '#04050a',
      panel: '#0a0b14',
      panelSoft: '#11131f',
      line: '#232536',
      ink: '#eef0ff',
      mute: '#8d90ab',
      brand: '#a78bfa',
      brandSoft: '#2a1c4a',
      danger: '#f87171',
      warn: '#fbbf24',
      good: '#5eead4'
    },
    motion: { cycleSeconds: 26, spring: { stiffness: 300, damping: 28 }, travel: 8 }
  }
}

export const DEFAULT_THEME_KEY: ThemeKey = 'default'

/** Anything the database holds that is not a known skin falls back instead of half-applying. */
export function resolveThemeKey(value: string | null | undefined): ThemeKey {
  return (THEME_KEYS as readonly string[]).includes(value ?? '') ? (value as ThemeKey) : DEFAULT_THEME_KEY
}

export function themeSkin(value: string | null | undefined): ThemeSkin {
  return THEME_SKINS[resolveThemeKey(value)]
}

/** The CSS custom property names the tokens map onto, shared by the applier and the previews. */
export const TOKEN_VARS: Record<keyof ThemeTokens, string> = {
  base: '--color-base',
  panel: '--color-panel',
  panelSoft: '--color-panel-soft',
  line: '--color-line',
  ink: '--color-ink',
  mute: '--color-mute',
  brand: '--color-brand',
  brandSoft: '--color-brand-soft',
  danger: '--color-danger',
  warn: '--color-warn',
  good: '--color-good'
}
