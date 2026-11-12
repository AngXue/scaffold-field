import { describe, expect, it } from 'vitest'
import { compilePipeline } from './pipeline'
import { RULES } from './catalog'
import type { DeepReadonly, RuleDefinition, RuleStep } from './contracts'

type Facts = { values: number[]; result: number }
type Add = { kind: 'sum'; target: 'result'; expectedRevision: number; value: number }
const definition: RuleDefinition = { id: 'SUM', revision: 1, title: 'sum', status: 'active', implementation: 'native', source: ['test'], cases: ['sum'] }
const step: RuleStep<Facts, Add> = { id: 'SUM.eval', ruleId: 'SUM', phase: 1, after: [], reads: ['values'], kinds: ['sum'], targets: ['result'],
  evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'sum', target: 'result', expectedRevision: revision, value: facts.values!.reduce((a, b) => a + b, 0) }] }) }
const reduce = (facts: DeepReadonly<Facts>, proposals: readonly Add[]): Facts => ({ values: [...facts.values], result: proposals.at(-1)!.value })
const input = () => ({ values: [2, 3], result: 0 })

describe('rule pipeline contracts', () => {
  it('catalog identifies every existing rule without claiming adapter migration complete', () => {
    expect(RULES).toHaveLength(45)
    expect(new Set(RULES.map(r => r.id)).size).toBe(45)
    expect(RULES.filter(r => r.implementation === 'legacy-adapter')).toHaveLength(43)
    expect(RULES.filter(r => r.implementation === 'native').map(r => r.id)).toEqual(['I04', 'I05'])
  })
  it('commits privately, leaves input intact and trace cannot change result', () => {
    const run = compilePipeline([definition], [step], reduce), source = input()
    expect(run(source).facts.result).toBe(5)
    expect(run(source, { trace: true }).facts).toEqual(run(source).facts)
    expect(source).toEqual(input())
    expect(run(source).trace).toEqual([])
    expect(run(source, { trace: true }).trace[0].targets).toEqual(['result'])
  })
  it('rejects duplicate rules, invalid revisions and unknown step ownership', () => {
    expect(() => compilePipeline([definition, definition], [step], reduce)).toThrow('duplicate')
    expect(() => compilePipeline([{ ...definition, revision: 0 }], [step], reduce)).toThrow('invalid')
    expect(() => compilePipeline([], [step], reduce)).toThrow('invalid')
    expect(() => compilePipeline([definition], [step, step], reduce)).toThrow('duplicate')
  })
  it('does not run draft/retired rules and rejects their use as active dependencies', () => {
    for (const status of ['draft', 'retired'] as const) {
      expect(compilePipeline([{ ...definition, status }], [step], reduce)(input()).facts).toEqual(input())
      expect(() => compilePipeline([{ ...definition, status }, { ...definition, id: 'B' }], [step,
        { ...step, id: 'B.eval', ruleId: 'B', after: [step.id] }], reduce)).toThrow('inactive')
    }
  })
  it('rejects absent, cyclic and backwards dependencies', () => {
    expect(() => compilePipeline([definition], [{ ...step, after: ['missing'] }], reduce)).toThrow('missing')
    expect(() => compilePipeline([definition], [{ ...step, after: [step.id] }], reduce)).toThrow('cyclic')
    expect(() => compilePipeline([definition], [{ ...step, after: ['later'] }, { ...step, id: 'later', phase: 2 }], reduce)).toThrow('later')
  })
  it('resolves forward dependencies even with reversed registration', () => {
    const next: RuleStep<Facts, Add> = { ...step, id: 'next', reads: ['result'], after: [step.id],
      refines: [{ step: step.id, targets: ['result'], reason: 'add one to sum', caseId: 'forward', when: next => next.value === 6 }],
      evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'sum', target: 'result', expectedRevision: revision, value: facts.result! + 1 }] }) }
    expect(compilePipeline([definition], [next, step], reduce)(input()).facts.result).toBe(6)
    expect(() => compilePipeline([definition], [next, step], reduce)({ values: [4, 5], result: 0 })).toThrow('conflicting')
    expect(() => compilePipeline([definition], [{ ...next, refines: undefined }, step], reduce)(input())).toThrow('conflicting')
  })
  it('deduplicates identical writes, rejects competing writes without committing', () => {
    expect(compilePipeline([definition], [step, { ...step, id: 'same' }], reduce)(input()).facts.result).toBe(5)
    const conflict: RuleStep<Facts, Add> = { ...step, id: 'conflict', evaluate: (_, revision) => ({ status: 'proposed', proposals: [{ kind: 'sum', target: 'result', expectedRevision: revision, value: 99 }] }) }
    const source = input()
    expect(() => compilePipeline([definition], [step, conflict], reduce)(source)).toThrow('conflicting')
    expect(source).toEqual(input())
  })
  it('blocks nested mutations and exposes only declared inputs', () => {
    const mutate: RuleStep<Facts, Add> = { ...step, evaluate: facts => {
      expect(facts.result).toBeUndefined()
      ;(facts.values as number[]).push(9)
      return { status: 'not-applicable', reason: 'unreachable' }
    } }
    expect(() => compilePipeline([definition], [mutate], reduce)(input())).toThrow()
  })
  it('rejects stale proposals and unauthorized proposal kinds', () => {
    expect(() => compilePipeline([definition], [{ ...step, kinds: [] }], reduce)(input())).toThrow('unauthorized')
    expect(() => compilePipeline([definition], [{ ...step, evaluate: () => ({ status: 'proposed', proposals: [{ kind: 'sum' as const, target: 'result' as const, expectedRevision: 99, value: 5 }] }) }], reduce)(input())).toThrow('stale')
  })
  it('preserves not-applicable reasons and propagates rejection without touching input', () => {
    const skipped: RuleStep<Facts, Add> = { ...step, evaluate: () => ({ status: 'not-applicable', reason: 'no-deck' }) }
    expect(compilePipeline([definition], [skipped], reduce)(input(), { trace: true }).trace[0].reason).toBe('no-deck')
    const source = input()
    expect(() => compilePipeline([definition], [{ ...step, evaluate: () => ({ status: 'rejected', reason: 'missing-support' }) }], reduce)(source)).toThrow('missing-support')
    expect(source).toEqual(input())
  })
})
