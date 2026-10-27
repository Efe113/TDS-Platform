import { app, BrowserWindow, dialog, screen, shell } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import {
  IPC_CHANNELS,
  appMetaSchema,
  displayInfoSchema,
  POLICY_VERSION,
  buildStrategyIr,
  collectUnmatched,
  hotkeyBindingPayloadSchema,
  importLinkPayloadSchema,
  importPastePayloadSchema,
  overlayGeometryPatchSchema,
  saveTextFilePayloadSchema,
  settingsPatchSchema,
  strategyCacheLoadPayloadSchema,
  strategyLoadPayloadSchema,
  strategyJumpPayloadSchema,
  strategyStepPayloadSchema,
  updateCheckPayloadSchema,
  windowMaximizedSchema,
  type AppMeta,
  type HotkeyStatus,
  type ImportResultPayload,
  type OverlayGeometry,
  type Settings,
  type TowerAliasEntry,
  type UnmatchedEntry
} from '@tds/shared'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthManager } from '../auth/manager'
import { fetchGoogleDocsMarkdown, readMarkdownFile } from '../import/source'
import { logger } from '../log'
import { overlaySession } from '../overlay/session'
import { strategyCache } from '../overlay/cache'
import { strategyFromIr } from '../overlay/labels'
import { settingsStore } from '../settings/store'
import { updateService } from '../updater/service'
import { usageService } from '../usage/service'
import { handle } from './typed-handle'

const ALLOWED_EXTERNAL_HOSTS = ['docs.google.com', 'drive.google.com', 'youtu.be', 'youtube.com', 'discord.com', 'support.google.com']
const ALLOWED_HOST_SUFFIXES = ['.supabase.co']

function isAllowedHost(hostname: string): boolean {
  return (
    ALLOWED_EXTERNAL_HOSTS.includes(hostname) || ALLOWED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  )
}

const extractImagePayloadSchema = z.object({ filePath: z.string().min(1), imageId: z.string().min(1) })

export interface RegisterContext {
  overlay: {
    show: () => void
    hide: () => void
    toggle: () => void
    setInteractive: (value: boolean) => void
    setGeometry: (patch: Partial<OverlayGeometry>) => void
    pushState: (state: ReturnType<typeof overlaySession.state>) => void
  }
  hotkeys: {
    status: () => HotkeyStatus
    setBinding: (action: 'next' | 'prev' | 'reset', code: string | null) => HotkeyStatus
    setPaused: (paused: boolean) => HotkeyStatus
    dispatch: (action: 'next' | 'prev' | 'reset') => void
  }
  getMainWindow: () => BrowserWindow | null
  auth: AuthManager
}

const importsDir = (): string => {
  const dir = join(app.getPath('userData'), 'imports')
  mkdirSync(dir, { recursive: true })
  return dir
}

function isInsideImportsDir(filePath: string): boolean {
  const resolved = resolve(filePath)
  return resolved.startsWith(resolve(importsDir())) && !resolved.includes('..')
}

function openExternal(url: string): void {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Yalnızca http/https bağlantıları açılabilir.')
  }
  if (!isAllowedHost(parsed.hostname)) {
    throw new Error(`Bu alan izni yok: ${parsed.hostname}`)
  }
  void shell.openExternal(url)
}

interface ImportCatalog {
  extraTowers?: TowerAliasEntry[]
  mapKeys?: string[]
}

interface ImportCatalogCache {
  at: number
  value: ImportCatalog
}

const IMPORT_CATALOG_TTL_MS = 15_000
let importCatalogCache: ImportCatalogCache | null = null
let importCatalogInFlight: Promise<ImportCatalog | undefined> | null = null

/**
 * The admin catalog is the authority for what the parser can resolve. Reads are public and cached
 * briefly because every import used to fall back to the bundled 13 towers, which made a populated
 * catalog invisible until the app restarted.
 */
