import type { MessageKey } from '../i18n/resources'

/**
 * `currency_rules.unit` is a controlled vocabulary in 0038 (`admin_upsert_rule` refuses anything
 * outside it), so the label lives in one table both the admin editor and the wallet can read.
 */
export const UNIT_LABEL: Record<string, MessageKey> = {
  per_event: 'wallet.perEvent',
  per_qualifying_session: 'wallet.unitSession',
  per_approved_version: 'wallet.unitVersion',
  per_first_approval: 'wallet.unitFirstApproval',
  per_badge: 'wallet.unitBadge',
  per_session: 'wallet.unitSessionAny',
  per_run: 'wallet.unitRun',
  per_day: 'wallet.unitDay',
  per_hour: 'wallet.unitHour',
  per_step: 'wallet.unitStep',
  per_wave: 'wallet.unitWave',
  per_percent: 'wallet.unitPercent',
  per_report: 'wallet.unitReport',
  per_comment: 'wallet.unitComment',
  per_vote: 'wallet.unitVote',
  per_invite: 'wallet.unitInvite',
  flat_once: 'wallet.unitOnce'
}

export function unitLabel(unit: string, t: (key: MessageKey) => string): string {
  const key = UNIT_LABEL[unit]
  return key ? t(key) : unit
}
