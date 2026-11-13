import { expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, createScaffoldDraft, completeScaffoldDraft, prepareScaffoldAssembly, finishPreparedScaffoldAssembly, assembleScaffoldDraft, calculateScaffold, type ScaffoldMember } from '../scaffold'
import { calculateSite } from '../site'
import { SITE_DEMOS } from '../siteDemos'
import { CALCULATION_TRACE } from './diagnostics/session'
import { assembleStockStage } from './stock'
import { createPipeAssembly } from './policies/stock'
it('construction publishes logical demands without temporary physical stock, fittings or material totals', () => {
  const points = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 180, y: 0 }]
  const draft = createScaffoldDraft(points, [3.6], DEFAULT_PARAMETERS)
  expect(draft.members.length).toBeGreaterThan(0)
  for (const field of ['pipeSegments', 'connectors', 'materials']) expect(draft).not.toHaveProperty(field)
  expect(completeScaffoldDraft(draft)).toEqual(calculateScaffold(points, [3.6], DEFAULT_PARAMETERS))
})
it.each(['roof', 'corridor', 'aligned', 'stack'])('the entire %s scene publishes exactly one final contribution ledger', id => {
  const demo = SITE_DEMOS.find(demo => demo.id === id)!
  expect(demo).toBeDefined()
  const layout = calculateSite(demo.site, demo.parameters, { trace: true })
  expect(layout[CALCULATION_TRACE]!.filter(event => event.step === 'O01.quantities')).toHaveLength(1)
  expect(layout[CALCULATION_TRACE]!.filter(event => event.step === 'C03.unknown')).toHaveLength(1)
})
it('fixed uprights reuse their committed stock and reject stale sequences or moved bearing points', () => {
  const post: ScaffoldMember = { id: 'P', type: 'post', start: [0, 0, 0], end: [0, 9.7, 0], length: 9.7, connectionPoints: [] }
  const assembly = createPipeAssembly(post, [6, 4], 0, [6, 4])
  const result = assembleStockStage([post], { P: [6, 4] }, DEFAULT_PARAMETERS, true, [assembly])
  expect(result.assemblies[0].segments).toEqual(assembly.segments)
  expect(result.assemblies[0].plan).toEqual(assembly.plan)
  expect(() => assembleStockStage([post], { P: [4, 6] }, DEFAULT_PARAMETERS, true, [assembly])).toThrow('logical demand')
  const displaced = structuredClone(assembly); displaced.segments[0].start[0] += 0.2
  expect(() => assembleStockStage([post], { P: [6, 4] }, DEFAULT_PARAMETERS, true, [displaced])).toThrow('geometry')
})

it('physical assembly consumes a frozen logical draft without changing or appending to it', () => {
  const draft = createScaffoldDraft([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 180, y: 0 }], [3.6], DEFAULT_PARAMETERS)
  const before = JSON.stringify(draft)
  const freeze = (value: unknown) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
    for (const key of Reflect.ownKeys(value)) freeze(Reflect.get(value, key))
    Object.freeze(value)
  }
  freeze(draft)
  const layout = completeScaffoldDraft(draft)
  expect(layout.pipeSegments.length).toBeGreaterThan(0)
  expect(JSON.stringify(draft)).toBe(before)
})

it('settles corridor connections before selecting horizontal stock and measures only final physical entities', () => {
  const demo = SITE_DEMOS.find(demo => demo.id === 'corridor')!
  const layout = calculateSite(demo.site, demo.parameters, { trace: true })
  const events = layout[CALCULATION_TRACE]!
  const at = (step: string) => events.findIndex(event => event.step === step && event.status === 'proposed')
  expect(events.filter(event => event.step === 'S01.horizontals')).toHaveLength(1)
  expect(at('S01.horizontals')).toBeGreaterThan(at('P06.openCaps'))
  expect(at('P06.openCaps')).toBeGreaterThan(at('P07.actualPostTops'))
  expect(at('V01.physicalSupport')).toBeGreaterThan(events.findLastIndex(event => event.step === 'S04.positionStock'))
  expect(at('O01.quantities')).toBeGreaterThan(at('V03.bridgeCollisions'))
  expect(layout.canExportMaterials).toBe(true)
  expect(layout.baseChannels).toHaveLength(14)
  expect(layout.decks).toHaveLength(119)
})


it('completes an unchanged frozen assembly scope without rebuilding its logical members', () => {
  const draft = createScaffoldDraft([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 180, y: 0 }, { id: 'c', x: 180, y: 270 }], [3.6, 5.4], DEFAULT_PARAMETERS)
  const prepared = prepareScaffoldAssembly(draft)
  const freeze = (value: unknown) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
    for (const key of Reflect.ownKeys(value)) freeze(Reflect.get(value, key))
    Object.freeze(value)
  }
  freeze(prepared)
  const expected = assembleScaffoldDraft(prepared.draft, true, prepared.posts)
  expect(finishPreparedScaffoldAssembly(prepared)).toEqual(expected)
  const output = finishPreparedScaffoldAssembly(prepared)
  output.pipeSegments[0].start[0] += 2
  expect(finishPreparedScaffoldAssembly(prepared)).toEqual(expected)
})

it.each(['roof', 'corridor', 'aligned', 'adjacent-houses'])('%s commits every fitting after the last stock placement and before physical validation', id => {
  const demo = SITE_DEMOS.find(demo => demo.id === id)!
  const layout = calculateSite(demo.site, demo.parameters, { trace: true }), events = layout[CALCULATION_TRACE]!
  const lastPlacement = events.findLastIndex(event => event.step === 'S04.positionStock')
  const connections = events.map((event, index) => ['C01.actual', 'C02.splices'].includes(event.step) ? index : -1).filter(index => index >= 0)
  expect(connections).toHaveLength(2)
  expect(Math.min(...connections)).toBeGreaterThan(lastPlacement)
  expect(events.findIndex(event => event.step === 'V01.physicalSupport')).toBeGreaterThan(Math.max(...connections))
  expect(events.findIndex(event => event.step === 'O01.quantities')).toBeGreaterThan(Math.max(...connections))
  expect(layout).not.toHaveProperty('fittingPlans')
})
