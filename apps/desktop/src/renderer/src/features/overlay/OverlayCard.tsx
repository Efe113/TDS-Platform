import type { ReactNode } from 'react'
import type { OverlayState, OverlayStepCard } from '@tds/shared'
import { translate } from '../../i18n/overlay-dict'
import { actionKey } from '../../lib/actions'
import { parseWave, relativeTime } from '../../lib/text'

export interface OverlayPrefs {
  cardStyle: 'classic' | 'glow' | 'scan'
  showCounter: boolean
  upcomingCount: number
}

interface OverlayCardProps {
  state: OverlayState | null
  dimmed: boolean
  interactive: boolean
  prefs: OverlayPrefs
  onHover: (hovered: boolean) => void
  onStep: (action: 'next' | 'prev' | 'reset') => void
  onHide: () => void
}

function WaveChip({ card }: { card: OverlayStepCard }): ReactNode {
  const wave = parseWave(card.waveLabel)
  if (!wave) return null
  const label =
    wave.to !== undefined && wave.to !== wave.from
      ? translate('overlay.wave.range', { from: wave.from, to: wave.to })
      : translate('overlay.wave.single', { wave: wave.from })
  return <span className="rounded-md border border-line bg-panel-soft px-2 py-0.5 text-[11px] text-mute">{label}</span>
}

/**
 * What this step did for other people, and what this account said about it. The overlay is the one
 * surface where "12 kişi işe yaradı dedi, 4'ü tıkandı" changes a decision in the moment — on the
 * detail page the member has already left the fight.
 */
function StepHealth({ card }: { card: OverlayStepCard }): ReactNode {
  const worked = card.worked ?? 0
  const stuck = card.stuck ?? 0
  if (worked + stuck === 0 && card.marked !== true) return null
  return (
    <p className="mt-1 flex items-center gap-2 text-[11px]">
      {worked > 0 ? <span className="text-good">{translate('overlay.worked', { count: worked })}</span> : null}
      {stuck > 0 ? <span className="text-warn">{translate('overlay.stuck', { count: stuck })}</span> : null}
      {card.marked === true ? (
        <span className="text-mute" title={translate('overlay.marked')}>
          • {translate('overlay.marked')}
        </span>
      ) : null}
    </p>
  )
}

function Hero({ card }: { card: OverlayStepCard }): ReactNode {
  const tower = card.towerLabelTr ?? card.towerLabel

  if (card.unresolved || !tower) {
    return (
      <div className="mt-2">
        <p className="text-[11px] uppercase tracking-wide text-warn">{translate('overlay.unresolved')}</p>
        <p className="mt-1 text-base leading-snug font-semibold">{card.raw}</p>
      </div>
    )
  }

  return (
    <div className="mt-2">
      <p className="text-sm font-medium text-brand">{translate(actionKey(card.action))}</p>
      <p className="mt-1 text-lg leading-snug font-semibold">
        {tower}
        {card.level !== undefined ? <span className="ml-1 text-sm font-normal text-mute">Sv.{card.level}</span> : null}
        {card.count !== undefined ? <span className="ml-1 text-sm font-normal text-mute">×{card.count}</span> : null}
      </p>
      {card.spec ? (
        <span className="mt-1 inline-block rounded-md border border-brand/40 bg-brand/15 px-2 py-0.5 text-[11px] text-brand">
          {card.spec}
        </span>
      ) : null}
      {card.note ? <p className="mt-1 line-clamp-2 text-xs text-mute">{card.note}</p> : null}
      <StepHealth card={card} />
    </div>
  )
}

