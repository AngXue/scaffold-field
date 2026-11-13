/// <reference types="node" />
import { INTERNAL_ID, DISPLAY_ID } from './facts/displayIdentity'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { calculateSite, EMPTY_SITE } from '../site'
import { DEFAULT_PARAMETERS } from '../scaffold'
import { CALCULATION_TRACE, calculationSession } from './diagnostics/session'
import { compilePipeline } from './pipeline'
import type { Phase, RuleDefinition, RuleStep, Proposal } from './contracts'

it('all frozen and large scenes execute globally ordered S0-S9 steps', () => {
  const fixtures = new URL('../../../fixtures/rules/', import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', fixtures), 'utf8'))
  const large = JSON.parse(readFileSync(new URL('performance/manifest.json', fixtures), 'utf8'))
  const ids: string[] = [...manifest.cases, ...large.cases.map((id: string) => 'performance/' + id)]
  expect(ids).toHaveLength(26)
  for (const id of ids) {
    const input = JSON.parse(readFileSync(new URL(id + '.json', fixtures), 'utf8')), before = JSON.stringify(input)
    const result = calculateSite(input.scene, input.parameters, { trace: true })
    const trace = result[CALCULATION_TRACE]!
    expect(trace.length, id).toBeGreaterThan(0)
    expect(trace.map(step => step.phase), id).toEqual(trace.map(step => step.phase).sort((a, b) => a - b))
    expect(trace.filter(step => step.step === 'O01.quantities'), id).toHaveLength(1)
    const at = (step: string) => trace.findIndex(event => event.step === step)
    if (at('P05.workingLinks') >= 0) {
      expect(at('P05.workingLinks'), id).toBeLessThan(at('S01.posts'))
      expect(at('P07.actualPostTops'), id).toBeLessThan(at('P07.supportedCourses'))
    }
    for (const entities of [result.members, result.pipeSegments, result.connectors, result.decks, result.baseChannels]) {
      const native = entities.map(entity => entity[INTERNAL_ID])
      expect(native.every(value => typeof value === 'string' && value.length > 0), id).toBe(true)
      expect(new Set(native).size, id).toBe(entities.length)
      expect(entities.every(entity => entity.id === entity[DISPLAY_ID] && entity.id !== entity[INTERNAL_ID]), id).toBe(true)
    }
    expect(JSON.stringify(input), id).toBe(before)
  }
}, 30000)
const rule: RuleDefinition = { id: 'ORDER', revision: 1, title: 'phase contract', status: 'active', implementation: 'native', source: ['test'], cases: ['test'], relations: [] }
const runStep = (phase: Phase, evaluate = () => {}) => {
  const step: RuleStep<Record<string, never>, Proposal> = { id: `ORDER.${phase}`, ruleId: rule.id, phase, after: [], reads: [], kinds: [], targets: [],
    evaluate: () => { evaluate(); return { status: 'not-applicable', reason: 'contract' } } }
  return compilePipeline([rule], [step], facts => ({ ...facts }))({})
}
it.each([false, true])('ordinary and traced sessions reject backwards stages before evaluation (%s)', trace => {
  let called = false
  expect(() => calculationSession(EMPTY_SITE, DEFAULT_PARAMETERS, () => {
    runStep(5)
    runStep(3, () => { called = true })
    return calculateSite(EMPTY_SITE, DEFAULT_PARAMETERS)
  }, trace)).toThrow('Backwards global phase')
  expect(called).toBe(false)
  expect(calculateSite(EMPTY_SITE, DEFAULT_PARAMETERS).members).toEqual([])
})
it('a caught rule failure cannot be hidden by returning a successful nested calculation', () => {
  expect(() => calculationSession(EMPTY_SITE, DEFAULT_PARAMETERS, () => {
    try { runStep(3, () => { throw new Error('invalid work') }) } catch { /* simulate an accidental caller catch */ }
    return calculateSite(EMPTY_SITE, DEFAULT_PARAMETERS)
  })).toThrow('Cannot publish a rejected calculation')
})

it('a failed input snapshot also prevents a caught error from publishing a nested success', () => {
  type Node = { parent?: Node }
  const node: Node = {}; node.parent = node
  const run = compilePipeline<Node, Proposal>([rule], [], facts => facts as Node)
  expect(() => calculationSession(EMPTY_SITE, DEFAULT_PARAMETERS, () => {
    try { run(node) } catch { /* failed preparation must reject the whole calculation */ }
    return calculateSite(EMPTY_SITE, DEFAULT_PARAMETERS)
  })).toThrow('Cannot publish a rejected calculation')
  expect(calculateSite(EMPTY_SITE, DEFAULT_PARAMETERS).members).toEqual([])
})
