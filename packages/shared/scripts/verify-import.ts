import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildStrategyIr } from '../src/import/build-ir'
import type { StrategyIr } from '../src/ir/strategy-ir'

const FIXTURE = join(process.cwd(), 'packages', 'shared', 'test', 'fixtures', 'teehee_01.md')

const FORBIDDEN = ['totalCost', 'enemyRoster', 'enemies', 'cost', 'waveCost']

function keysOf(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((entry, index) => keysOf(entry, `${path}[${index}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => [...keysOf(entry, `${path}.${key}`), key])
  }
  return []
}

const failures: string[] = []
const check = (label: string, condition: boolean, detail?: unknown): void => {
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures.push(label)
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`)
}

const markdown = readFileSync(FIXTURE, 'utf8')
const result = buildStrategyIr({
  markdown,
  source: 'gdocs-md',
  sourceUrl: 'https://docs.google.com/document/d/1ZW3vM8qrDyfPkrf6kcFZqwFrzbgKdH8U_nQhZVVlFSg/edit'
})

const ir = result.ir as StrategyIr | null

console.log('--- fixture summary ---')
console.log('title:', ir?.meta.name, '| subtitle:', ir?.meta.subtitle)
console.log('creator:', ir?.meta.credit.creator, '| contributors:', ir?.meta.credit.contributors)
console.log('difficulty:', ir?.meta.difficulty, '| playerCount:', ir?.meta.playerCount, '| gameMode:', ir?.meta.gameMode)
console.log('inventory:', (ir?.inventory ?? []).map((slot) => `${slot.towerKey}${slot.alternatives.length ? `|alt:${slot.alternatives.join(',')}` : ''}${slot.unresolved ? ' (UNRESOLVED)' : ''}`))
console.log('steps:', ir?.steps.length ?? 0)
for (const step of (ir?.steps ?? []).slice(0, 10)) {
  console.log(`  #${step.stepNo} w${step.waveFrom ?? '-'}-${step.waveTo ?? '-'} ${step.action} ${step.towerKey ?? ''} lv${step.level ?? ''} x${step.count ?? ''} ${step.spec ? `[${step.spec}]` : ''} :: ${step.raw.slice(0, 70)}`)
}
console.log('requirements:', (ir?.requirements ?? []).map((entry) => `${entry.kind}=${entry.value}`))
console.log('waveSkip:', ir?.waveSkip)
console.log('mutators:', ir?.mutators.length, '| minCount:', ir?.mutatorRule?.minCount)
console.log('proofs:', (ir?.proofs ?? []).map((proof) => `${proof.label} @ ${proof.bestTime ?? '?'}`))
console.log('hof:', ir?.hallOfFame.length, '| troubleshooting:', ir?.troubleshooting.length)
console.log('placement:', ir?.placement.imageRef, '| waveRange:', ir?.meta.waveRange)
console.log('stats:', result.report.stats)
console.log('report issues:', result.report.issues.map((issue) => `${issue.level}:${issue.code}`))

console.log('--- assertions ---')
check('ir validates', ir !== null, result.report.errors)
check('title parsed', ir?.meta.name === 'Teehee')
check('subtitle parsed', /grind/i.test(ir?.meta.subtitle ?? ''))
check('creator captured', (ir?.meta.credit.creator ?? '').includes('myuuuu'))
check('contributors captured', (ir?.meta.credit.contributors ?? []).join(' ').includes('yunwanjia2027'))
check('exactly five towers', (ir?.inventory ?? []).length === 5, ir?.inventory)
check('tower keys resolved', (ir?.inventory ?? []).map((slot) => slot.towerKey).join(',') === 'operator,shotgunner,commander,dj-booth,juggernaut', (ir?.inventory ?? []).map((slot) => slot.towerKey))
check('no unresolved towers', (ir?.inventory ?? []).every((slot) => !slot.unresolved))
check('alternatives captured', (ir?.inventory ?? []).some((slot) => slot.alternatives.includes('executioner')), (ir?.inventory ?? []).map((slot) => slot.alternatives))
check('many steps produced', (ir?.steps ?? []).length >= 10, ir?.steps.length)
check('steps are unique-numbered', new Set((ir?.steps ?? []).map((step) => step.stepNo)).size === (ir?.steps ?? []).length)
check('max action present', (ir?.steps ?? []).some((step) => step.action === 'max'))
check('upgrade action present', (ir?.steps ?? []).some((step) => step.action === 'upgrade'))
check('spec parsed (Green Track)', (ir?.steps ?? []).some((step) => (step.spec ?? '').includes('Green Track')))
check('wave 21 context present', (ir?.steps ?? []).some((step) => step.waveFrom === 21))
check('no escape leftovers', (ir?.steps ?? []).every((step) => !/\\\w/.test(step.raw)))
check('skill-tree requirement', (ir?.requirements ?? []).some((entry) => entry.kind === 'skill-tree' && entry.value === 'not-needed'), ir?.requirements)
check('tower-xp requirements', (ir?.requirements ?? []).filter((entry) => entry.kind === 'tower-xp').map((entry) => entry.value).join(',').includes('juggernaut'))
check('group requirement', (ir?.requirements ?? []).some((entry) => entry.kind === 'group'))
check('timescale requirement', (ir?.requirements ?? []).some((entry) => entry.kind === 'timescale'))
check('wave range 1-40', JSON.stringify(ir?.meta.waveRange ?? []) === '[1,40]', ir?.meta.waveRange)
check('modifiers found', (ir?.mutators ?? []).length >= 6, ir?.mutators.length)
check('min modifier rule', ir?.mutatorRule?.minCount === 5)
check('placement image kept', Boolean(ir?.placement.imageRef))
check('proofs kept', (ir?.proofs ?? []).length > 0 && (ir?.proofs ?? []).some((proof) => Boolean(proof.bestTime)))
check('event confirmation requested', result.report.issues.some((issue) => issue.code === 'eventConfirmationNeeded'))
check('map key requested', result.report.issues.some((issue) => issue.code === 'mapKeyMissing'))
check('19 images seen', result.report.stats.images === 19, result.report.stats.images)
check('no forbidden keys', keysOf(ir).every((key) => !FORBIDDEN.includes(key)), keysOf(ir).filter((key) => FORBIDDEN.includes(key)))

const unrecognised = buildStrategyIr({ markdown: 'plain prose\nsecond line', source: 'paste' })
check('unrecognised doc errors instead of throwing', unrecognised.ir === null && unrecognised.report.errors.some((issue) => issue.code === 'noSteps'))

for (const sample of ['', '|', '| |\n| |', '### \n* ', '[][][]:<>', '# \n| a | b |\n| --- | --- |\n| 1 | 2 |']) {
  try {
    buildStrategyIr({ markdown: sample, source: 'paste' })
  } catch (error) {
    check(`fuzzy input survived: ${JSON.stringify(sample)}`, false, String(error))
  }
}

console.log(failures.length === 0 ? '\nALL CHECKS PASSED' : `\n${failures.length} FAILURE(S):\n- ${failures.join('\n- ')}`)
process.exit(failures.length === 0 ? 0 : 1)
