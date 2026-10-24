import type { ReactNode } from 'react'
import type {
  Difficulty,
  PlayerCount,
  RequirementEntry,
  StrategyIr,
  ValidationReport,
  WaveSkipRule
} from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { humanTowerLabel } from '../../lib/text'
import { Badge, Card, EmptyState, Field, INPUT_CLASS, KeyValue, Row } from '../../components/ui'

const INVENTORY_CAP = 5

const DIFFICULTY_KEYS: Record<Difficulty, MessageKey> = {
  easy: 'difficulty.easy',
  medium: 'difficulty.medium',
  hard: 'difficulty.hard',
  nightmare: 'difficulty.nightmare'
}

const PLAYER_COUNT_KEYS: Record<PlayerCount, MessageKey> = {
  solo: 'playerCount.solo',
  duo: 'playerCount.duo',
  trio: 'playerCount.trio',
  quad: 'playerCount.quad',
  unknown: 'playerCount.unknown'
}

const REQUIREMENT_KEYS: Record<RequirementEntry['kind'], MessageKey> = {
  'skill-tree': 'requirement.skill-tree',
  timescale: 'requirement.timescale',
  group: 'requirement.group',
  consumable: 'requirement.consumable',
  'tower-xp': 'requirement.tower-xp'
}

const WAVE_SKIP_KEYS: Record<WaveSkipRule['kind'], MessageKey> = {
  'skip-until': 'waveSkip.skip-until',
  conditional: 'waveSkip.conditional',
  never: 'waveSkip.never'
}

export interface IrSummaryProps {
  ir: StrategyIr
  report: ValidationReport | null
  creator: string
  notOwner: boolean
  onCreatorChange: (value: string) => void
  onNotOwnerChange: (value: boolean) => void
}

