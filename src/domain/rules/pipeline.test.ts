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
    expect(RULES.filter(rule => rule.implementation === 'boundary').map(rule => rule.id)).toEqual(['I01', 'O02', 'O03', 'O04'])
    expect(new Set(RULES.map(r => r.id)).size).toBe(45)
    expect(RULES.filter(r => r.implementation === 'legacy-adapter')).toHaveLength(0)
    expect(RULES.filter(r => r.implementation === 'native').map(r => r.id)).toEqual(['I02', 'I03', 'I04', 'I05', 'G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G08', 'G09', 'M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'S01', 'S02', 'S03', 'S04', 'C01', 'C02', 'C03', 'V01', 'V02', 'V03', 'V04', 'O01'])
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


it('preserves and freezes symbol-keyed provenance instead of silently dropping it', () => {
  const origin = Symbol('origin')
  const source = { ...input(), [origin]: { intervals: [1, 2] } }
  const run = compilePipeline([definition], [], (facts: DeepReadonly<typeof source>) => facts as typeof source)
  const result = run(source).facts
  expect(result[origin].intervals).toEqual([1, 2])
  expect(() => (result[origin].intervals as number[]).push(3)).toThrow()
  expect(source[origin].intervals).toEqual([1, 2])
})
it('rejects mutable collection containers instead of offering a false readonly contract', () => {
  const run = compilePipeline([definition], [], (facts: DeepReadonly<{ mutable: Map<string, number> }>) => facts as { mutable: Map<string, number> })
  expect(() => run({ mutable: new Map() })).toThrow('plain objects')
})


it('compares proposal values independent of property order and includes symbol origins', () => {
  const provenance = Symbol('source')
  type FactsWithSource = { result: number; values: number[] }
  type WithSource = Add & { [provenance]?: { id: string } }
  const base: RuleStep<FactsWithSource, WithSource> = { ...step, evaluate: (_, revision) => ({ status: 'proposed', proposals: [
    { kind: 'sum', target: 'result', value: 5, expectedRevision: revision, [provenance]: { id: 'S1' } },
  ] }) }
  const reversed: RuleStep<FactsWithSource, WithSource> = { ...base, id: 'same', evaluate: (_, revision) => ({ status: 'proposed', proposals: [
    { [provenance]: { id: 'S1' }, expectedRevision: revision, value: 5, target: 'result', kind: 'sum' },
  ] }) }
  expect(compilePipeline([definition], [base, reversed], reduce)(input()).facts.result).toBe(5)
  const different: RuleStep<FactsWithSource, WithSource> = { ...reversed, evaluate: (_, revision) => ({ status: 'proposed', proposals: [
    { kind: 'sum', target: 'result', value: 5, expectedRevision: revision, [provenance]: { id: 'S2' } },
  ] }) }
  expect(() => compilePipeline([definition], [base, different], reduce)(input())).toThrow('conflicting')
})
it('development verification and production execution commit identical outputs', () => {
  const strict = compilePipeline([definition], [step], reduce)
  const production = compilePipeline([definition], [step], reduce, { verifyImmutability: false })
  const source = input()
  expect(production(source, { trace: true })).toEqual(strict(source, { trace: true }))
  expect(source).toEqual(input())
})