function UpNext({ cards, limit }: { cards: OverlayStepCard[]; limit: number }): ReactNode {
  if (cards.length === 0 || limit === 0) return null
  return (
    <div className="mt-2 rounded-lg border border-line/70 bg-panel-soft/70 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-mute">{translate('overlay.nextUp')}</p>
      <ul className="mt-1 space-y-1">
        {cards.slice(0, limit).map((card) => (
          <li key={String(card.stepNo)} className="flex items-baseline gap-1.5 text-xs">
            <span className="text-mute">{String(card.stepNo)}</span>
            <span className="truncate">
              {translate(actionKey(card.action))}
              {card.towerLabelTr ?? card.towerLabel ? ` · ${card.towerLabelTr ?? card.towerLabel}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MiniButton({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className="rounded-md border border-line bg-panel px-1.5 py-0.5 text-[11px] text-mute hover:border-brand/60 hover:text-ink"
    >
      {children}
    </button>
  )
}

export function OverlayCard({ state, dimmed, interactive, prefs, onHover, onStep, onHide }: OverlayCardProps): ReactNode {
  const total = state?.totalSteps ?? 0
  const card = state?.current ?? null
  const stepPosition = state ? Math.min(state.stepIndex + 1, total) : 0
  const progress = total > 0 ? Math.round((stepPosition / total) * 100) : 0

  // Dimming lives in CSS (.overlay-card[data-dimmed]) so the transition survives React re-renders.
  return (
    <div
      data-dimmed={String(dimmed)}
      data-style={prefs.cardStyle}
      style={{ fontSize: `calc(1em * var(--ov-font-scale, 1))` }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      className="overlay-card relative max-h-full overflow-hidden rounded-xl border border-brand/30 bg-panel/92 p-3 shadow-2xl"
    >
      {dimmed ? (
        <span className="absolute -top-2 right-2 rounded-full border border-line bg-panel px-1.5 py-0.5 text-[10px] text-mute">
          {translate('overlay.idleHint')}
        </span>
      ) : null}

      {state?.isEventStrategy ? (
        <div className="-mx-3 -mt-3 mb-2 rounded-t-xl border-b border-warn/40 bg-warn/20 px-3 py-1 text-[11px] font-medium text-warn">
          {translate('overlay.eventRibbon')}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-xs font-semibold text-brand">
            {card ? translate('overlay.step', { current: stepPosition, total }) : translate('overlay.empty')}
          </span>
          {/* Honest about its own freshness: the numbers on this card were true when the document was
              saved, not now, and a member tracking from the shelf must not read them as live telemetry. */}
          {state?.source === 'cache' && state.savedAt !== null ? (
            <span className="truncate rounded-md border border-warn/40 bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">
              {translate('shelf.cached', { when: relativeTime(new Date(state.savedAt).toISOString(), 'tr') })}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-1">
          {prefs.showCounter ? (
            <span
              style={{
                fontSize: 'calc(1em * var(--ov-font-scale, 1) * 0.7)'
              }}
              className="rounded-md border border-brand/40 bg-brand/15 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-brand"
            >
              {`${String(stepPosition)}/${String(total)}`}
            </span>
          ) : null}
          {interactive ? (
            <>
              <MiniButton onClick={() => onStep('prev')} label={translate('common.prev')}>
                ‹
              </MiniButton>
              <MiniButton onClick={() => onStep('next')} label={translate('common.next')}>
                ›
              </MiniButton>
              <MiniButton onClick={onHide} label={translate('common.close')}>
                ×
              </MiniButton>
            </>
          ) : null}
        </span>
      </div>

      {!state || !card ? (
        <p className="mt-2 text-sm text-mute">{translate('overlay.empty')}</p>
      ) : (
        <>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <WaveChip card={card} />
            {state.difficulty ? <span className="text-[11px] text-mute">{state.difficulty}</span> : null}
          </div>

          <Hero card={card} />

          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-brand" style={{ width: `${String(progress)}%` }} />
          </div>

          <p className="mt-1 truncate text-[11px] text-mute">
            {state.strategyName}
            {state.mapName ? ` · ${state.mapName}` : ''}
          </p>
          {state.bestTime ? (
            <p className="text-[11px] text-mute">{translate('overlay.bestTime', { value: state.bestTime })}</p>
          ) : null}

          <UpNext cards={state.upcoming} limit={prefs.upcomingCount} />

          {state.modifierNotes.length > 0 ? (
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-wide text-mute">{translate('overlay.modifiers')}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {state.modifierNotes.slice(0, 4).map((note, index) => (
                  <span
                    key={`${note}-${String(index)}`}
                    className="max-w-full truncate rounded-md border border-line bg-panel-soft px-1.5 py-0.5 text-[10px] text-mute"
                  >
                    {note}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
