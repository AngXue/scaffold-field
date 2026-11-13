import { expect, it } from 'vitest'
import { startConstruction, type ConstructionPhase } from './construction'
import { startScaffoldPlan, prepareScaffoldPlan, DEFAULT_PARAMETERS } from '../scaffold'
import { calculateSite, EMPTY_SITE } from '../site'
import { SITE_DEMOS } from '../siteDemos'
import { CALCULATION_TRACE, calculationSession, type DiagnosticTrace } from './diagnostics/session'

it('constructor barriers do not publish a future draft or replay a completed stage', () => {
  const calls: number[] = []
  function* build(): Generator<ConstructionPhase, { value: number }, void> {
    yield 2; calls.push(2)
    yield 3; calls.push(3)
    yield 4; calls.push(4)
    yield 5; calls.push(5)
    return { value: 10 }
  }
  const staged = startConstruction(build())
  expect(calls).toEqual([])
  expect(staged.advance(3)).toBeUndefined()
  expect(calls).toEqual([2, 3])
  expect(staged.advance(3)).toBeUndefined()
  expect(() => staged.advance(2)).toThrow('backwards')
  expect(staged.finish()).toEqual({ value: 10 })
  expect(staged.finish()).toEqual({ value: 10 })
  expect(calls).toEqual([2, 3, 4, 5])
})
it('failed constructors cannot resume or publish a partial product', () => {
  function* build(): Generator<ConstructionPhase, { value: number }, void> {
    yield 2
    yield 3
    throw new Error('missing support')
  }
  const staged = startConstruction(build())
  expect(staged.advance(2)).toBeUndefined()
  expect(() => staged.advance(3)).toThrow('missing support')
  expect(() => staged.finish()).toThrow('rejected')
})
it('a constructor cannot hide a backwards or repeated phase inside a forward advance', () => {
  for (const repeated of [2, 3] as const) {
    function* build(): Generator<ConstructionPhase, void, void> { yield 2; yield 3; yield repeated }
    const staged = startConstruction(build())
    expect(() => staged.finish()).toThrow('repeated or reversed')
    expect(() => staged.finish()).toThrow('rejected')
  }
})
const local = new Map<string, number>([
  ...['V04.path', 'V04.bands', 'G03.grid', 'G08.corners', 'G03.align', 'G09.retain'].map(id => [id, 2] as const),
  ...['M02.heights', 'P01.courses', 'M01.rows', 'M03.rows', 'P02.boundaries', 'G08.sharedPosts', 'M05.panels', 'M06.coverage', 'M04.sweep', 'M03.workingBands', 'M07.baseCandidates'].map(id => [id, 3] as const),
  ...['S01.supportPreview', 'S03.initialPosts'].map(id => [id, 4] as const),
  ...['P07.supportedCourses', 'P02.ranges', 'P03.inwardRanges'].map(id => [id, 5] as const),
])
function expectBarriers(trace: DiagnosticTrace[], count: number) {
  const steps = trace.filter(event => local.has(event.step))
  for (const id of local.keys()) expect(steps.filter(event => event.step === id), id).toHaveLength(count)
  const coordinated = new Set([...local.keys(), 'M07.supportingBases', 'G08.componentPosts', 'M07.componentBases', 'M06.componentCoverage',
    'S02.inventory', 'S03.repair', 'S01.posts'])
  const phases = trace.filter(event => coordinated.has(event.step)).map(event => event.phase)
  expect(phases).toEqual([...phases].sort((a, b) => a - b))
  expect(trace.some(event => event.step === 'S01.posts')).toBe(true)
}
it('disconnected paths in a legacy drawing cross local construction barriers together', () => {
  const drawing = { points: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 180, y: 0 }, { id: 'C', x: 500, y: 500 }, { id: 'D', x: 680, y: 500 }],
    segments: [{ id: 'one', start: 'A', end: 'B' }, { id: 'two', start: 'C', end: 'D' }] }
  const before = JSON.stringify(drawing)
  const traced = calculationSession(EMPTY_SITE, DEFAULT_PARAMETERS, () => {
    const staged = startScaffoldPlan(drawing, DEFAULT_PARAMETERS)
    expect(staged.advance(2)).toBeUndefined()
    expect(staged.advance(3)).toBeUndefined()
    expect(staged.advance(4)).toBeUndefined()
    const result = staged.finish()
    expect(result.draft.members.length).toBeGreaterThan(0)
    return calculateSite(EMPTY_SITE, DEFAULT_PARAMETERS)
  }, true)
  expectBarriers(traced[CALCULATION_TRACE]!, 2)
  expect(JSON.stringify(drawing)).toBe(before)
  expect(startScaffoldPlan(drawing, DEFAULT_PARAMETERS).finish().draft).toEqual(prepareScaffoldPlan(drawing, DEFAULT_PARAMETERS).draft)
})
it.each(['corridor', 'adjacent-houses'])('%s: all physical frames finish local station and demand stages before any frame advances', id => {
  const demo = SITE_DEMOS.find(demo => demo.id === id)!
  const before = JSON.stringify(demo)
  const result = calculateSite(demo.site, demo.parameters, { trace: true })
  const trace = result[CALCULATION_TRACE]!
  const count = trace.filter(event => event.step === 'G03.grid').length
  expect(count).toBeGreaterThan(1)
  expectBarriers(trace, count)
  expect(JSON.stringify(result)).toBe(JSON.stringify(calculateSite(demo.site, demo.parameters)))
  expect(JSON.stringify(demo)).toBe(before)
})
