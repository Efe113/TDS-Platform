import { z } from 'zod'
import { strategyIrSchema } from '../ir/strategy-ir'
import { MOTION_SETTINGS } from '../domain/motion'
import type { UnmatchedEntry } from '../import/unmatched'

export const HOTKEY_ACTIONS = ['next', 'prev', 'reset'] as const
export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number]

export const hotkeyBindingsSchema = z
  .object({
    next: z.string().nullable().default('KeyF'),
    prev: z.string().nullable().default('KeyG'),
    reset: z.string().nullable().default('KeyH')
  })
  .strict()

export type HotkeyBindings = z.infer<typeof hotkeyBindingsSchema>

export const HOTKEY_BACKENDS = ['koffi-ll-hook', 'uiohook', 'focused-window', 'tray-only'] as const
export type HotkeyBackend = (typeof HOTKEY_BACKENDS)[number]

export const hotkeyStatusSchema = z.object({
  backend: z.enum(HOTKEY_BACKENDS),
  running: z.boolean(),
  degraded: z.boolean().default(false),
  paused: z.boolean().default(false),
  disabledByRemoteFlag: z.boolean().default(false),
  messageKey: z.string().optional()
})

export type HotkeyStatus = z.infer<typeof hotkeyStatusSchema>

export const hotKeyEventSchema = z.object({
  action: z.enum(HOTKEY_ACTIONS),
  code: z.string(),
  at: z.number()
})

export type HotKeyEvent = z.infer<typeof hotKeyEventSchema>

export const overlayStepCardSchema = z.object({
  stepNo: z.number().int().positive(),
  totalSteps: z.number().int().positive(),
  waveFrom: z.number().int().nonnegative().optional(),
  waveTo: z.number().int().nonnegative().optional(),
  waveLabel: z.string().optional(),
  action: z.string(),
  towerLabel: z.string().optional(),
  towerLabelTr: z.string().optional(),
  level: z.number().int().optional(),
  count: z.number().int().optional(),
  spec: z.string().optional(),
  note: z.string().optional(),
  raw: z.string(),
  unresolved: z.boolean().default(false),
  /**
   * What the community and this account said about this step, carried in from the detail page: the
   * overlay is the one place the member actually needs "14 denedi, 6'sı tıkandı" and the mark they
   * left, and the main process has no database connection to ask for it.
   */
  worked: z.number().int().nonnegative().optional(),
  stuck: z.number().int().nonnegative().optional(),
  marked: z.boolean().optional(),
  verdict: z.enum(['worked', 'stuck']).optional()
})

export type OverlayStepCard = z.infer<typeof overlayStepCardSchema>

export const overlayStateSchema = z.object({
  strategyId: z.string(),
  strategyName: z.string(),
  isEventStrategy: z.boolean().default(false),
  mapName: z.string().optional(),
  difficulty: z.string().optional(),
  bestTime: z.string().optional(),
  modifierNotes: z.array(z.string()).default([]),
  stepIndex: z.number().int().min(0).default(0),
  current: overlayStepCardSchema.nullable(),
  upcoming: z.array(overlayStepCardSchema).max(2).default([]),
  placementImageRef: z.string().optional(),
  totalSteps: z.number().int().nonnegative(),
  visible: z.boolean().default(true),
  /**
   * The live session, on the state the shell already mirrors. `sessionSummary()` existed for two
   * releases with no caller, so a member could not see how long they had been running or how far they
   * got — the numbers the ledger is being written from were invisible to the person generating them.
   */
  sessionId: z.string().nullable().default(null),
  sessionStartedAt: z.number().int().nonnegative().nullable().default(null),
  stepsAdvanced: z.number().int().nonnegative().default(0),
  maxStep: z.number().int().nonnegative().default(0),
  /**
   * How the tracked document reached the rail. `cache` means main read it off the disk, so the
   * community counts and the Turkish names are as fresh as the last online load — the surface says so
   * instead of presenting a stale number as a live one.
   */
  source: z.enum(['live', 'cache']).default('live'),
  savedAt: z.number().int().nonnegative().nullable().default(null)
})

export type OverlayState = z.infer<typeof overlayStateSchema>

export const OVERLAY_CARD_STYLES = ['classic', 'glow', 'scan'] as const
export type OverlayCardStyle = (typeof OVERLAY_CARD_STYLES)[number]

export const OVERLAY_ANCHORS = ['top-left', 'top-center', 'top-right', 'bottom-right', 'bottom-center', 'bottom-left'] as const
export type OverlayAnchor = (typeof OVERLAY_ANCHORS)[number]

