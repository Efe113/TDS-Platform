import { z } from 'zod'

export const DIFFICULTY_VALUES = ['easy', 'medium', 'hard', 'nightmare'] as const
export const PLAYER_COUNT_VALUES = ['solo', 'duo', 'trio', 'quad', 'unknown'] as const

export const STEP_ACTION_VALUES = [
  'place',
  'upgrade',
  'max',
  'sell',
  'change',
  'use',
  'skip',
  'wait',
  'note',
  'raw'
] as const

export const REQUIREMENT_KINDS = [
  'skill-tree',
  'timescale',
  'group',
  'consumable',
  'tower-xp'
] as const

export const IMPORT_SOURCE_VALUES = [
  'gdocs-md',
  'gdocs-docx',
  'docx-upload',
  'paste',
  'manual'
] as const

const softEnum = <T extends readonly string[]>(values: T, fallback: T[number]) =>
  z
    .string()
    .transform((input, ctx): T[number] => {
      const normalized = input.trim().toLowerCase().replace(/[\s-]+/g, '-')
      const exact = values.find((value) => value === normalized)
      if (exact) return exact
      const prefixed = values.find((value) => normalized.startsWith(value))
      if (prefixed) return prefixed
      ctx.addIssue({
        code: 'custom',
        message: `unrecognized value "${input}"`,
        input
      })
      return fallback
    })
    .meta({ id: `softEnum:${values.join('|')}` })

export const difficultySchema = softEnum(DIFFICULTY_VALUES, 'medium')
export const playerCountSchema = softEnum(PLAYER_COUNT_VALUES, 'unknown')
export const stepActionSchema = z.enum(STEP_ACTION_VALUES)

export const softString = z.string().trim().min(1)

export const towerAliasSchema = z.object({
  key: softString,
  label: z.string().optional(),
  raw: z.string(),
  resolved: z.boolean()
})

export const inventorySlotSchema = z.object({
  towerKey: softString,
  rawLabel: z.string().default(''),
  alternatives: z.array(z.string()).default([]),
  count: z.number().int().positive().optional(),
  notes: z.string().optional(),
  unresolved: z.boolean().default(false)
})

export const stepSchema = z.object({
  stepNo: z.number().int().positive(),
  waveFrom: z.number().int().nonnegative().optional(),
  waveTo: z.number().int().nonnegative().optional(),
  phase: z.string().optional(),
  action: stepActionSchema,
  towerKey: z.string().optional(),
  level: z.number().int().positive().optional(),
  count: z.number().int().positive().optional(),
  /**
   * How long the instruction runs for ("Hold 45s", "wait 1 dk"). Deliberately not `count`: three
   * towers and forty-five seconds must not collide in one number, and the overlay can only count a
   * duration down if it is a duration.
   */
  seconds: z.number().int().positive().max(3600).optional(),
  /** How many times the same instruction repeats ("×3", "2 kere", "repeat 4"). */
  repeat: z.number().int().positive().max(99).optional(),
  /**
   * The branch this step sits behind: "if the boss walks left", "eğer buff aldıysan". A run is not a
   * list, it is a tree, and until now the only place a condition could live was inside `raw`.
   */
  condition: z.string().optional(),
  alternatives: z.array(z.string()).default([]),
  spec: z.string().optional(),
  note: z.string().optional(),
  raw: z.string(),
  unresolved: z.boolean().default(false)
})

export const mutatorSchema = z.object({
  key: z.string().optional(),
  matchedBy: z.enum(['phash', 'manual', 'text', 'none']).default('none'),
  confidence: z.number().min(0).max(1).optional(),
  note: z.string().optional(),
  raw: z.string().default(''),
  /**
   * The image reference an icon-only modifier came from. It is deliberately not folded into `raw`,
   * because publish falls back to `raw` for the note and the document id would then show up as a
   * modifier label on the detail page.
   */
  mediaRef: z.string().optional()
})

export const requirementSchema = z.object({
  kind: z.enum(REQUIREMENT_KINDS),
  value: z.string(),
  detail: z.string().optional()
})

export const waveSkipRuleSchema = z.object({
  kind: z.enum(['skip-until', 'conditional', 'never']),
  waves: z.string().optional(),
  condition: z.string().optional(),
  raw: z.string().default('')
})

export const proofSchema = z.object({
  label: z.string().default(''),
  setup: z.array(z.string()).default([]),
  bestTime: z.string().optional(),
  coinsPerHour: z.string().optional(),
  xpPerHour: z.string().optional(),
  mediaRefs: z.array(z.string()).default([])
})

