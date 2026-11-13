import { describe, expect, it } from 'vitest'
import { validateRuleRelations } from './relations'
import { compilePipeline } from './pipeline'
import type { RuleDefinition, RuleRelation, RuleStep, Proposal } from './contracts'

type Facts = { result: number }
type Change = Proposal & { kind: 'value'; target: 'result'; value: number }
const first: RuleStep<Facts, Change> = { id: 'A.write', ruleId: 'A', phase: 1, after: [], reads: [], kinds: ['value'], targets: ['result'],
  evaluate: (_, revision) => ({ status: 'proposed', proposals: [{ kind: 'value', target: 'result', value: 1, expectedRevision: revision }] }) }
const second: RuleStep<Facts, Change> = { ...first, id: 'B.write', ruleId: 'B', after: [first.id] }
const rules = (relation: RuleRelation): RuleDefinition[] => [
  { id: 'A', revision: 1, title: 'first', status: 'active', implementation: 'native', source: ['test'], cases: ['test'], relations: [] },
  { id: 'B', revision: 1, title: 'second', status: 'active', implementation: 'native', source: ['test'], cases: ['test'], relations: [relation] },
]
const prerequisite: RuleRelation = { id: 'B/needs-A', target: 'A', kind: 'requires', condition: 'active', reason: 'read first result', cases: ['test'],
  bindings: [{ step: second.id, after: first.id }] }
const exception: RuleRelation = { ...prerequisite, id: 'B/only-two', kind: 'exceptionOf', condition: 'only-two', targets: ['result'],
  invariants: ['No input changes.'], confirmation: ['approved test contract'], fallback: 'reject' }
const override: RuleStep<Facts, Change> = { ...second, refines: [{ step: first.id, relationId: exception.id, condition: exception.condition,
  targets: ['result'], when: (next, previous) => next.value === 2 && previous.value === 1 }],
  evaluate: (_, revision) => ({ status: 'proposed', proposals: [{ kind: 'value', target: 'result', value: 2, expectedRevision: revision }] }) }

describe('business relation contracts', () => {
  it('requires real rule ownership and execution edges, not just a plausible name', () => {
    expect(() => validateRuleRelations(rules(prerequisite), [first, second], true)).not.toThrow()
    expect(() => validateRuleRelations(rules({ ...prerequisite, target: 'missing' }), [first, second], true)).toThrow('invalid')
    expect(() => validateRuleRelations(rules({ ...prerequisite, target: 'B' }), [first, second], true)).toThrow('binding')
    expect(() => validateRuleRelations(rules(prerequisite), [first, { ...second, after: [] }], true)).toThrow('binding')
    const inactive = rules(prerequisite); inactive[0].status = 'draft'
    expect(() => validateRuleRelations(inactive, [first, second], true)).toThrow('inactive')
  })
  it('audits all package bindings and rejects unregistered cross-rule dependencies', () => {
    expect(() => validateRuleRelations(rules(prerequisite), [], false)).not.toThrow()
    expect(() => validateRuleRelations(rules(prerequisite), [], true)).toThrow('binding')
    const undeclared = rules(prerequisite); undeclared[1].relations = []
    expect(() => validateRuleRelations(undeclared, [first, second], true)).toThrow('unregistered business prerequisite')
    expect(() => validateRuleRelations(rules(exception), [first, second], true)).toThrow('executable predicate')
  })
  it('rejects mutually enabled incompatible rules without inventing a priority', () => {
    const pair = rules({ id: 'B/excludes-A', target: 'A', kind: 'incompatibleWith', condition: 'active', reason: 'exclusive rule sets', cases: ['test'] })
    expect(() => validateRuleRelations(pair, [], true)).toThrow('incompatible active')
    pair[0].status = 'retired'
    expect(() => validateRuleRelations(pair, [], true)).not.toThrow()
  })
  it('requires confirmation, invariants, effect scope and a safe fallback for exceptions', () => {
    for (const patch of [{ confirmation: [] }, { invariants: [] }, { targets: [] }, { condition: '' }])
      expect(() => validateRuleRelations(rules({ ...exception, ...patch }), [first, override], true)).toThrow('incomplete refinement')
    expect(() => validateRuleRelations(rules({ ...exception, fallback: 'overwrite' } as unknown as RuleRelation), [first, override], true)).toThrow('incomplete refinement')
    const duplicate = rules(exception); duplicate[1].relations = [exception, exception]
    expect(() => validateRuleRelations(duplicate, [first, override], true)).toThrow('duplicate')
  })
  it('binds an exception to its named typed predicate and declared target', () => {
    expect(() => validateRuleRelations(rules(exception), [first, override], true)).not.toThrow()
    for (const patch of [{ condition: 'anything' }, { relationId: 'unregistered' }, { targets: [] }, { step: 'missing' }]) {
      const altered = { ...override, refines: [{ ...override.refines![0], ...patch }] }
      expect(() => validateRuleRelations(rules(exception), [first, altered], true)).toThrow('refinement predicate')
    }
    const widened = { ...exception, targets: ['other'] } as RuleRelation
    expect(() => validateRuleRelations(rules(widened), [first, override], true)).toThrow('refinement predicate')
  })
  it('only grants permission when the predicate accepts; metadata never authorizes a write by itself', () => {
    const run = (step: typeof override) => compilePipeline(rules(exception), [first, step], (_, proposals) => ({ result: proposals.at(-1)!.value }))
    const result = run(override)({ result: 0 }, { trace: true })
    expect(result.facts.result).toBe(2)
    expect(result.trace.at(-1)?.appliedRelations).toEqual(['B/only-two'])
    expect(() => run({ ...override, refines: undefined })({ result: 0 })).toThrow('conflicting proposals')
    expect(() => run({ ...override, refines: [{ ...override.refines![0], when: () => false }] })({ result: 0 })).toThrow('conflicting proposals')
    const same = run({ ...override, evaluate: first.evaluate })({ result: 0 }, { trace: true })
    expect(same.trace.at(-1)?.appliedRelations).toBeUndefined()
  })
})