export const overlayGeometrySchema = z.object({
  displayId: z.number().int().optional(),
  anchor: z.enum(OVERLAY_ANCHORS).default('top-right'),
  width: z.number().int().positive().default(340),
  height: z.number().int().positive().default(240),
  marginX: z.number().int().nonnegative().default(16),
  marginY: z.number().int().nonnegative().default(16),
  zoomFactor: z.number().positive().default(1),
  opacity: z.number().min(0.2).max(1).default(0.92),
  /** Free: how large the card text renders, and how many upcoming steps are listed. */
  fontScale: z.number().min(0.85).max(1.35).default(1),
  upcomingCount: z.number().int().min(0).max(2).default(2),
  /** Unlocked with coins; the overlay falls back to classic when not owned. */
  cardStyle: z.enum(OVERLAY_CARD_STYLES).default('classic'),
  showCounter: z.boolean().default(false),
  themeBound: z.boolean().default(false)
})

export type OverlayGeometry = z.infer<typeof overlayGeometrySchema>

/**
 * A patch must not use `.partial()` on a schema full of `.default()`s: Zod fills every missing key,
 * and merging that into the store resets every control the user did not touch. These schemas keep the
 * validation but never invent a value.
 */
export const overlayGeometryPatchSchema = z.object({
  displayId: z.number().int().optional(),
  anchor: z.enum(OVERLAY_ANCHORS).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  marginX: z.number().int().nonnegative().optional(),
  marginY: z.number().int().nonnegative().optional(),
  zoomFactor: z.number().positive().optional(),
  opacity: z.number().min(0.2).max(1).optional(),
  fontScale: z.number().min(0.85).max(1.35).optional(),
  upcomingCount: z.number().int().min(0).max(2).optional(),
  cardStyle: z.enum(OVERLAY_CARD_STYLES).optional(),
  showCounter: z.boolean().optional(),
  themeBound: z.boolean().optional()
})

export type OverlayGeometryPatch = z.infer<typeof overlayGeometryPatchSchema>

export const DEFAULT_OVERLAY_GEOMETRY: OverlayGeometry = {
  anchor: 'top-right',
  width: 340,
  height: 240,
  marginX: 16,
  marginY: 16,
  zoomFactor: 1,
  opacity: 0.92,
  fontScale: 1,
  upcomingCount: 2,
  cardStyle: 'classic',
  showCounter: false,
  themeBound: false
}

export const DEFAULT_HOTKEY_BINDINGS: HotkeyBindings = { next: 'KeyF', prev: 'KeyG', reset: 'KeyH' }

export const START_ROUTES = ['home', 'discover', 'leaderboard'] as const
export type StartRoute = (typeof START_ROUTES)[number]

export const UI_SCALES = [0.9, 1, 1.1] as const
export type UiScale = (typeof UI_SCALES)[number]

export const settingsSchema = z.object({
  locale: z.enum(['tr', 'en']).default('tr'),
  overlay: overlayGeometrySchema.default(DEFAULT_OVERLAY_GEOMETRY),
  hotkeys: hotkeyBindingsSchema.default(DEFAULT_HOTKEY_BINDINGS),
  autoStartOverlay: z.boolean().default(false),
  /** Desktop behaviour. Main is the only process that can actually apply these. */
  launchAtLogin: z.boolean().default(false),
  startMinimized: z.boolean().default(false),
  closeToTray: z.boolean().default(true),
  preventSleep: z.boolean().default(false),
  startRoute: z.enum(START_ROUTES).default('home'),
  uiScale: z.union([z.literal(0.9), z.literal(1), z.literal(1.1)]).default(1),
  highContrast: z.boolean().default(false),
  /**
   * Anonymous crash/diagnostic reporting (wired with Sentry in M9). Kept separate from
   * `usageTracking` on purpose: the usage counter is the account's own product mechanic that the
   * privacy policy describes, not telemetry about crashes.
   */
  telemetryOptIn: z.boolean().default(false),
  /** When false the overlay still works, but no session is opened and nothing is counted. */
  usageTracking: z.boolean().default(true),
  /**
   * Animation density. `auto` reads cores/memory and then lets a measured frame-rate sample lower the
   * tier - it never raises it, so the choice cannot flap while the user is watching.
   */
  motionTier: z.enum(MOTION_SETTINGS).default('auto'),
  /**
   * The overlay window cannot read the profile, so the main window mirrors the skin key here when it
   * applies a theme. Null means the built-in overlay palette.
   */
  overlayThemeKey: z.string().nullable().default(null)
})