async function loadImportCatalog(db: SupabaseClient | null): Promise<ImportCatalog | undefined> {
  if (!db) return undefined
  const cached = importCatalogCache
  if (cached && Date.now() - cached.at < IMPORT_CATALOG_TTL_MS) return cached.value
  if (importCatalogInFlight) return importCatalogInFlight

  const work = (async (): Promise<ImportCatalog | undefined> => {
    const [towerResult, mapResult] = await Promise.all([
      db.from('towers').select('key,name_en,name_tr,alias').order('key'),
      db.from('maps').select('key').order('key')
    ])
    if (towerResult.error) logger.warn(`tower catalog read failed: ${towerResult.error.message}`)
    if (mapResult.error) logger.warn(`map catalog read failed: ${mapResult.error.message}`)
    if (towerResult.error && mapResult.error) return undefined

    const extraTowers: TowerAliasEntry[] = []
    for (const raw of Array.isArray(towerResult.data) ? towerResult.data : []) {
      const row = raw as Record<string, unknown>
      const key = typeof row.key === 'string' ? row.key : ''
      if (key.length === 0) continue
      const aliases = Array.isArray(row.alias)
        ? row.alias.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : []
      const nameEn = typeof row.name_en === 'string' ? row.name_en : ''
      const nameTr = typeof row.name_tr === 'string' ? row.name_tr : ''
      extraTowers.push({
        key,
        aliases: [...aliases, nameEn, nameTr].filter((value) => value.length > 0),
        labelTr: nameTr.length > 0 ? nameTr : undefined
      })
    }

    const mapKeys = (Array.isArray(mapResult.data) ? mapResult.data : [])
      .map((raw) => (raw as Record<string, unknown>).key)
      .filter((key): key is string => typeof key === 'string' && key.length > 0)

    const value: ImportCatalog = {}
    if (extraTowers.length > 0) value.extraTowers = extraTowers
    if (mapKeys.length > 0) value.mapKeys = mapKeys
    importCatalogCache = { at: Date.now(), value }
    return value
  })().catch((error: unknown) => {
    logger.warn('catalog read failed', error)
    return undefined
  })

  // A missing network must not stall a local file/paste import: after the deadline the bundled
  // dictionary is used, while the request may still finish and warm the cache for next time.
  const deadline = new Promise<undefined>((resolve) => {
    setTimeout(() => resolve(undefined), 1_200)
  })
  importCatalogInFlight = Promise.race([work, deadline]).finally(() => {
    importCatalogInFlight = null
  })

  return importCatalogInFlight
}

async function runImport(
  markdown: string,
  meta: { sourceUrl?: string; docId?: string; sha256: string },
  catalog?: ImportCatalog
): Promise<ImportResultPayload> {
  const built = buildStrategyIr({
    markdown,
    source: meta.docId ? 'gdocs-md' : 'paste',
    sourceUrl: meta.sourceUrl,
    docId: meta.docId,
    rawSha256: meta.sha256,
    extraTowers: catalog?.extraTowers,
    mapKeys: catalog?.mapKeys
  })

  const fileName = `${meta.sha256.slice(0, 16)}.md`
  const filePath = join(importsDir(), fileName)
  await writeFile(filePath, markdown, 'utf8')

  return {
    ok: built.ir !== null,
    code: built.ir === null ? 'needsReview' : undefined,
    message: built.ir === null ? 'Belge çözümlendi ama tamamlanması gereken alanlar var.' : undefined,
    ir: (built.ir ?? built.draft?.ir) as unknown,
    report: built.report as unknown,
    unmatched: collectUnmatched(built.ir ?? built.draft?.ir ?? null, built.report),
    source: { docId: meta.docId, sourceUrl: meta.sourceUrl, sha256: meta.sha256, byteLength: markdown.length }
  }
}

