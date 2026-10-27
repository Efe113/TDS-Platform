/**
 * The one frame loop in the renderer.
 *
 * Every canvas decoration used to own a `requestAnimationFrame` chain. That is fine while it is the
 * only one and ruinous on a market shelf with five live theme miniatures plus the window field behind
 * them: N loops means N wakeups per frame, N independent delta clocks, and no single place to say
 * "these run at 30, this one runs at 60". One loop with per-client rate ceilings fixes all three.
 *
 * The loop also stops when nothing is subscribed and while the window is hidden, which is the case
 * that matters most here: the app sits on top of a game, and a background animation that keeps waking
 * the main thread is a bug rather than a feature.
 */

type Tick = (nowMs: number, deltaMs: number) => void

interface Client {
  tick: Tick
  /** Minimum distance between two calls, in ms. `Infinity` would mean "never", so use unsubscribe. */
  interval: number
  last: number
}

const clients = new Set<Client>()

let frame = 0
let stopped = false

function step(nowMs: number): void {
  frame = window.requestAnimationFrame(step)
  // A snapshot: a client that unsubscribes from inside its own tick would otherwise mutate the set
  // mid-iteration and skip the next one.
  for (const client of [...clients]) {
    if (nowMs - client.last < client.interval - 1) continue
    const delta = Math.min(64, nowMs - client.last)
    client.last = nowMs
    client.tick(nowMs, delta)
  }
}

function start(): void {
  if (stopped || frame !== 0 || clients.size === 0) return
  frame = window.requestAnimationFrame(step)
}

function stop(): void {
  if (frame === 0) return
  window.cancelAnimationFrame(frame)
  frame = 0
}

function setStopped(next: boolean): void {
  stopped = next
  if (next) stop()
  else start()
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  // A window opened into a hidden state (restore-while-minimised) must not run its decorations at all.
  stopped = document.hidden
  document.addEventListener('visibilitychange', () => setStopped(document.hidden))
}

/** `frameRate` is a ceiling, not a promise: the ticker never runs faster than the display does. */
export function subscribeToTicker(tick: Tick, frameRate = 60): () => void {
  const client: Client = { tick, interval: frameRate > 0 ? 1000 / frameRate : Infinity, last: 0 }
  clients.add(client)
  start()
  return () => {
    clients.delete(client)
    if (clients.size === 0) stop()
  }
}

/** How many decorations are currently being driven. Used by the settings diagnostics. */
export function tickerClientCount(): number {
  return clients.size
}