export type Settings = z.infer<typeof settingsSchema>

export const settingsPatchSchema = z.object({
  locale: z.enum(['tr', 'en']).optional(),
  overlay: overlayGeometrySchema.optional(),
  hotkeys: hotkeyBindingsSchema.optional(),
  autoStartOverlay: z.boolean().optional(),
  launchAtLogin: z.boolean().optional(),
  startMinimized: z.boolean().optional(),
  closeToTray: z.boolean().optional(),
  preventSleep: z.boolean().optional(),
  startRoute: z.enum(START_ROUTES).optional(),
  uiScale: z.union([z.literal(0.9), z.literal(1), z.literal(1.1)]).optional(),
  highContrast: z.boolean().optional(),
  telemetryOptIn: z.boolean().optional(),
  usageTracking: z.boolean().optional(),
  motionTier: z.enum(MOTION_SETTINGS).optional(),
  overlayThemeKey: z.string().nullable().optional()
})

export type SettingsPatch = z.infer<typeof settingsPatchSchema>

export const appMetaSchema = z.object({
  name: z.string(),
  version: z.string(),
  electron: z.string(),
  platform: z.string(),
  userDataPath: z.string(),
  policyVersion: z.string(),
  /** Login-at-start only works for an installed build; the UI says so instead of pretending. */
  packaged: z.boolean().default(false)
})

export const displayInfoSchema = z.object({
  id: z.number().int(),
  label: z.string(),
  primary: z.boolean(),
  width: z.number().int().positive(),
  height: z.number().int().positive()
})

export type DisplayInfo = z.infer<typeof displayInfoSchema>

export type AppMeta = z.infer<typeof appMetaSchema>

