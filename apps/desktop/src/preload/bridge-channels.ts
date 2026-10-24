/**
 * Preload-side copy of the IPC result envelope. Kept separate from `@tds/shared` because a
 * sandboxed preload cannot require chunks, so it must not pull the shared runtime graph in.
 * `scripts/check-preload-channels.mjs` guards the channel literals against drift.
 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string }
