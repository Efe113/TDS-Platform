import type { CSSProperties, ReactNode } from 'react'
import { UserRound } from 'lucide-react'
import { frameSkin, type FrameSkin } from '@tds/shared'
import { cn } from '../../lib/utils'

/**
 * Frames are painted in one place so the market tile, the profile avatar and the admin picker can
 * never disagree about what a buyer is getting.
 *
 * Since 0.3.5 every frame is the same machine with five surfaces — `halo`, `core`, `spin`, `spark`
 * and `mark` — and each one moves differently per frame. The registry supplies the colours and the
 * tempo; the stylesheet supplies the treatment keyed by `data-frame-effect`, and nothing in it may
 * cost a repaint:
 *
 *   * no animated `@property` angle any more. Turning a registered angle re-rasterizes the gradient on
 *     every frame, and six frames on one shelf did that simultaneously — that is what made the app
 *     stutter. The travelling light is now a circular sheet that *rotates* inside a static annulus
 *     mask, which the compositor does for free while the ring's shape (including a squared avatar)
 *     stays exactly where it was drawn.
 *   * no `filter: blur()` and no `mix-blend-mode`. The soft edge is a gradient stop.
 */
export function frameStyle(value: string | null | undefined): CSSProperties | undefined {
  const frame = frameSkin(value)
  if (!frame) return undefined
  return { boxShadow: `0 0 0 2px ${frame.ring}, 0 0 26px -4px ${frame.glow}` }
}

/** The ring's own coordinate system: colours and tempo, handed to the stylesheet as custom properties. */
function frameVars(frame: FrameSkin): CSSProperties {
  return {
    ['--frame-ring' as string]: frame.ring,
    ['--frame-glow' as string]: frame.glow,
    ['--frame-turn' as string]: `${String(frame.turnSeconds)}s`
  } as CSSProperties
}

/**
 * The five layers, always in the same order. `spin` owns a child sheet because the trick is that the
 * mask stays put while the light inside it turns; `spark` carries three bodies, which is the smallest
 * number that reads as a field rather than as a pair.
 */
export function FrameLayers({ frame }: { frame: FrameSkin }): ReactNode {
  return (
    <>
      <span className="frame-halo" />
      <span className="frame-core" />
      <span className="frame-spin">
        <span className="frame-spin-disc" />
      </span>
      <span className="frame-spark">
        <i />
        <i />
        <i />
      </span>
      <span className="frame-mark" />
    </>
  )
}

/** The animated part of a frame, absolutely positioned so the owner only needs `position: relative`. */
export function FrameRing({ value }: { value: string | null | undefined }): ReactNode {
  const frame = frameSkin(value)
  if (!frame) return null
  return (
    <span aria-hidden className="frame-ring" data-frame={frame.key} data-frame-effect={frame.effect} style={frameVars(frame)}>
      <FrameLayers frame={frame} />
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
      'radial-gradient(circle at 30% 24%, rgba(157, 123, 255, 0.34), transparent 54%)',
      'radial-gradient(circle at 72% 74%, rgba(76, 29, 149, 0.32), transparent 58%)'
    ].join(', ')
  }
  if (frame.effect === 'toxic') {
    return [
      'radial-gradient(circle at 32% 24%, rgba(163, 230, 53, 0.42), transparent 54%)',
      'radial-gradient(circle at 72% 72%, rgba(132, 249, 92, 0.46), transparent 58%)',
      'radial-gradient(circle at 50% 50%, rgba(77, 124, 15, 0.3), transparent 74%)'
    ].join(', ')
  }
  if (frame.effect === 'gold') {
    return [
      'radial-gradient(circle at 34% 26%, rgba(255, 236, 190, 0.4), transparent 52%)',
      'radial-gradient(circle at 68% 72%, rgba(230, 193, 90, 0.42), transparent 58%)',
      'radial-gradient(circle at 50% 50%, rgba(176, 132, 38, 0.28), transparent 76%)'
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

/**
 * The real layer list of a frame, in paint order, so the shelf can show what five layers means instead
 * of asserting it. The preview wears the frame at three sizes because a ring that only reads at 64px
 * is a ring that will disappear on a leaderboard row.
 */
export function FrameVitrine({
  value,
  language,
  className
}: {
  value: string | null | undefined
  language: 'tr' | 'en'
  className?: string
}): ReactNode {
  const frame = frameSkin(value)
  if (!frame) return null
  return (
    <div className={cn('frame-vitrine relative flex items-center gap-3', className)}>
      <span
        aria-hidden
        className="absolute inset-0 rounded-xl opacity-80"
        style={{ background: frameHalo(frame.key) }}
      />
      <span className="relative flex shrink-0 items-end gap-1.5">
        <FrameSample value={frame.key} size="sm" className="relative" />
        <FrameSample value={frame.key} size="md" className="relative" />
        <FrameSample value={frame.key} size="lg" className="relative" />
      </span>
      <ol className="relative min-w-0 flex-1 space-y-0.5">
        {frame.layers.map((layer, index) => (
          <li key={layer.key} className="flex items-baseline gap-1.5 text-[10px] leading-tight">
            <span className="hud-num shrink-0 text-mute/70">{String(index + 1).padStart(2, '0')}</span>
            <span className="truncate text-ink/85">{language === 'tr' ? layer.labelTr : layer.labelEn}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
