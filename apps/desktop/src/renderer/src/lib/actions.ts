import type { MessageKey } from '../i18n/resources'

/** Duplicated from shared on purpose: importing the barrel into the overlay bundle would drag zod in. */
export const STEP_ACTIONS = ['place', 'upgrade', 'max', 'sell', 'change', 'use', 'skip', 'wait', 'note', 'raw'] as const

export function actionKey(action: string): MessageKey {
  const known: readonly string[] = STEP_ACTIONS
  return known.includes(action) ? (`action.${action}` as MessageKey) : 'action.raw'
}