export const IPC_CHANNELS = {
  appGetMeta: 'app:getMeta',
  appOpenExternal: 'app:openExternal',
  displayList: 'display:list',
  appQuit: 'app:quit',
  appMinimizeToTray: 'app:minimizeToTray',
  /** A `tdsapp://…` link that arrived while the app was running, already turned into a route. */
  appDeepLink: 'app:deepLink',

  /**
   * The main window draws its own title bar, so these are the only way the renderer can move it.
   * `windowClose` is deliberately not `appQuit`: closing the window keeps the overlay and the tray
   * running, which is the documented behaviour of `window-all-closed`.
   */
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowClose: 'window:close',
  windowGetMaximized: 'window:getMaximized',
  windowMaximizedChanged: 'window:maximizedChanged',

  overlayShow: 'overlay:show',
  overlayHide: 'overlay:hide',
  overlayToggle: 'overlay:toggle',
  overlaySetGeometry: 'overlay:setGeometry',
  overlaySetInteractive: 'overlay:setInteractive',
  overlayStateChanged: 'overlay:stateChanged',
  overlayCss: 'overlay:css',

  hotkeysGetBindings: 'hotkeys:getBindings',
  hotkeysBindingsChanged: 'hotkeys:bindingsChanged',
  hotkeysStatusChanged: 'hotkeys:statusChanged',
  settingsChanged: 'settings:changed',
  hotkeysSetBinding: 'hotkeys:setBinding',
  hotkeysClear: 'hotkeys:clear',
  hotkeysGetStatus: 'hotkeys:getStatus',
  hotkeysPause: 'hotkeys:pause',
  hotkeysEvent: 'hotkeys:event',
  hotkeysDegraded: 'hotkeys:degraded',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',

  strategyLoad: 'strategy:load',
  strategyUnload: 'strategy:unload',
  strategyStep: 'strategy:step',
  strategyJump: 'strategy:jump',
  /** The offline shelf: what main kept on disk, what to put back on the rail, and how to erase it. */
  strategyCacheList: 'strategy:cacheList',
  strategyCacheLoad: 'strategy:cacheLoad',
  strategyCacheClear: 'strategy:cacheClear',

  sessionFlushNow: 'session:flushNow',
  sessionOutboxStatus: 'session:outboxStatus',

  importSubmitLink: 'import:submitLink',
  importSubmitPaste: 'import:submitPaste',
  importPickFiles: 'import:pickFiles',
  importProgress: 'import:progress',
  importResult: 'import:result',
  importExtractImage: 'import:extractImage',
  importOpenDraftFolder: 'import:openDraftFolder',

  authGetSession: 'auth:getSession',
  authSignIn: 'auth:signIn',
  authSignUp: 'auth:signUp',
  authSignOut: 'auth:signOut',
  authOauthStart: 'auth:oauthStart',
  authOauthCallback: 'auth:oauthCallback',
  authTokenChanged: 'auth:tokenChanged',

  updateCheck: 'update:check',
  updateApply: 'update:apply',
  updateStatus: 'update:status',

  logOpenFolder: 'log:openFolder'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export const windowMaximizedSchema = z.object({ maximized: z.boolean() })

export type WindowMaximized = z.infer<typeof windowMaximizedSchema>

export const deepLinkSchema = z.object({ route: z.string().min(1).max(200) })

export type DeepLink = z.infer<typeof deepLinkSchema>

export const IPC_EVENT_CHANNELS: readonly string[] = [
  IPC_CHANNELS.overlayStateChanged,
  IPC_CHANNELS.overlayCss,
  IPC_CHANNELS.hotkeysEvent,
  IPC_CHANNELS.hotkeysDegraded,
  IPC_CHANNELS.hotkeysBindingsChanged,
  IPC_CHANNELS.hotkeysStatusChanged,
  IPC_CHANNELS.settingsChanged,
  IPC_CHANNELS.importProgress,
  IPC_CHANNELS.importResult,
  IPC_CHANNELS.updateStatus,
  IPC_CHANNELS.authTokenChanged,
  IPC_CHANNELS.windowMaximizedChanged,
  IPC_CHANNELS.appDeepLink
]

export const IPC_INVOCABLE_CHANNELS: readonly string[] = Object.values(IPC_CHANNELS).filter(
  (channel) => !IPC_EVENT_CHANNELS.includes(channel)
)

export const hotkeyBindingPayloadSchema = z.object({
  action: z.enum(HOTKEY_ACTIONS),
  code: z.string().nullable()
})

export const importLinkPayloadSchema = z.object({ link: z.string().trim().min(3) })
export const importPastePayloadSchema = z.object({ markdown: z.string().trim().min(20).max(2_000_000) })
export const importFilesPayloadSchema = z.object({ paths: z.array(z.string()).min(1) })
export const strategyStepPayloadSchema = z.object({ action: z.enum(HOTKEY_ACTIONS) })

/** Absolute cursor position, so a step in the detail page can be clicked instead of stepped to. */
export const strategyJumpPayloadSchema = z.object({ step: z.number().int().min(0).max(400) })

export type StrategyJumpPayload = z.infer<typeof strategyJumpPayloadSchema>
export const openExternalPayloadSchema = z.object({ url: z.string().url() })

/** Per-step community counts and this account's own mark, from the detail page's queries. */
export const overlayStepHealthSchema = z.object({
  stepNo: z.number().int().positive(),
  worked: z.number().int().nonnegative().default(0),
  stuck: z.number().int().nonnegative().default(0),
  marked: z.boolean().default(false),
  verdict: z.enum(['worked', 'stuck']).optional()
})

export type OverlayStepHealth = z.infer<typeof overlayStepHealthSchema>

/**
 * `strategyId` is the database row the overlay is tracking. Usage sessions can only be opened for a
 * published strategy, so an imported document that has never been published arrives with null and
 * is tracked locally without counters.
 */
export const strategyLoadPayloadSchema = z.object({
  ir: strategyIrSchema,
  strategyId: z.string().uuid().nullable().default(null),
  /**
   * Tower names in the member's language, keyed by catalog key. The overlay used to prettify the
   * English catalog key forever (`medic_tower` → "Medic Tower") because `towerLabelTr` was declared on
   * the card and produced by nobody; the renderer has the catalog, the main process has no database.
   */
  towerNamesTr: z.record(z.string(), z.string()).default({}),
  stepHealth: z.array(overlayStepHealthSchema).default([])
})

export type StrategyLoadPayload = z.input<typeof strategyLoadPayloadSchema>

/**
 * One tracked document kept on disk by the main process (0.3.8). The overlay is the thing a member
 * needs most when the connection is worst — mid-run, in-game, on a dropped Wi-Fi — and until now a
 * restart meant the run was gone because only the renderer could assemble the payload.
 *
 * `key` is the session's own identity (`local:<name>` for an unpublished import), and it is never used
 * as a file name raw: main hashes it into a safe slug.
 */
export const strategyCacheEntrySchema = z.object({
  key: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  savedAt: z.number().int().nonnegative(),
  ir: strategyIrSchema,
  towerNamesTr: z.record(z.string(), z.string()).default({}),
  stepHealth: z.array(overlayStepHealthSchema).default([])
})

export type StrategyCacheEntry = z.infer<typeof strategyCacheEntrySchema>

/** The light row the shell lists; the IR itself is only read when the member picks one. */
export const strategyCacheRowSchema = z.object({
  key: z.string(),
  name: z.string(),
  savedAt: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  mapName: z.string().optional(),
  isEventStrategy: z.boolean().default(false)
})

export type StrategyCacheRow = z.infer<typeof strategyCacheRowSchema>

export const strategyCacheLoadPayloadSchema = z.object({ key: z.string().min(1).max(200) })

/**
 * What the renderer may show about the usage pipeline. `counted` is false while the tracked
 * document has no published strategy, and `pending` is what an offline run has buffered.
 */
export const usageStatusSchema = z.object({
  sessionId: z.string().uuid().nullable().default(null),
  strategyId: z.string().uuid().nullable().default(null),
  startedAt: z.number().int().nonnegative().nullable().default(null),
  counted: z.boolean().default(false),
  pending: z.number().int().nonnegative().default(0),
  pendingForward: z.number().int().nonnegative().default(0),
  attempts: z.number().int().nonnegative().default(0),
  lastError: z.string().nullable().default(null),
  lastFlushedAt: z.number().int().nonnegative().nullable().default(null),
  nextRetryAt: z.number().int().nonnegative().default(0)
})

export type UsageStatus = z.infer<typeof usageStatusSchema>

export const usageFlushResultSchema = z.object({
  attempted: z.boolean(),
  accepted: z.boolean(),
  messageKey: z.enum(['usage.flushed', 'usage.nothingPending', 'usage.deferred', 'usage.failed']).optional(),
  detail: z.string().nullable().default(null),
  status: usageStatusSchema
})

export type UsageFlushResult = z.infer<typeof usageFlushResultSchema>

export const UPDATE_STATES = ['idle', 'checking', 'available', 'downloading', 'downloaded', 'error', 'unsupported'] as const

export const updateStatusSchema = z.object({
  state: z.enum(UPDATE_STATES),
  currentVersion: z.string(),
  availableVersion: z.string().nullable().default(null),
  /** Only meaningful while downloading; electron-updater reports 0..100. */
  progressPercent: z.number().min(0).max(100).nullable().default(null),
  /** electron-updater's own message, kept for the details tooltip rather than the visible line. */
  detail: z.string().nullable().default(null),
  checkedAt: z.number().int().nonnegative().nullable().default(null)
})

export type UpdateStatus = z.infer<typeof updateStatusSchema>

/**
 * `probe: true` reads the status main already holds without touching the network, so opening the
 * settings page can show an update that finished downloading before the page existed.
 */
export const updateCheckPayloadSchema = z.object({ probe: z.boolean().default(false) })

export type HotkeyBindingPayload = z.infer<typeof hotkeyBindingPayloadSchema>
export type ImportLinkPayload = z.infer<typeof importLinkPayloadSchema>
export type ImportPastePayload = z.infer<typeof importPastePayloadSchema>
export type StrategyStepPayload = z.infer<typeof strategyStepPayloadSchema>

export const sessionSummarySchema = z.object({
  userId: z.string().nullable(),
  email: z.string().nullable(),
  provider: z.string().nullable(),
  expiresAt: z.number().nullable(),
  role: z.string().nullable().default('user'),
  handle: z.string().nullable().default(null),
  /** The OAuth avatar from the token's own metadata; null for e-mail accounts. */
  avatarUrl: z.string().nullable().default(null)
})

/**
 * Main owns token persistence and refresh; the renderer only installs these into an
 * in-memory client so RLS-scoped reads work. `tokens` is null when signed out.
 */
export const authSessionPayloadSchema = z.object({
  summary: sessionSummarySchema,
  tokens: z.object({ accessToken: z.string(), refreshToken: z.string() }).nullable()
})

export type SessionSummary = z.infer<typeof sessionSummarySchema>
export type AuthSessionPayload = z.infer<typeof authSessionPayloadSchema>

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string }

export interface ImportResultPayload {
  ok: boolean
  code?: string
  message?: string
  ir?: unknown
  report?: unknown
  /** Catalog labels the import could not resolve; also sent to record_import for the admin gap queue. */
  unmatched?: UnmatchedEntry[]
  source?: { docId?: string; sourceUrl?: string; sha256: string; byteLength: number }
}
