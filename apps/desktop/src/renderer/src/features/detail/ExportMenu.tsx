import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy, FileJson, FileText, Link } from 'lucide-react'
import { IPC_CHANNELS, type SaveTextFileResult, type StrategyIr } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { call } from '../../lib/ipc'
import { exportFileName, irToJson, irToMarkdown, strategyDeepLink } from '../../lib/export-strategy'
import { Button } from '../../components/ui'
import { Menu, MenuContent, MenuDivider, MenuItem, MenuSection, MenuTrigger } from '../../components/ui/menu'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Getting a strategy out of the app (0.3.8): markdown for a guild post, JSON for another tool, and the
 * `tdsapp://` link for a member who has the companion installed. The document is written from the IR the
 * author published, so a step's duration, repetition and branch survive the export instead of collapsing
 * back into a table row.
 */
export function ExportMenu({
  strategyId,
  fileName,
  getIr
}: {
  strategyId: string
  fileName: string
  getIr: () => StrategyIr | null
}): ReactNode {
  const t = useT()
  // The trigger carries the outcome because the menu closes on select, and a toast would cover the overlay.
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const flash = (): void => {
    setDone(true)
    window.setTimeout(() => setDone(false), 1800)
  }

  const document = (extension: 'md' | 'json'): string | null => {
    const ir = getIr()
    if (ir === null) return null
    return extension === 'md' ? irToMarkdown(ir, t) : irToJson(ir)
  }

  const copy = (extension: 'md' | 'json' | 'link'): void => {
    if (extension === 'link') {
      if (!UUID_RE.test(strategyId)) return
      void navigator.clipboard.writeText(strategyDeepLink(strategyId)).then(flash)
      return
    }
    const content = document(extension)
    if (content === null) return
    void navigator.clipboard.writeText(content).then(flash)
  }

  const save = (extension: 'md' | 'json'): void => {
    const content = document(extension)
    if (content === null) return
    setBusy(true)
    void call<SaveTextFileResult>(IPC_CHANNELS.appSaveFile, { fileName: exportFileName(fileName, extension), content })
      .then((result) => {
        if (result.saved) flash()
      })
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={busy} title={t('detail.exportHint')}>
            {done ? <Check size={14} /> : <FileText size={14} />}
            {done ? t('detail.copied') : t('detail.exportTitle')}
          </Button>
        </MenuTrigger>

        <MenuContent align="end" side="bottom" className="w-72">
          <MenuSection label={t('detail.exportTitle')} />
          <MenuItem icon={Copy} index={0} onSelect={() => copy('md')}>
            {t('detail.copyMarkdown')}
          </MenuItem>
          <MenuItem icon={FileText} index={1} disabled={busy} onSelect={() => save('md')}>
            {t('detail.exportMarkdown')}
          </MenuItem>
          <MenuItem icon={FileJson} index={2} disabled={busy} onSelect={() => save('json')}>
            {t('detail.exportJson')}
          </MenuItem>
          <MenuDivider />
          <MenuItem
            icon={Link}
            index={3}
            disabled={!UUID_RE.test(strategyId)}
            onSelect={() => copy('link')}
          >
            {t('detail.copyLink')}
          </MenuItem>
        </MenuContent>
      </Menu>
      {done ? (
        <span className="sr-only" role="status">
          {t('detail.copied')}
        </span>
      ) : null}
    </>
  )
}
