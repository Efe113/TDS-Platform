import type { HotkeyAction } from '@tds/shared'
import type { MessageKey } from '../i18n/resources'

export const HOTKEY_ACTIONS: readonly HotkeyAction[] = ['next', 'prev', 'reset']

export const HOTKEY_LABEL_KEYS: Record<HotkeyAction, MessageKey> = {
  next: 'settings.hotkeys.next',
  prev: 'settings.hotkeys.prev',
  reset: 'settings.hotkeys.reset'
}
