import { RuleFailure, type Proposal, type RuleDefinition, type RuleRelation, type RuleStep } from './contracts.ts'

// Business dependencies bind to execution steps. A business rule may appear on
// both ends of different edges; only the step graph must be acyclic.
const prerequisites: readonly (readonly [string, string, string, string])[] = [
  ['G02', 'G06', 'G02.support', 'G06.clearance'],
  ['G06', 'G01', 'G06.clearance', 'G01.walls'],
  ['I05', 'I03', 'I05.targets', 'I03.resolve'],
  ['G02', 'G05', 'G02.publish', 'G05.anchor'],
  ['G03', 'G08', 'G03.align', 'G08.corners'],
  ['G04', 'G02', 'G04.balance', 'G02.support'],
  ['G05', 'G04', 'G05.anchor', 'G04.balance'],
  ['G08', 'G03', 'G08.corners', 'G03.grid'],
  ['G09', 'G03', 'G09.retain', 'G03.align'],
  ['M03', 'M01', 'M03.rows', 'M01.rows'],
  ['M06', 'M05', 'M06.coverage', 'M05.panels'],
  ['P01', 'M02', 'P01.courses', 'M02.heights'],
  ['S01', 'S03', 'S01.posts', 'S03.repair'],
  ['S01', 'M02', 'S01.supportPreview', 'M02.heights'],
  ['S03', 'G08', 'S03.initialPosts', 'G08.sharedPosts'],
  ['S03', 'S02', 'S03.repair', 'S02.inventory'],
  ['P02', 'M03', 'P02.ranges', 'M03.rows'],
  ['P06', 'P05', 'P06.openCaps', 'P05.links'],
  ['P07', 'S01', 'P07.supportedCourses', 'S01.supportPreview'],
  ['P07', 'P01', 'P07.supportedCourses', 'P01.courses'],
  ['S04', 'P08', 'S04.positionStock', 'P08.walkwayObjective'],
]
export function relationsFor(owner: string, cases: readonly string[]): RuleRelation[] {
  const relations: RuleRelation[] = prerequisites.filter(([rule]) => rule === owner).map(([, target, step, after]) => ({
    id: `${step}/requires/${after}`, kind: 'requires', target, condition: 'active',
    bindings: [{ step, after }], reason: `${step} consumes the committed result of ${after}.`, cases,
  }))
  if (owner === 'P03') relations.push({
    id: 'P03/common-lift-inward', kind: 'exceptionOf', target: 'P02', condition: 'common-lift-inward-range',
    bindings: [{ step: 'P03.inwardRanges', after: 'P02.ranges' }], targets: ['guards'],
    reason: 'Only common-lift inward side guards end at the shared post.',
    invariants: ['Working members and decks retain their geometry.', 'Outward and unmatched-lift guards retain their ranges.'],
    fallback: 'reject', confirmation: ['docs/计算规则.md#5-防护栏杆', 'AGENTS.md#validation'],
    cases: ['P03-common-lift-inward', 'T09', 'T11'],
  })
  return relations
}

/** Validate trusted static contracts at compilation, never on a saved project. */
export function validateRuleRelations<F, P extends Proposal>(definitions: readonly RuleDefinition[], steps: readonly RuleStep<F, P>[], complete = false) {
  const rules = new Map(definitions.map(rule => [rule.id, rule])), registered = new Map(steps.map(step => [step.id, step]))
  const ids = new Set<string>()
  for (const rule of definitions) for (const relation of rule.relations) {
    const target = rules.get(relation.target)
    if (!relation.id || ids.has(relation.id) || !target || !relation.reason || !relation.cases.length)
      throw new RuleFailure(rule.id, 'invalid or duplicate rule relation')
    ids.add(relation.id)
    if (relation.kind === 'incompatibleWith') {
      if (relation.condition !== 'active') throw new RuleFailure(rule.id, 'invalid incompatibility condition')
      if (rule.status === 'active' && target.status === 'active') throw new RuleFailure(rule.id, `incompatible active rule: ${target.id}`)
      continue
    }
    if (rule.status === 'active' && target.status !== 'active') throw new RuleFailure(rule.id, `inactive prerequisite: ${target.id}`)
    if (!relation.bindings.length || (relation.kind === 'requires' && relation.condition !== 'active'))
      throw new RuleFailure(rule.id, 'invalid prerequisite binding')
    if (relation.kind !== 'requires' && (!relation.condition || !relation.targets.length || !relation.invariants.length
      || !relation.confirmation.length || relation.fallback !== 'reject')) throw new RuleFailure(rule.id, 'incomplete refinement contract')
    for (const binding of relation.bindings) {
      const step = registered.get(binding.step), previous = registered.get(binding.after)
      // Each package compiles its own steps; the release audit checks all bindings.
      if (!step && !complete) continue
      if (!step || !previous || step.ruleId !== rule.id || previous.ruleId !== target.id || !step.after.includes(previous.id))
        throw new RuleFailure(rule.id, 'missing or mismatched relation step binding')
    }
  }
  for (const step of steps) {
    const rule = rules.get(step.ruleId)
    if (!rule) throw new RuleFailure(step.id, 'unregistered relation owner')
    for (const refinement of step.refines ?? []) {
      const relation = rule.relations.find(item => item.id === refinement.relationId)
      if (!relation || (relation.kind !== 'refines' && relation.kind !== 'exceptionOf') || relation.condition !== refinement.condition
        || typeof refinement.when !== 'function' || !refinement.targets.length
        || !relation.bindings.some(binding => binding.step === step.id && binding.after === refinement.step)
        || refinement.targets.some(target => !relation.targets.includes(target) || !step.targets.includes(target)))
        throw new RuleFailure(step.id, 'unregistered or mismatched refinement predicate')
    }
    if (complete) for (const after of step.after) {
      if (registered.get(after)?.ruleId === step.ruleId) continue
      if (!rule.relations.some(relation => relation.kind !== 'incompatibleWith'
        && relation.bindings.some(binding => binding.step === step.id && binding.after === after)))
        throw new RuleFailure(step.id, `unregistered business prerequisite: ${after}`)
    }
  }
  if (complete) for (const rule of definitions) for (const relation of rule.relations) {
    if (relation.kind !== 'refines' && relation.kind !== 'exceptionOf') continue
    for (const binding of relation.bindings) if (!registered.get(binding.step)?.refines?.some(refinement => refinement.relationId === relation.id))
      throw new RuleFailure(rule.id, 'refinement has no executable predicate')
  }
}
