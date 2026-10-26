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
 *
 * `renewed` marks a skin that has been rebuilt to the flagship standard (0.3.2 starts with `ember`,
 * which is renamed Ocak/Forge at the same time). A renewed skin declares a much longer layer stack and
 * a second particle field, and the shelf says so with the `renewed` tag — which is a marketing chip,
 * never an entitlement, so the till must keep ignoring it.
 */

export const THEME_KEYS = ['default', 'ember', 'toxic', 'aurora', 'void'] as const
export type ThemeKey = (typeof THEME_KEYS)[number]

export type SkinSignature = 'drift' | 'rise' | 'pulse' | 'flow' | 'bloom'
export type AmbientLayer =
  | 'mesh'
  | 'ribbons'
  | 'grain'
  | 'vignette'
  | 'scanline'
  | 'hazard'
  | 'grid'
  | 'flames'
  | 'bubbles'
  | 'smoke'
  /** The molten bath at the floor of a forge, with the bright seam that travels along it. */
  | 'crucible'
  /** Individual coal chips, each pulsing on its own phase instead of one shared blink. */
  | 'coals'
  /** Heat distortion read as soft-light bands climbing the frame. */
  | 'shimmer'
  /** A churning pool of acid at the floor, with a foam line that runs along its surface. */
  | 'sludge'
  /** Viscous strands hanging from the ceiling, each shedding a drop on its own clock. */
  | 'drip'
  /** Vertical curtains of coloured light that wave on their own clocks, under a fading mask. */
  | 'curtain'
  /** A cold horizon line with light pollution welling up from below it. */
  | 'horizon'
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
  /**
   * A second field on the same canvas. `ember` needs it: ash falling from above against embers
   * rising from below is what makes the floor read as a fire rather than as an orange gradient.
   */
  sceneAlt: ParticleScene | null
  /** Rebuilt to the flagship standard — drives the longer layer stack, the preview and the shelf chip. */
  renewed: boolean
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
    sceneAlt: null,
    renewed: false,
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
  // Ocak / Forge (0.3.2). The old `ember` was a fire gradient with dots rising through it. This is a
  // forge: a molten bath that breathes at the floor, a bright seam that travels along it, coal chips
  // each cooling on their own clock, heat shimmer climbing the frame, smoke, and ash falling from
  // above while embers rise from below. Seven layers deep, so a weak machine still gets the bath.
  ember: {
    key: 'ember',
    moodKey: 'theme.moodWarm',
    signature: 'rise',
    ambient: 'ember',
    glow: ['rgba(255, 122, 47, 0.34)', 'rgba(255, 209, 102, 0.22)'],
    layers: ['crucible', 'flames', 'coals', 'shimmer', 'smoke', 'mesh', 'vignette'],
    cardEdge: 'heat',
    parallax: 16,
    scene: { kind: 'ember', density: 150, palette: ['#ff5a1f', '#ffd88a'], speed: 1.4, size: 2.2, gravity: 0.75, twinkle: true },
    sceneAlt: { kind: 'ash', density: 54, palette: ['#9c8b81', '#4a3a31'], speed: 0.45, size: 1.4, gravity: -0.3, twinkle: false },
    renewed: true,
    minimumTierForScene: 'medium',
    tokens: {
      base: '#0b0605',
      panel: '#17100a',
      panelSoft: '#241610',
      line: '#3f2417',
      ink: '#f9ede3',
      mute: '#c69d82',
      brand: '#ff8a3d',
      brandSoft: '#3f1c0a',
      danger: '#ff5f57',
      warn: '#ffd166',
      good: '#8fd08a'
    },
    motion: { cycleSeconds: 12, spring: { stiffness: 260, damping: 24 }, travel: 11 }
  },
  // Toksik (0.3.3). The old skin was a hazard stripe with dots in it. This is a leak: an acid pool
  // churning at the floor with a foam line running across its surface, strands of ooze hanging from
  // the ceiling and shedding drops on staggered clocks, a double scan pass, drifting contamination
  // dust against falling spores, and a film grain so the green never reads as flat neon.
  toxic: {
    key: 'toxic',
    moodKey: 'theme.moodAcid',
    signature: 'pulse',
    ambient: 'acid',
    glow: ['rgba(132, 249, 92, 0.3)', 'rgba(45, 212, 191, 0.2)'],
    // Sludge is the signature: a machine that can only afford two layers still gets a leaking floor.
    layers: ['sludge', 'drip', 'hazard', 'bubbles', 'scanline', 'grain', 'vignette'],
    cardEdge: 'acid',
    parallax: 14,
    scene: { kind: 'spore', density: 120, palette: ['#b6f24a', '#2dd4bf'], speed: 0.6, size: 2.8, gravity: -0.1, twinkle: true },
    sceneAlt: { kind: 'dust', density: 64, palette: ['#7ea86a', '#d9f99d'], speed: 0.16, size: 1.3, gravity: 0, twinkle: false },
    renewed: true,
    minimumTierForScene: 'medium',
    tokens: {
      base: '#04100a',
      panel: '#0a1d12',
      panelSoft: '#123020',
      line: '#22522f',
      ink: '#eafceb',
      mute: '#8fb896',
      brand: '#84f95c',
      brandSoft: '#14401f',
      danger: '#ff7a7a',
      warn: '#eaff5a',
      good: '#3ee08a'
    },
    motion: { cycleSeconds: 7, spring: { stiffness: 380, damping: 26 }, travel: 12 }
  },
  // Kutup (0.3.4). Three horizontal bands was a screensaver. This is a polar night sky: light curtains
  // waving on their own clocks over a star backing, a cold horizon with light pollution welling up from
  // under it, drifting mesh and a film grain so the cyan never sits flat on the panel.
  aurora: {
    key: 'aurora',
    moodKey: 'theme.moodAurora',
    signature: 'flow',
    ambient: 'aurora',
    glow: ['rgba(79, 210, 255, 0.26)', 'rgba(168, 139, 255, 0.24)'],
    layers: ['curtain', 'ribbons', 'horizon', 'mesh', 'grain', 'vignette'],
    cardEdge: 'conic',
    parallax: 18,
    scene: { kind: 'ribbon', density: 8, palette: ['#4fd2ff', '#a88bff'], speed: 0.5, size: 1.7, gravity: 0, twinkle: false },
    sceneAlt: { kind: 'star', density: 90, palette: ['#eaf3ff', '#9fd8ff'], speed: 0.18, size: 1.1, gravity: 0, twinkle: true },
    renewed: true,
    minimumTierForScene: 'medium',
    tokens: {
      base: '#030814',
      panel: '#081428',
      panelSoft: '#0f1e38',
      line: '#1d3355',
      ink: '#eaf3ff',
      mute: '#8fa8cc',
      brand: '#4fd2ff',
      brandSoft: '#0b2f4a',
      danger: '#ff8aa8',
      warn: '#a88bff',
      good: '#5eead4'
    },
    motion: { cycleSeconds: 18, spring: { stiffness: 240, damping: 22 }, travel: 12 }
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
    sceneAlt: null,
    renewed: false,
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
