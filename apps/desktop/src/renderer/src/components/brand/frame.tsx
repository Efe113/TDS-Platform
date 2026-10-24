import type { CSSProperties, ReactNode } from 'react'
import { UserRound } from 'lucide-react'
import { frameSkin } from '@tds/shared'
import { cn } from '../../lib/utils'

/**
 * Frames are painted in one place so the market tile, the profile avatar and the admin picker can
 * never disagree about what a buyer is getting. The registry supplies the base ring and glow; the
 * stylesheet adds the animated treatment keyed by `data-frame-effect`.
 */
export function frameStyle(value: string | null | undefined): CSSProperties | undefined {
  const frame = frameSkin(value)
  if (!frame) return undefined
  return { boxShadow: `0 0 0 2px ${frame.ring}, 0 0 26px -4px ${frame.glow}` }
}

/** The animated part of a frame, absolutely positioned so the owner only needs `position: relative`. */
export function FrameRing({ value }: { value: string | null | undefined }): ReactNode {
  const effect = frameSkin(value)?.effect
  if (!effect) return null
  return (
    <span aria-hidden data-frame-effect={effect} className="frame-ring">
      <span className="frame-ring-band" />
      <span className="frame-ring-haze" />
      <span className="frame-ring-glint" />
      {effect === 'rainbow' ? (
        <>
          <span className="frame-ring-inner" />
          <span className="frame-ring-orbit">
            <span />
            <span />
            <span />
          </span>
          <span className="frame-ring-orbit frame-ring-orbit--counter">
            <span />
            <span />
          </span>
        </>
      ) : null}
      {effect === 'heat' ? (
        <span className="frame-ember-sparks">
          <span />
          <span />
          <span />
        </span>
      ) : null}
      {effect === 'aurora' ? (
        <>
          <span className="frame-aurora-ribbon" />
          <span className="frame-aurora-ribbon frame-aurora-ribbon--counter" />
          <span className="frame-aurora-stars">
            <span />
            <span />
            <span />
          </span>
        </>
      ) : null}
      {effect === 'void' ? (
        <>
          <span className="frame-void-well" />
          <span className="frame-void-arc" />
          <span className="frame-void-arc frame-void-arc--counter" />
          <span className="frame-void-dust">
            <span />
            <span />
            <span />
            <span />
          </span>
        </>
      ) : null}
      {effect === 'toxic' ? (
        <>
          <span className="frame-toxic-hazard" />
          <span className="frame-toxic-spores">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span className="frame-toxic-drip">
            <span />
            <span />
          </span>
        </>
      ) : null}
    </span>
  )
}

/** A halo made for the frame, used behind samples so the preview does not read as one flat glow. */
export function frameHalo(value: string | null | undefined): string | undefined {
  const frame = frameSkin(value)
  if (!frame) return undefined
  if (frame.effect === 'rainbow') {
    return [
      'radial-gradient(circle at 28% 24%, rgba(255, 45, 85, 0.48), transparent 54%)',
      'radial-gradient(circle at 72% 28%, rgba(255, 159, 28, 0.38), transparent 52%)',
      'radial-gradient(circle at 72% 74%, rgba(56, 189, 248, 0.46), transparent 58%)',
      'radial-gradient(circle at 50% 50%, rgba(139, 92, 246, 0.32), transparent 74%)'
    ].join(', ')
  }
  if (frame.effect === 'heat') {
    return [
      'radial-gradient(circle at 32% 22%, rgba(255, 209, 102, 0.45), transparent 52%)',
      'radial-gradient(circle at 70% 76%, rgba(255, 90, 31, 0.5), transparent 58%)',
      'radial-gradient(circle at 50% 50%, rgba(255, 122, 69, 0.32), transparent 74%)'
    ].join(', ')
  }
  if (frame.effect === 'aurora') {
    return [
      'radial-gradient(circle at 28% 24%, rgba(56, 189, 248, 0.48), transparent 55%)',
      'radial-gradient(circle at 74% 68%, rgba(129, 140, 248, 0.46), transparent 58%)',
      'radial-gradient(circle at 58% 42%, rgba(45, 212, 191, 0.34), transparent 62%)'
    ].join(', ')
  }
  if (frame.effect === 'void') {
    // The halo darkens the middle instead of lighting it: a void has to read as a hole, not a glow.
    return [
      'radial-gradient(circle at 50% 50%, rgba(5, 1, 13, 0.94), rgba(23, 9, 48, 0.6) 56%, transparent 76%)',
      'radial-gradient(circle at 30% 24%, rgba(124, 58, 237, 0.32), transparent 54%)',
      'radial-gradient(circle at 72% 74%, rgba(76, 29, 149, 0.32), transparent 58%)'
    ].join(', ')
  }
  if (frame.effect === 'toxic') {
    return [
      'radial-gradient(circle at 32% 24%, rgba(163, 230, 53, 0.42), transparent 54%)',
      'radial-gradient(circle at 72% 72%, rgba(126, 217, 87, 0.46), transparent 58%)',
      'radial-gradient(circle at 50% 50%, rgba(77, 124, 15, 0.3), transparent 74%)'
    ].join(', ')
  }
  return `radial-gradient(circle at 50% 55%, ${frame.glow}, transparent 70%)`
}

const SAMPLE_SIZE = { sm: 'size-9', md: 'size-12', lg: 'size-16' } as const

/** A sample avatar wearing the frame, for places with no real user photo (market, admin). */
export function FrameSample({
  value,
  size = 'md',
  className
}: {
  value: string | null | undefined
  size?: keyof typeof SAMPLE_SIZE
  className?: string
}): ReactNode {
  const frame = frameSkin(value)
  return (
    <span className={cn('frame-sample', SAMPLE_SIZE[size], className)} style={frameStyle(value)}>
      {frame ? (
        <span aria-hidden className="absolute inset-0 rounded-full" style={{ background: frameHalo(value) }} />
      ) : null}
      <FrameRing value={value} />
      <UserRound
        size={size === 'sm' ? 12 : 16}
        className={cn('relative', frame?.effect === 'void' ? 'text-ink/80' : 'text-mute')}
      />
    </span>
  )
}