export const hallOfFameEntrySchema = z.object({
  comp: z.array(z.string()).default([]),
  bestTime: z.string().optional(),
  notes: z.string().optional(),
  mediaRefs: z.array(z.string()).default([])
})

export const troubleshootingSchema = z.object({
  waves: z.string(),
  reasons: z.array(z.string()).default([])
})

export const mediaRefSchema = z.object({
  id: z.string(),
  kind: z.enum(['map', 'thumb', 'card', 'tower-icon', 'modifier', 'proof', 'unknown']).default('unknown'),
  storagePath: z.string().optional(),
  dataUrl: z.string().optional(),
  byteLength: z.number().int().nonnegative().optional(),
  sha256: z.string().optional(),
  phash: z.string().optional(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
  rowHint: z.string().optional()
})

export const strategyIrSchema = z
  .object({
    formatVersion: z.literal('tds.strategy.ir/v1').default('tds.strategy.ir/v1'),
    format: z.object({
      source: z.enum(IMPORT_SOURCE_VALUES),
      sourceUrl: z.string().optional(),
      docId: z.string().optional(),
      rawSha256: z.string().optional(),
      unmapped: z
        .array(z.object({ path: z.string(), sample: z.string(), reason: z.string().optional() }))
        .default([])
    }),
    meta: z.object({
      name: softString,
      subtitle: z.string().optional(),
      description: z.string().optional(),
      difficulty: difficultySchema,
      gameMode: z.object({ key: z.string(), raw: z.string(), resolved: z.boolean() }),
      playerCount: playerCountSchema,
      map: z
        .object({
          key: z.string().optional(),
          raw: z.string().optional(),
          guessConfidence: z.number().min(0).max(1).optional(),
          imageRef: z.string().optional()
        })
        .default({}),
      event: z
        .object({
          isEvent: z.boolean().default(false),
          eventKey: z.string().optional(),
          evidence: z.string().optional()
        })
        .default({ isEvent: false }),
      waveRange: z.tuple([z.number().int(), z.number().int()]).optional(),
      durationMinutes: z.number().positive().optional(),
      credit: z
        .object({
          creator: z.string().default(''),
          contributors: z.array(z.string()).default([]),
          sourceUrl: z.string().optional(),
          license: z.string().optional(),
          isAuthorOwn: z.boolean().default(false)
        })
        .default({ creator: '', contributors: [], isAuthorOwn: false }),
      povVideoUrl: z.string().optional(),
      versionLabel: z.string().optional(),
      tags: z.array(z.string()).default([])
    }),
    requirements: z.array(requirementSchema).default([]),
    inventory: z.array(inventorySlotSchema).max(5, 'at most five towers per strategy'),
    mutators: z.array(mutatorSchema).default([]),
    mutatorRule: z.object({ minCount: z.number().int().optional(), note: z.string().optional() }).optional(),
    placement: z
      .object({
        imageRef: z.string().optional(),
        items: z
          .array(
            z.object({
              towerKey: z.string().optional(),
              x: z.number().min(0).max(1).optional(),
              y: z.number().min(0).max(1).optional(),
              zone: z.string().optional(),
              label: z.string().optional()
            })
          )
          .default([])
      })
      .default({ items: [] }),
    waveSkip: z.array(waveSkipRuleSchema).default([]),
    steps: z.array(stepSchema).min(1, 'a strategy needs at least one step'),
    troubleshooting: z.array(troubleshootingSchema).default([]),
    proofs: z.array(proofSchema).default([]),
    hallOfFame: z.array(hallOfFameEntrySchema).default([]),
    notes: z.array(z.string()).default([]),
    media: z.array(mediaRefSchema).default([])
  })
  .meta({ id: 'tds.strategy.ir/v1' })

export type Difficulty = z.infer<typeof difficultySchema>
export type PlayerCount = z.infer<typeof playerCountSchema>
export type StepAction = z.infer<typeof stepActionSchema>
export type StrategyStep = z.infer<typeof stepSchema>
export type InventorySlot = z.infer<typeof inventorySlotSchema>
export type MutatorEntry = z.infer<typeof mutatorSchema>
export type RequirementEntry = z.infer<typeof requirementSchema>
export type WaveSkipRule = z.infer<typeof waveSkipRuleSchema>
export type ProofEntry = z.infer<typeof proofSchema>
export type HallOfFameEntry = z.infer<typeof hallOfFameEntrySchema>
export type TroubleshootingEntry = z.infer<typeof troubleshootingSchema>
export type MediaRef = z.infer<typeof mediaRefSchema>
export type StrategyIr = z.infer<typeof strategyIrSchema>