export function registerIpc(context: RegisterContext): void {
  /**
   * Imports are recorded server-side so the profile statistics have a real source. Fire and forget:
   * a failed log must never break an import the user already completed.
   */
  const logImport = (input: {
    kind: 'gdocs_link' | 'file' | 'paste'
    sha256: string
    sourceUrl?: string
    docId?: string
    ok: boolean
    errorCode?: string
    unmatched?: UnmatchedEntry[]
  }): void => {
    const db = context.auth.db
    if (!db) return
    void Promise.resolve(
      db.rpc('record_import', {
        p_kind: input.kind,
        p_status: 'done',
        p_source_url: input.sourceUrl ?? null,
        p_doc_id: input.docId ?? null,
        p_sha256: input.sha256,
        p_error_code: input.ok ? null : (input.errorCode ?? 'needsReview'),
        // The gap queue is the only place an unresolved catalog label can be turned into a catalog row,
        // so it travels with the job rather than being reported separately.
        p_unmatched: input.unmatched ?? []
      })
    ).then(
      () => undefined,
      (error: unknown) => logger.warn('record_import failed', error)
    )
  }
  handle(IPC_CHANNELS.appGetMeta, (): AppMeta =>
    appMetaSchema.parse({
      name: app.name,
      version: app.getVersion(),
      electron: process.versions.electron,
      platform: process.platform,
      userDataPath: app.getPath('userData'),
      policyVersion: POLICY_VERSION,
      packaged: app.isPackaged
    })
  )

  handle(IPC_CHANNELS.displayList, () => {
    const primary = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((display, index) =>
      displayInfoSchema.parse({
        id: display.id,
        label: display.label.trim().length > 0 ? display.label : `Display ${String(index + 1)}`,
        primary: display.id === primary,
        width: display.bounds.width,
        height: display.bounds.height
      })
    )
  })

  handle(IPC_CHANNELS.appOpenExternal, z.object({ url: z.string().url() }), (_event, { url }) => {
    openExternal(url)
    return { opened: true }
  })

  handle(IPC_CHANNELS.appQuit, () => {
    app.quit()
    return { ok: true }
  })

  handle(IPC_CHANNELS.appMinimizeToTray, () => {
    context.getMainWindow()?.hide()
    return { ok: true }
  })

  /**
   * The export path: text out through the native save dialog. The name is slugged here instead of
   * trusted, and the extension picks the filter, so this channel can only ever write a markdown, JSON
   * or plain-text file that the member named — not anything the renderer can think of.
   */
  handle(IPC_CHANNELS.appSaveFile, saveTextFilePayloadSchema, async (_event, { fileName, content }) => {
    const safeName = fileName.replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 100)
    const extension = extname(safeName).toLocaleLowerCase()
    if (!['.md', '.markdown', '.json', '.txt'].includes(extension)) {
      throw new Error('Yalnızca .md, .json veya .txt dosyası yazılabilir.')
    }
    const options: Electron.SaveDialogOptions = {
      title: 'Dışa aktar',
      defaultPath: join(app.getPath('downloads'), safeName),
      filters:
        extension === '.json'
          ? [{ name: 'JSON', extensions: ['json'] }]
          : extension === '.txt'
            ? [{ name: 'Text', extensions: ['txt'] }]
            : [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    }
    // The overlay can be the only window open, and showSaveDialog takes either a window or nothing.
    const open = context.getMainWindow()
    const choice = open ? await dialog.showSaveDialog(open, options) : await dialog.showSaveDialog(options)
    if (choice.canceled || !choice.filePath) return { saved: false, canceled: true }
    await writeFile(choice.filePath, content, 'utf8')
    logger.info(`exported ${String(content.length)} characters to ${basename(choice.filePath)}`)
    return { saved: true, path: choice.filePath }
  })

  handle(IPC_CHANNELS.windowMinimize, () => {
    context.getMainWindow()?.minimize()
    return { ok: true }
  })

  handle(IPC_CHANNELS.windowToggleMaximize, () => {
    const frame = context.getMainWindow()
    if (!frame) return windowMaximizedSchema.parse({ maximized: false })
    if (frame.isMaximized()) frame.unmaximize()
    else frame.maximize()
    return windowMaximizedSchema.parse({ maximized: frame.isMaximized() })
  })

  handle(IPC_CHANNELS.windowGetMaximized, () => windowMaximizedSchema.parse({ maximized: context.getMainWindow()?.isMaximized() === true }))

  handle(IPC_CHANNELS.windowClose, () => {
    context.getMainWindow()?.close()
    return { ok: true }
  })

  handle(IPC_CHANNELS.overlayShow, () => {
    context.overlay.show()
    return context.overlay.pushState(overlaySession.state())
  })

  handle(IPC_CHANNELS.overlayHide, () => {
    context.overlay.hide()
    return { ok: true }
  })

  handle(IPC_CHANNELS.overlayToggle, () => {
    context.overlay.toggle()
    return { visible: context.overlay.pushState(overlaySession.state()) }
  })

  handle(IPC_CHANNELS.overlaySetGeometry, overlayGeometryPatchSchema, (_event, patch) => {
    context.overlay.setGeometry(patch)
    return settingsStore.overlay
  })

  handle(IPC_CHANNELS.overlaySetInteractive, z.object({ interactive: z.boolean() }), (_event, { interactive }) => {
    context.overlay.setInteractive(interactive)
    return { interactive }
  })

  handle(IPC_CHANNELS.hotkeysGetBindings, () => settingsStore.hotkeys)

  handle(IPC_CHANNELS.hotkeysSetBinding, hotkeyBindingPayloadSchema, (_event, { action, code }) => context.hotkeys.setBinding(action, code))

  handle(
    IPC_CHANNELS.hotkeysClear,
    z.object({ action: z.enum(['next', 'prev', 'reset']) }),
    (_event, { action }) => context.hotkeys.setBinding(action, null)
  )

  handle(IPC_CHANNELS.hotkeysGetStatus, () => context.hotkeys.status())

  handle(IPC_CHANNELS.hotkeysPause, z.object({ paused: z.boolean() }), (_event, { paused }) => context.hotkeys.setPaused(paused))

  handle(IPC_CHANNELS.settingsGet, (): Settings => settingsStore.get())

  handle(IPC_CHANNELS.settingsSet, settingsPatchSchema, (_event, patch) => settingsStore.update(patch))

  handle(IPC_CHANNELS.strategyLoad, strategyLoadPayloadSchema, (_event, { ir, strategyId, towerNamesTr, stepHealth }) => {
    // A published strategy is tracked by its row id: the detail page matches on it to turn the step
    // list into a remote, and an imported document has no row, so it keeps the `local:` identity.
    const tracked = strategyFromIr(ir, { id: strategyId ?? undefined, towerNamesTr, stepHealth })
    overlaySession.load(tracked)
    context.overlay.show()
    // The overlay must appear immediately either way, and a slow disk must not delay it.
    void strategyCache.save({ key: tracked.id, name: tracked.name, savedAt: Date.now(), ir, towerNamesTr, stepHealth })
    // The session RPC is network-bound; what it cannot send now the outbox keeps for the next flush.
    void usageService.begin(strategyId)
    return overlaySession.state()
  })

  /* The offline shelf. The renderer owns the database, so a run that has to survive a dropped
     connection or a restart can only come from the process that owns the overlay. */
  handle(IPC_CHANNELS.strategyCacheList, async () => strategyCache.list())

  handle(IPC_CHANNELS.strategyCacheLoad, strategyCacheLoadPayloadSchema, async (_event, { key }) => {
    const tracked = await strategyCache.track(key)
    if (tracked === null) throw new Error('CACHE_MISS')
    overlaySession.load(tracked)
    context.overlay.show()
    // An offline load still opens a session: the events buffer in the outbox and flush later, which is
    // exactly what the outbox was built for.
    const isRow = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key)
    void usageService.begin(isRow ? key : null)
    return overlaySession.state()
  })

  handle(IPC_CHANNELS.strategyCacheClear, async () => ({ removed: await strategyCache.clear() }))

  handle(IPC_CHANNELS.strategyUnload, async () => {
    overlaySession.unload()
    await usageService.end()
    return { ok: true }
  })

  handle(IPC_CHANNELS.sessionOutboxStatus, () => usageService.status())

  handle(IPC_CHANNELS.sessionFlushNow, async () => usageService.flushNow())

  handle(IPC_CHANNELS.strategyStep, strategyStepPayloadSchema, (_event, { action }) => {
    context.hotkeys.dispatch(action)
    return overlaySession.state()
  })

  handle(IPC_CHANNELS.strategyJump, strategyJumpPayloadSchema, (_event, { step }) => {
    overlaySession.jumpTo(step)
    return overlaySession.state()
  })

  handle(IPC_CHANNELS.importSubmitLink, importLinkPayloadSchema, async (_event, { link }) => {
    const [fetched, catalog] = await Promise.all([
      fetchGoogleDocsMarkdown(link),
      loadImportCatalog(context.auth.db)
    ])
    if (!fetched.ok) {
      logger.warn(`import failed: ${fetched.code}`)
      return { ok: false, code: fetched.code, message: fetched.message } satisfies ImportResultPayload
    }
    const linked = await runImport(
      fetched.doc.markdown,
      {
        sourceUrl: fetched.doc.sourceUrl,
        docId: fetched.doc.docId,
        sha256: fetched.doc.sha256
      },
      catalog
    )
    logImport({ kind: 'gdocs_link', sha256: fetched.doc.sha256, sourceUrl: fetched.doc.sourceUrl, docId: fetched.doc.docId, ok: linked.ok, errorCode: linked.code, unmatched: linked.unmatched })
    return linked
  })

  handle(IPC_CHANNELS.importSubmitPaste, importPastePayloadSchema, async (_event, { markdown }) => {
    const sha256 = createHash('sha256').update(markdown, 'utf8').digest('hex')
    const catalog = await loadImportCatalog(context.auth.db)
    const pasted = await runImport(markdown, { sha256 }, catalog)
    logImport({ kind: 'paste', sha256, ok: pasted.ok, errorCode: pasted.code, unmatched: pasted.unmatched })
    return pasted
  })

  handle(IPC_CHANNELS.importPickFiles, async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Strateji dosyası seç',
      properties: ['openFile'],
      filters: [{ name: 'Strateji', extensions: ['md', 'markdown', 'txt'] }]
    }
    const parent = context.getMainWindow()
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { ok: false, code: 'cancelled', message: 'Seçim iptal edildi.' }

    const path = result.filePaths[0] ?? ''
    const [read, catalog] = await Promise.all([
      readMarkdownFile(path),
      loadImportCatalog(context.auth.db)
    ])
    if (!read.ok) return { ok: false, code: read.code, message: read.message }
    const fromFile = await runImport(
      read.doc.markdown,
      { sourceUrl: basename(path), sha256: read.doc.sha256 },
      catalog
    )
    logImport({ kind: 'file', sha256: read.doc.sha256, sourceUrl: basename(path), ok: fromFile.ok, errorCode: fromFile.code, unmatched: fromFile.unmatched })
    return fromFile
  })

  handle(IPC_CHANNELS.importExtractImage, extractImagePayloadSchema, async (_event, { filePath, imageId }) => {
    if (!isInsideImportsDir(filePath)) throw new Error('Dosya yoluna izin verilmiyor.')
    const markdown = await readFile(filePath, 'utf8')
    const re = new RegExp(`^\\[${imageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]:\\s*(<[^>]*>|\\S+)`, 'm')
    const match = re.exec(markdown)
    if (!match?.[1]) return { ok: false, code: 'image-missing', message: 'Görsel belgede bulunamadı.' }
    const raw = match[1].replace(/^<|>$/g, '')
    return { ok: true, data: { imageId, dataUrl: raw.startsWith('data:') ? raw : undefined, ref: raw } }
  })

  handle(IPC_CHANNELS.importOpenDraftFolder, () => {
    void shell.openPath(importsDir())
    return { path: importsDir() }
  })

  handle(IPC_CHANNELS.authGetSession, () => context.auth.current())

  handle(
    IPC_CHANNELS.authSignIn,
    z.object({ email: z.string().email(), password: z.string().min(1) }),
    (_event, { email, password }) => context.auth.signIn(email, password)
  )

  handle(
    IPC_CHANNELS.authSignUp,
    z.object({ email: z.string().email(), password: z.string().min(8), displayName: z.string().min(3).max(32).optional() }),
    (_event, { email, password, displayName }) => context.auth.signUp(email, password, displayName)
  )

  handle(IPC_CHANNELS.authSignOut, () => context.auth.signOut())

  handle(IPC_CHANNELS.authOauthStart, z.object({ provider: z.literal('discord') }), async (_event, { provider }) => {
    const outcome = await context.auth.startOAuth(provider)
    if (outcome.ok && 'url' in outcome && outcome.url) {
      // The URL comes from Supabase's own authorize endpoint, so the https host check still applies.
      openExternal(outcome.url)
    }
    return outcome
  })

  handle(IPC_CHANNELS.authOauthCallback, z.object({ url: z.string() }), async (_event, { url }) =>
    context.auth.handleCallback(url)
  )

  handle(IPC_CHANNELS.logOpenFolder, () => {
    const dir = logger.transports.file.getFile().path
    void shell.openPath(join(dir, '..'))
    return { path: join(dir, '..') }
  })

  handle(IPC_CHANNELS.updateCheck, updateCheckPayloadSchema, (_event, { probe }) =>
    probe ? updateService.status : updateService.check()
  )

  handle(IPC_CHANNELS.updateApply, () => ({ started: updateService.installUpdate(), status: updateService.status }))
}
