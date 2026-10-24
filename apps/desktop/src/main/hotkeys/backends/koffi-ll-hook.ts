import koffi from 'koffi'

const WH_KEYBOARD_LL = 13
const HC_ACTION = 0
const WM_KEYUP = 0x101
const WM_SYSKEYUP = 0x105
const PROTO_NAME = 'TdsCompanionKeyboardProc'

export interface ObservedKeyEvent {
  code: string
  vkCode: number
  scanCode: number
  kind: 'down' | 'up'
  isInjected: boolean
}

export interface LowLevelKeyboardHook {
  start: () => void
  stop: () => void
  readonly running: boolean
}

interface HookOptions {
  onKey: (event: ObservedKeyEvent) => void
  onError: (stage: string, error: unknown) => void
  decode: (vkCode: number, scanCode: number, flags: number) => { code: string; isInjected: boolean; isExtended: boolean }
}

type Kbdllhookstruct = { vkCode: number; scanCode: number; flags: number; time: number; dwExtraInfo: unknown }
type User32Fn = (...args: unknown[]) => unknown

let typesDeclared = false

function declareTypes(): void {
  if (typesDeclared) return
  koffi.struct('KBDLLHOOKSTRUCT', {
    vkCode: 'uint32',
    scanCode: 'uint32',
    flags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'void*'
  })
  koffi.proto(`intptr __stdcall ${PROTO_NAME}(int32_t nCode, uintptr_t wParam, void *lParam)`)
  typesDeclared = true
}

export function createKoffiLowLevelKeyboardHook(options: HookOptions): LowLevelKeyboardHook {
  declareTypes()

  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')

  const callNextHookEx = user32.func(
    'intptr __stdcall CallNextHookEx(void *hhk, int32_t nCode, uintptr_t wParam, void *lParam)'
  ) as User32Fn
  const setWindowsHookExW = user32.func(
    'void * __stdcall SetWindowsHookExW(int32_t idHook, void *lpfn, void *hmod, uint32_t dwThreadId)'
  ) as User32Fn
  const unhookWindowsHookEx = user32.func('bool __stdcall UnhookWindowsHookEx(void *hhk)') as User32Fn
  const getModuleHandleW = kernel32.func('void * __stdcall GetModuleHandleW(void *name)') as User32Fn

  const downCodes = new Set<number>()
  let hookHandle: bigint | null = null
  let callback: bigint | null = null

  const handler = (nCode: number, wParam: number, lParam: unknown): number => {
    if (nCode === HC_ACTION) {
      try {
        const record = koffi.decode(lParam as never, 'KBDLLHOOKSTRUCT') as unknown as Kbdllhookstruct
        const kind: ObservedKeyEvent['kind'] = wParam === WM_KEYUP || wParam === WM_SYSKEYUP ? 'up' : 'down'
        const decoded = options.decode(record.vkCode, record.scanCode, record.flags)

        if (kind === 'down') {
          const isRepeat = downCodes.has(record.vkCode)
          downCodes.add(record.vkCode)
          if (!isRepeat) {
            options.onKey({
              code: decoded.code,
              vkCode: record.vkCode,
              scanCode: record.scanCode,
              kind: 'down',
              isInjected: decoded.isInjected
            })
          }
        } else {
          downCodes.delete(record.vkCode)
          options.onKey({
            code: decoded.code,
            vkCode: record.vkCode,
            scanCode: record.scanCode,
            kind: 'up',
            isInjected: decoded.isInjected
          })
        }
      } catch (error) {
        // Never break the chain: a throwing hook proc would kill the system keyboard.
        options.onError('callback', error)
      }
    }

    return Number(callNextHookEx(hookHandle, nCode, wParam, lParam))
  }

  return {
    get running() {
      return hookHandle !== null
    },
    start() {
      if (hookHandle !== null) return
      callback = koffi.register(handler, `${PROTO_NAME}*`) as unknown as bigint
      hookHandle = setWindowsHookExW(WH_KEYBOARD_LL, callback, getModuleHandleW(null), 0) as bigint | null
      if (!hookHandle) {
        const errno = (koffi as unknown as { errno?: number }).errno
        koffi.unregister(callback as unknown as never)
        callback = null
        throw new Error(`SetWindowsHookExW failed${errno ? ` (errno=${errno})` : ''}`)
      }
    },
    stop() {
      if (hookHandle !== null) {
        try {
          unhookWindowsHookEx(hookHandle)
        } catch (error) {
          options.onError('unhook', error)
        }
        hookHandle = null
        downCodes.clear()
      }
      if (callback !== null) {
        try {
          koffi.unregister(callback as unknown as never)
        } catch (error) {
          options.onError('unregister', error)
        }
        callback = null
      }
    }
  }
}
