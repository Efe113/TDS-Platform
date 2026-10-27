import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Image as ImageIcon,
  Layers,
  MapPin,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Trophy,
  X
} from 'lucide-react'
import type { MediaRef, RequirementEntry, StrategyIr, WaveSkipRule } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { formatBytes, humanTowerLabel } from '../../lib/text'
import { Badge, Button, EmptyState, INPUT_CLASS, cn } from '../../components/ui'
import { Chip, Section } from '../../components/ui/system'
import { towerSuggestions } from './import-draft'

const REQUIREMENT_LABEL: Record<RequirementEntry['kind'], MessageKey> = {
  'skill-tree': 'requirement.skill-tree',
  timescale: 'requirement.timescale',
  group: 'requirement.group',
  consumable: 'requirement.consumable',
  'tower-xp': 'requirement.tower-xp'
}

const WAVE_SKIP_LABEL: Record<WaveSkipRule['kind'], MessageKey> = {
  'skip-until': 'waveSkip.skip-until',
  conditional: 'waveSkip.conditional',
  never: 'waveSkip.never'
}

function MediaLightbox({ item, onClose }: { item: MediaRef; onClose: () => void }): ReactNode {
  const t = useT()
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const preview = item.dataUrl && /^data:image\//i.test(item.dataUrl) ? item.dataUrl : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-base/88 p-6"
      onClick={onClose}
    >
      <div
        className="hud-panel max-h-[86vh] w-full max-w-3xl overflow-hidden p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <ImageIcon size={14} className="text-brand" />
          <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{item.id}</p>
          <Badge>{item.kind}</Badge>
          <Button size="sm" variant="subtle" onClick={onClose} title={t('import.v2.mediaClose')}>
            <X size={13} />
          </Button>
        </div>
        {preview ? (
          <img src={preview} alt={item.id} className="mx-auto max-h-[68vh] w-auto rounded-lg object-contain" />
        ) : (
          <div className="grid place-items-center rounded-lg border border-dashed border-line bg-panel-soft/50 px-4 py-16 text-center">
            <ImageIcon size={26} className="text-mute/50" />
            <p className="mt-2 text-[11px] text-mute">{t('import.v2.mediaPreviewMissing')}</p>
            {item.storagePath ? <p className="mt-1 break-all font-mono text-[10px] text-mute/70">{item.storagePath}</p> : null}
          </div>
        )}
      </div>
    </div>
  )
}

export interface ImportContentProps {
  ir: StrategyIr
  onPatch: (updater: (ir: StrategyIr) => StrategyIr) => void
}