export function IrSummary({ ir, report, creator, notOwner, onCreatorChange, onNotOwnerChange }: IrSummaryProps): ReactNode {
  const t = useT()
  const shownInventory = ir.inventory.slice(0, INVENTORY_CAP)
  const hasMoreInventory =
    ir.inventory.length >= INVENTORY_CAP &&
    (report?.issues.some((issue) => issue.code === 'inventoryTooLarge') ?? false)

  const waveRange = ir.meta.waveRange
  const pendingModifiers = ir.mutators.filter((mutator) => mutator.matchedBy === 'none')

  return (
    <div className="space-y-4">
      <Card title={t('import.fieldsTitle')}>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <KeyValue label={t('import.field.name')}>{ir.meta.name}</KeyValue>
          <KeyValue label={t('import.field.subtitle')}>{ir.meta.subtitle ?? t('common.none')}</KeyValue>
          <KeyValue label={t('import.field.difficulty')}>{t(DIFFICULTY_KEYS[ir.meta.difficulty])}</KeyValue>
          <KeyValue label={t('import.field.playerCount')}>{t(PLAYER_COUNT_KEYS[ir.meta.playerCount])}</KeyValue>
          <KeyValue label={t('import.field.gameMode')}>
            <Row>
              <span>{ir.meta.gameMode.key || t('common.none')}</span>
              {ir.meta.gameMode.resolved ? null : <Badge tone="warn">{t('import.field.unresolved')}</Badge>}
            </Row>
          </KeyValue>
          <KeyValue label={t('import.field.map')}>
            <Row>
              <span>{ir.meta.map.key ?? ir.meta.map.raw ?? t('common.none')}</span>
              {ir.meta.map.guessConfidence !== undefined ? (
                <Badge tone="neutral">{`${Math.round(ir.meta.map.guessConfidence * 100)}%`}</Badge>
              ) : null}
            </Row>
          </KeyValue>
          <KeyValue label={t('import.field.waveRange')}>
            {waveRange ? `${String(waveRange[0])} – ${String(waveRange[1])}` : t('common.none')}
          </KeyValue>
          <KeyValue label={t('import.field.duration')}>
            {ir.meta.durationMinutes ? t('import.durationMinutes', { count: ir.meta.durationMinutes }) : t('common.none')}
          </KeyValue>
          <KeyValue label={t('import.field.version')}>{ir.meta.versionLabel ?? t('common.none')}</KeyValue>
          <KeyValue label={t('import.field.source')}>{ir.format.source}</KeyValue>
          <KeyValue label={t('import.field.sourceUrl')}>
            {ir.meta.credit.sourceUrl ? (
              <span className="break-all text-xs">{ir.meta.credit.sourceUrl}</span>
            ) : (
              t('common.none')
            )}
          </KeyValue>
          <KeyValue label={t('import.field.tags')}>
            {ir.meta.tags.length > 0 ? ir.meta.tags.join(', ') : t('common.none')}
          </KeyValue>
        </div>
      </Card>

      <Card title={t('import.credit.title')} hint={t('import.credit.warning')}>
        <div className="space-y-3">
          <Field label={t('import.credit.creator')}>
            <input className={INPUT_CLASS} value={creator} onChange={(event) => onCreatorChange(event.target.value)} />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--color-brand)]"
              checked={notOwner}
              onChange={(event) => onNotOwnerChange(event.target.checked)}
            />
            <span>{t('import.credit.notOwner')}</span>
          </label>
          {ir.meta.credit.contributors.length > 0 ? (
            <KeyValue label={t('import.credit.contributors')}>{ir.meta.credit.contributors.join(', ')}</KeyValue>
          ) : null}
          {ir.meta.povVideoUrl ? (
            <KeyValue label={t('import.field.pov')}>
              <span className="break-all text-xs">{ir.meta.povVideoUrl}</span>
            </KeyValue>
          ) : null}
        </div>
      </Card>

      <Card title={t('import.inventory.title')} hint={hasMoreInventory ? t('import.inventoryMax') : undefined}>
        {shownInventory.length >= INVENTORY_CAP ? (
          <p className="mb-2">
            <Badge tone={hasMoreInventory ? 'warn' : 'neutral'}>{t('import.inventoryMax')}</Badge>
          </p>
        ) : null}
        {shownInventory.length === 0 ? (
          <EmptyState title={t('import.inventory.empty')} />
        ) : (
          <ul className="space-y-2">
            {shownInventory.map((slot, index) => (
              <li
                key={`${slot.towerKey}-${String(index)}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel-soft px-3 py-2 text-sm"
              >
                <span className="text-xs text-mute">{String(index + 1)}.</span>
                <span>{slot.rawLabel || humanTowerLabel(slot.towerKey) || slot.towerKey}</span>
                {slot.unresolved ? <Badge tone="warn">{t('import.field.unresolved')}</Badge> : null}
                {slot.count !== undefined ? <Badge>×{String(slot.count)}</Badge> : null}
                {slot.alternatives.length > 0 ? (
                  <span className="text-xs text-mute">{t('import.inventory.alternatives', { value: slot.alternatives.join(', ') })}</span>
                ) : null}
                {slot.notes ? <span className="text-xs text-mute">{slot.notes}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={t('import.modifiers.title')}
        hint={
          pendingModifiers.length > 0
            ? `${t('import.modifiers.pending')} · ${String(pendingModifiers.length)}`
            : undefined
        }
      >
        {ir.mutatorRule?.minCount !== undefined ? (
          <p className="mb-2 text-xs text-mute">{`≥ ${String(ir.mutatorRule.minCount)}`}</p>
        ) : null}
        {ir.mutators.length === 0 ? (
          <EmptyState title={t('import.modifiers.empty')} />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {ir.mutators.map((mutator, index) => (
              <li key={`${mutator.key ?? 'm'}-${String(index)}`}>
                <Badge tone={mutator.matchedBy === 'none' ? 'warn' : 'good'}>
                  {mutator.note || mutator.raw || mutator.key || t('common.none')}
                  {mutator.matchedBy === 'none' ? ` · ${t('import.modifiers.pending')}` : ''}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('import.requirements.title')}>
        {ir.requirements.length === 0 ? (
          <EmptyState title={t('import.requirements.empty')} />
        ) : (
          <ul className="space-y-2 text-sm">
            {ir.requirements.map((requirement, index) => (
              <li key={`${requirement.kind}-${String(index)}`} className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{t(REQUIREMENT_KEYS[requirement.kind])}</Badge>
                <span>{requirement.value}</span>
                {requirement.detail ? <span className="text-xs text-mute">{requirement.detail}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('import.proofs.title')}>
        {ir.proofs.length === 0 ? (
          <EmptyState title={t('import.proofs.empty')} />
        ) : (
          <ul className="space-y-2">
            {ir.proofs.map((proof, index) => (
              <li key={`${proof.label}-${String(index)}`} className="rounded-lg border border-line bg-panel-soft px-3 py-2">
                <p className="text-sm font-medium">{proof.label || t('common.none')}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-mute">
                  {proof.bestTime ? <Badge tone="good">{t('overlay.bestTime', { value: proof.bestTime })}</Badge> : null}
                  {proof.coinsPerHour ? <Badge>{t('import.proofs.coins', { value: proof.coinsPerHour })}</Badge> : null}
                  {proof.xpPerHour ? <Badge>{t('import.proofs.xp', { value: proof.xpPerHour })}</Badge> : null}
                </div>
                {proof.setup.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-mute">
                    {proof.setup.map((line, lineIndex) => (
                      <li key={`${line}-${String(lineIndex)}`}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('import.waveSkip.title')}>
        {ir.waveSkip.length === 0 ? (
          <EmptyState title={t('import.waveSkip.empty')} />
        ) : (
          <ul className="space-y-2 text-sm">
            {ir.waveSkip.map((rule, index) => (
              <li key={`${rule.kind}-${String(index)}`} className="rounded-lg border border-line bg-panel-soft px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{t(WAVE_SKIP_KEYS[rule.kind])}</Badge>
                  {rule.waves ? <span className="text-xs text-mute">{t('import.waveSkip.waves', { value: rule.waves })}</span> : null}
                  {rule.condition ? (
                    <span className="text-xs text-mute">{t('import.waveSkip.condition', { value: rule.condition })}</span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-mute/80">{rule.raw}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('import.troubleshooting.title')}>
        {ir.troubleshooting.length === 0 ? (
          <EmptyState title={t('import.troubleshooting.empty')} />
        ) : (
          <ul className="space-y-2">
            {ir.troubleshooting.map((entry, index) => (
              <li key={`${entry.waves}-${String(index)}`}>
                <p className="text-sm font-medium">{entry.waves}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-mute">
                  {entry.reasons.map((reason, reasonIndex) => (
                    <li key={`${reason}-${String(reasonIndex)}`}>{reason}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
