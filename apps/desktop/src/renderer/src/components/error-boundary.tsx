import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import i18next from 'i18next'
import { TriangleAlert } from 'lucide-react'
import { IPC_CHANNELS } from '@tds/shared'
import { reportRendererError } from '../lib/telemetry'
import { call } from '../lib/ipc'
import { Button } from './ui'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Without this a render throw leaves a blank window with no explanation. The stack goes to telemetry
 * (when a DSN exists) and the user gets a reload that actually re-mounts the tree.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const where = info.componentStack?.split('\n')[1]?.trim() ?? 'unknown'
    reportRendererError(error, `render:${where.replace(/^in /, '')}`)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    // Deliberately plain markup: this tree sits above MotionProvider, so a Reveal here would throw
    // while trying to report a crash.
    return (
      <div className="mx-auto max-w-lg space-y-4 pt-10">
        <div className="flex items-start gap-3 rounded-2xl border border-danger/35 bg-danger/[0.06] px-5 py-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-danger/15 text-danger">
            <TriangleAlert size={19} />
          </span>
          <div className="min-w-0 space-y-1.5">
            <h1 className="text-base font-semibold text-ink">{i18next.t('app.crashed')}</h1>
            <p className="text-xs leading-relaxed text-mute">{i18next.t('app.crashedHint')}</p>
            <p className="break-words rounded-lg border border-line bg-base/60 px-2.5 py-1.5 font-mono text-[11px] text-mute/90">
              {error.message || error.name}
            </p>
            <div className="flex gap-2 pt-1">
              <Button variant="primary" onClick={() => window.location.reload()}>
                {i18next.t('app.crashReload')}
              </Button>
              <Button onClick={() => void call(IPC_CHANNELS.appQuit).catch(() => undefined)}>
                {i18next.t('title.quit')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