export function ImportContent({ ir, onPatch }: ImportContentProps): ReactNode {
  const t = useT()
  const [preview, setPreview] = useState<MediaRef | null>(null)
  const suggestions = towerSuggestions(ir, ir.steps)
  const setInventory = (index: number, patch: Partial<StrategyIr['inventory'][number]>): void => {
    onPatch((current) => ({
      ...current,
      inventory: current.inventory.map((slot, slotIndex) => (slotIndex === index ? { ...slot, ...patch } : slot))
    }))
  }

  const removeInventory = (index: number): void => {
    onPatch((current) => ({ ...current, inventory: current.inventory.filter((_, slotIndex) => slotIndex !== index) }))
  }

  const addInventory = (): void => {
    onPatch((current) => {
      if (current.inventory.length >= 5) return current
      return {
        ...current,
        inventory: [
          ...current.inventory,
          {
            towerKey: current.inventory[0]?.towerKey ?? 'operator',
            rawLabel: '',
            alternatives: [],
            unresolved: false
          }
        ]
      }
    })
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section
        title={t('import.inventory.title')}
        hint={t('import.v2.content.inventoryHint')}
        aside={
          <Button size="sm" variant="subtle" disabled={ir.inventory.length >= 5} onClick={addInventory}>
            <Plus size={12} />
            {t('import.v2.inventory.add')}
          </Button>
        }
      >
        {ir.inventory.length === 0 ? (
          <EmptyState title={t('import.inventory.empty')} />
        ) : (
          <ul className="space-y-2">
            {ir.inventory.map((slot, index) => (
              <li key={`${slot.towerKey}-${String(index)}`} className="rounded-lg border border-line bg-panel-soft/70 px-2.5 py-2">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-32 flex-1 space-y-1">
                    <span className="block text-[9px] uppercase tracking-wide text-mute">{t('import.v2.inventory.tower')}</span>
                    <input
                      list="import-tower-keys"
                      className={cn(INPUT_CLASS, 'no-drag h-8 py-1 font-mono text-[11px]')}
                      value={slot.towerKey}
                      onChange={(event) => {
                        const value = event.target.value.trim().toLowerCase().replace(/\s+/g, '-')
                        setInventory(index, { towerKey: value, unresolved: value.length === 0 })
                      }}
                    />
                  </label>
                  <label className="w-20 space-y-1">
                    <span className="block text-[9px] uppercase tracking-wide text-mute">{t('import.v2.inventory.count')}</span>
                    <input
                      type="number"
                      min={1}
                      className={cn(INPUT_CLASS, 'no-drag h-8 py-1 text-[11px] tabular-nums')}
                      value={slot.count ?? ''}
                      placeholder="1"
                      onChange={(event) => {
                        const value = Math.max(1, Math.trunc(event.target.valueAsNumber))
                        setInventory(index, { count: Number.isFinite(value) ? value : undefined })
                      }}
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="subtle"
                    className="mb-0.5 text-danger/80"
                    onClick={() => removeInventory(index)}
                    title={t('import.v2.inventory.remove')}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-mute">{humanTowerLabel(slot.towerKey) ?? slot.towerKey}</span>
                  {slot.unresolved ? <Badge tone="warn">{t('import.field.unresolved')}</Badge> : null}
                  {slot.rawLabel ? <span className="text-[10px] text-mute/80">“{slot.rawLabel}”</span> : null}
                  {slot.alternatives.length > 0 ? (
                    <span className="text-[10px] text-mute/80">
                      {t('import.inventory.alternatives', { value: slot.alternatives.join(', ') })}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <datalist id="import-tower-keys">
          {suggestions.map((key) => (
            <option key={key} value={key} />
          ))}
        </datalist>
      </Section>

      <Section
        title={t('import.v2.content.mediaTitle')}
        hint={t('import.v2.content.mediaHint')}
        aside={<Chip tone="neutral" icon={ImageIcon}>{String(ir.media.length)}</Chip>}
      >
        {ir.media.length === 0 ? (
          <EmptyState title={t('import.v2.content.mediaEmpty')} />
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ir.media.map((item, index) => {
              const preview = item.dataUrl && /^data:image\//i.test(item.dataUrl) ? item.dataUrl : null
              return (
                <li key={`${item.id}-${String(index)}`}>
                  <button
                    type="button"
                    className="group w-full overflow-hidden rounded-lg border border-line bg-panel-soft/60 text-left transition-colors hover:border-brand/50"
                    title={t('import.v2.mediaOpen')}
                    onClick={() => setPreview(item)}
                  >
                    <span className="block h-16 overflow-hidden bg-base/60">
                      {preview ? (
                        <img src={preview} alt={item.id} className="size-full object-cover" />
                      ) : (
                        <span className="grid size-full place-items-center text-mute/50">
                          <ImageIcon size={18} />
                        </span>
                      )}
                    </span>
                    <span className="block px-1.5 py-1">
                      <span className="block truncate font-mono text-[9px] text-ink/80">{item.id}</span>
                      <span className="flex items-center justify-between gap-1 text-[9px] text-mute">
                        <span>{item.kind}</span>
                        {item.byteLength !== undefined ? <span>{formatBytes(item.byteLength)}</span> : null}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title={t('import.requirements.title')}>
        {ir.requirements.length === 0 ? (
          <p className="text-[11px] text-mute">{t('import.requirements.empty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {ir.requirements.map((requirement, index) => (
              <li key={`${requirement.kind}-${String(index)}`} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <Badge tone="accent">{t(REQUIREMENT_LABEL[requirement.kind])}</Badge>
                <span className="text-ink">{requirement.value}</span>
                {requirement.detail ? <span className="text-mute">{requirement.detail}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={t('import.modifiers.title')}
        hint={t('import.v2.content.modifiersHint')}
        aside={
          ir.mutatorRule?.minCount !== undefined ? <Badge>{`≥ ${String(ir.mutatorRule.minCount)}`}</Badge> : undefined
        }
      >
        {ir.mutators.length === 0 ? (
          <p className="text-[11px] text-mute">{t('import.modifiers.empty')}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {ir.mutators.map((mutator, index) => (
              <li key={`${mutator.key ?? 'mutator'}-${String(index)}`}>
                <Badge tone={mutator.matchedBy === 'none' ? 'warn' : 'good'}>
                  {mutator.note || mutator.raw || mutator.key || t('common.none')}
                  {mutator.matchedBy === 'none' ? ` · ${t('import.modifiers.pending')}` : ''}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('import.waveSkip.title')}>
        {ir.waveSkip.length === 0 ? (
          <p className="text-[11px] text-mute">{t('import.waveSkip.empty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {ir.waveSkip.map((rule, index) => (
              <li key={`${rule.kind}-${String(index)}`} className="rounded-lg border border-line bg-panel-soft/60 px-2.5 py-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="neutral">{t(WAVE_SKIP_LABEL[rule.kind])}</Badge>
                  {rule.waves ? <span className="text-[10px] text-mute">{t('import.waveSkip.waves', { value: rule.waves })}</span> : null}
                </div>
                <p className="mt-0.5 text-[10px] leading-relaxed text-mute">{rule.raw}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('import.proofs.title')}>
        {ir.proofs.length === 0 ? (
          <p className="text-[11px] text-mute">{t('import.proofs.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {ir.proofs.map((proof, index) => (
              <li key={`${proof.label}-${String(index)}`} className="rounded-lg border border-line bg-panel-soft/60 px-2.5 py-2">
                <p className="text-[11px] font-medium text-ink">{proof.label || t('common.none')}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {proof.bestTime ? <Badge tone="good">{t('overlay.bestTime', { value: proof.bestTime })}</Badge> : null}
                  {proof.coinsPerHour ? <Badge>{t('import.proofs.coins', { value: proof.coinsPerHour })}</Badge> : null}
                  {proof.xpPerHour ? <Badge>{t('import.proofs.xp', { value: proof.xpPerHour })}</Badge> : null}
                </div>
                {proof.setup.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10px] text-mute">
                    {proof.setup.map((line, lineIndex) => (
                      <li key={`${line}-${String(lineIndex)}`}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('import.troubleshooting.title')}>
        {ir.troubleshooting.length === 0 ? (
          <p className="text-[11px] text-mute">{t('import.troubleshooting.empty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {ir.troubleshooting.map((entry, index) => (
              <li key={`${entry.waves}-${String(index)}`}>
                <p className="text-[11px] font-medium text-ink">{entry.waves}</p>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[10px] text-mute">
                  {entry.reasons.map((reason, reasonIndex) => (
                    <li key={`${reason}-${String(reasonIndex)}`}>{reason}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('import.v2.content.hallTitle')} aside={<Trophy size={13} className="text-warn" />}>
        {ir.hallOfFame.length === 0 ? (
          <p className="text-[11px] text-mute">{t('import.v2.content.hallEmpty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {ir.hallOfFame.map((entry, index) => (
              <li key={String(index)} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <Badge tone="good">{entry.bestTime ?? t('common.none')}</Badge>
                <span className="text-mute">{entry.comp.join(' · ') || t('common.none')}</span>
                {entry.notes ? <span className="text-[10px] text-mute/80">{entry.notes}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('import.v2.content.placementTitle')} hint={t('import.v2.content.placementHint')}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone="neutral" icon={Layers}>{t('import.v2.content.placementItems', { count: ir.placement.items.length })}</Chip>
          {ir.placement.imageRef ? (
            <Chip tone="brand" icon={MapPin}>{ir.placement.imageRef}</Chip>
          ) : (
            <span className="text-[10px] text-mute">{t('import.v2.content.placementEmpty')}</span>
          )}
        </div>
        {ir.placement.items.length > 0 ? (
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {ir.placement.items.map((item, index) => (
              <li key={String(index)} className="flex items-center gap-1.5 rounded-md border border-line/70 px-2 py-1 text-[10px]">
                <MapPin size={10} className="shrink-0 text-brand" />
                <span className="min-w-0 truncate text-ink">
                  {item.label || humanTowerLabel(item.towerKey) || item.zone || t('common.none')}
                </span>
                {item.x !== undefined && item.y !== undefined ? (
                  <span className="ml-auto shrink-0 font-mono text-mute">
                    {item.x.toFixed(2)}, {item.y.toFixed(2)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title={t('import.v2.content.notesTitle')} aside={<Sparkles size={13} className="text-brand" />}>
        {ir.notes.length === 0 ? (
          <p className="text-[11px] text-mute">{t('import.v2.content.notesEmpty')}</p>
        ) : (
          <ul className="space-y-1">
            {ir.notes.map((note, index) => (
              <li key={`${note}-${String(index)}`} className="flex items-start gap-1.5 text-[10px] leading-relaxed text-mute">
                <ShieldCheck size={10} className="mt-0.5 shrink-0 text-brand/70" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {preview ? <MediaLightbox item={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  )
}
