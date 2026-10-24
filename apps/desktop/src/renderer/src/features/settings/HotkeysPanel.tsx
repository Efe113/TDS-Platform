import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { IPC_CHANNELS, type HotkeyAction, type HotkeyBindings, type HotkeyStatus } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { call } from '../../lib/ipc'
import { useIpcEvent } from '../../lib/events'
import { HOTKEY_ACTIONS, HOTKEY_LABEL_KEYS } from '../../lib/labels'
import { formatKeyCode, isModifierOnly } from '../../lib/text'
import { Badge, Banner, Button, Card, Row } from '../../components/ui'

const degradedPayloadSchema = z.object({ messageKey: z.string().optional() })

interface Conflict {
  code: string
  other: HotkeyAction
}

export function HotkeysPanel({
  bindings,
  status,
  onChanged
}: {
  bindings: HotkeyBindings | undefined
  status: HotkeyStatus | undefined
  onChanged: () => void
}): ReactNode {
  const t = useT()
  const [listening, setListening] = useState<HotkeyAction | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [notice, setNotice] = useState<MessageKey | null>(null)
  const [degradedNotice, setDegradedNotice] = useState<string | null>(null)

  useIpcEvent(IPC_CHANNELS.hotkeysDegraded, degradedPayloadSchema, (payload) =>
    setDegradedNotice(payload.messageKey ?? 'settings.degraded.body')
  )

  const bind = useMutation({
    mutationFn: async (input: { action: HotkeyAction; code: string | null }) =>
      call<HotkeyStatus>(IPC_CHANNELS.hotkeysSetBinding, input),
    onSuccess: onChanged
  })

  const clear = useMutation({
    mutationFn: async (action: HotkeyAction) => call<HotkeyStatus>(IPC_CHANNELS.hotkeysClear, { action }),
    onSuccess: onChanged
  })

  useEffect(() => {
    if (!listening) return

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()

      if (event.code === 'Escape') {
        setListening(null)
        setConflict(null)
        setNotice(null)
        return
      }

      // A lone modifier cannot be observed as a hotkey by the low-level hook mapping.
      if (isModifierOnly(event.code)) {
        setNotice('settings.hotkeys.modifierOnly')
        return
      }

      setNotice(null)
      const clash = HOTKEY_ACTIONS.find((action) => action !== listening && bindings?.[action] === event.code)
      if (clash) {
        setConflict({ code: event.code, other: clash })
        return
      }

      setConflict(null)
      bind.mutate({ action: listening, code: event.code })
      setListening(null)
    }

    // Capture phase keeps the keystroke heading to the game instead of the app's own inputs.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [listening, bindings, bind])

  return (
    <Card title={t('settings.hotkeys')} hint={t('settings.hotkeys.hint')}>
      <div className="space-y-3">
        {HOTKEY_ACTIONS.map((action) => {
          const code = bindings?.[action] ?? null
          return (
            <div
              key={action}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel-soft px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{t(HOTKEY_LABEL_KEYS[action])}</span>
                <Badge tone={code ? 'accent' : 'neutral'}>{code ? formatKeyCode(code) : t('common.unbound')}</Badge>
              </div>
              <Row>
                <Button
                  variant={listening === action ? 'primary' : 'ghost'}
                  onClick={() => {
                    setListening(listening === action ? null : action)
                    setConflict(null)
                    setNotice(null)
                  }}
                >
                  {listening === action ? t('settings.hotkeys.listening') : t('settings.hotkeys.bind')}
                </Button>
                {code ? (
                  <Button variant="subtle" busy={clear.isPending} onClick={() => clear.mutate(action)}>
                    {t('settings.hotkeys.clear')}
                  </Button>
                ) : null}
              </Row>
            </div>
          )
        })}

        {listening ? <Banner tone="info">{t('settings.hotkeys.press')}</Banner> : null}
        {notice ? <Banner tone="warn">{t(notice)}</Banner> : null}
        {conflict ? (
          <Banner tone="warn" title={t('settings.hotkeys.conflict', { other: t(HOTKEY_LABEL_KEYS[conflict.other]) })}>
            <div className="flex items-center gap-2">
              <span className="mr-2">{formatKeyCode(conflict.code)}</span>
              <Button
                onClick={() => {
                  if (!listening) return
                  bind.mutate({ action: listening, code: conflict.code })
                  setConflict(null)
                  setListening(null)
                }}
              >
                {t('settings.hotkeys.assignAnyway')}
              </Button>
            </div>
          </Banner>
        ) : null}

        {status ? (
          <div className="space-y-2">
            <Row>
              <Badge tone={status.running ? 'good' : 'warn'}>{t('settings.backend', { backend: status.backend })}</Badge>
              <Badge tone={status.running ? 'good' : 'neutral'}>{status.running ? t('settings.running') : t('settings.stopped')}</Badge>
              {status.paused ? <Badge tone="warn">{t('settings.paused')}</Badge> : null}
              {status.disabledByRemoteFlag ? <Badge tone="danger">{t('settings.degraded.title')}</Badge> : null}
            </Row>
            {status.degraded ? (
              <Banner tone="danger" title={t('settings.degraded.title')}>
                {t('settings.degraded.body')}
              </Banner>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-mute">{t('common.loading')}</p>
        )}

        {degradedNotice ? (
          <Banner tone="danger" title={t('settings.degraded.title')}>
            {t('settings.degraded.body')}
          </Banner>
        ) : null}

        {bind.error ? <Banner tone="danger" title={t('common.errorTitle')}>{bind.error.message}</Banner> : null}
        {clear.error ? <Banner tone="danger" title={t('common.errorTitle')}>{clear.error.message}</Banner> : null}
      </div>
    </Card>
  )
}
