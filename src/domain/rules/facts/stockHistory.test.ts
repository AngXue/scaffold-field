import { expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, type ScaffoldMember, type Vector3Tuple } from '../../scaffold'
import { calculateSite } from '../../site'
import { SITE_DEMOS } from '../../siteDemos'
import { createPipeAssembly } from '../policies/stock'
import { positionStock } from '../placement'
import { MEMBER_USES, makeUse } from './memberUses'
import { MEMBER_HISTORY, memberBirth } from './memberHistory'
import { STOCK_HISTORY, stockHistoryTransformer, type StockHistory } from './stockHistory'
import { buildEntityGraph } from './entityGraph'

function fixture() {
  const member: ScaffoldMember = { id: 'rail', pathSegment: 0, type: 'guardrail', layer: 1,
    start: [0,2.82,0], end: [3.7,2.82,0], length: 3.7, connectionPoints: [[0,2.82,0],[3.7,2.82,0]],
    [MEMBER_USES]: [makeUse(0,'side-guard',[0,2.82,0],[3.7,2.82,0],'P02')] }
  member[MEMBER_HISTORY] = memberBirth(member)
  const assembly = createPipeAssembly(member, [2], 0)
  return { members: [member], pipeSegments: assembly.segments, connectors: [],
    decks: [{ id: 'right', layer: 1, pathSegment: 0, area: 2.6,
      corners: [[3.7,1.935,-1],[5,1.935,-1],[5,1.935,1],[3.7,1.935,1]] as [Vector3Tuple,Vector3Tuple,Vector3Tuple,Vector3Tuple] }] }
}
it('actual stock assembly keeps one immutable selection and stable piece identities independent of display labels', () => {
  const layout = fixture(), [first, second] = layout.pipeSegments.map(pipe => pipe[STOCK_HISTORY]!)
  expect(first.selection).toBe(second.selection)
  expect(first.selection).toMatchObject({ memberConstructionId: layout.members[0][MEMBER_HISTORY]!.id,
    stockLengths: [2,2], requiredLength: 3.7, effectiveLength: 4, excessLength: 0.3, overlap: 0 })
  expect(first.start).toEqual([-0.15,2.82,0]); expect(second.end).toEqual([3.85,2.82,0])
  expect(first.id).not.toBe(second.id)
  const relabelled = createPipeAssembly({ ...layout.members[0], id: 'different-label' }, [2], 0)
  expect(relabelled.segments.map(pipe => pipe[STOCK_HISTORY]!.id)).toEqual(layout.pipeSegments.map(pipe => pipe[STOCK_HISTORY]!.id))
  const changed = createPipeAssembly(layout.members[0], [4], 0)
  expect(changed.segments[0][STOCK_HISTORY]!.selection.id).not.toBe(first.selection.id)
  expect(() => { (first.selection.stockLengths as number[])[0] = 6 }).toThrow()
  expect(() => { (first.start as Vector3Tuple)[0] = 20 }).toThrow()
})
it('successive real transition and walkway moves preserve both previous poses and the original purchased sequence', () => {
  const layout = fixture(), births = layout.pipeSegments.map(pipe => pipe[STOCK_HISTORY]!), before = JSON.stringify(births)
  positionStock(layout, { transitions: [[0,[{ axis: 0, boundary: -0.05, roof: 3.5, station: 0, towardRoof: -1, wall: true }]]],
    cells: [], obstacles: [], radius: 0.024, walkway: true })
  const transition = layout.pipeSegments.map(pipe => pipe[STOCK_HISTORY]!)
  expect(transition.every(node => node.rule === 'S04' && node.reason === 'transition')).toBe(true)
  expect(transition[0].start[0]).toBeCloseTo(-0.024,8)
  expect(transition.map(node => node.parent!.id)).toEqual(births.map(node => node.id))
  positionStock(layout, { transitions: [], cells: [], obstacles: [], radius: 0.024, walkway: true })
  const final = layout.pipeSegments.map(pipe => pipe[STOCK_HISTORY]!)
  expect(final.every(node => node.rule === 'P08' && node.reason === 'walkway')).toBe(true)
  expect(final[1].end[0]).toBeCloseTo(3.7,8)
  for (const [i,node] of final.entries()) {
    expect(node.parent!.id).toBe(transition[i].id)
    expect(node.parent!.parent!.id).toBe(births[i].id)
    expect(node.selection.id).toBe(births[i].selection.id)
    expect(node.stockLength).toBe(2)
    expect(node.start).toEqual(layout.pipeSegments[i].start)
    expect(node.end).toEqual(layout.pipeSegments[i].end)
  }
  const ids = final.map(node => node.id)
  positionStock(layout, { transitions: [], cells: [], obstacles: [], radius: 0.024, walkway: false })
  expect(layout.pipeSegments.map(pipe => pipe[STOCK_HISTORY]!.id)).toEqual(ids)
  expect(JSON.stringify(births)).toBe(before)
})
it('world projection moves every stock pose together without changing the selected stock or semantic identity', () => {
  const layout = fixture(), root = layout.pipeSegments[0][STOCK_HISTORY]!
  positionStock(layout, { transitions: [], cells: [], obstacles: [], radius: 0.024, walkway: true })
  const final = layout.pipeSegments[0][STOCK_HISTORY]!, original = JSON.stringify(final)
  const move = ([x,y,z]: Readonly<Vector3Tuple>): Vector3Tuple => [8-z,y+3.5,x-2]
  const transform = stockHistoryTransformer(move)
  const projected = transform(layout.pipeSegments[0])[STOCK_HISTORY]!
  expect(projected.id).toBe(final.id)
  expect(projected.selection).toBe(final.selection)
  expect(projected.start).toEqual(move(final.start))
  expect(projected.parent!.start).toEqual(move(root.start))
  expect(projected.parent).toBe(transform({[STOCK_HISTORY]: final.parent})[STOCK_HISTORY])
  expect(JSON.stringify(final)).toBe(original)
})
it('physical graph rejects stock histories with missing demand roots, cyclic moves or conflicting reused identities', () => {
  const demo = SITE_DEMOS.find(demo => demo.id === 'roof-single') ?? SITE_DEMOS[0]
  const layout = calculateSite(demo.site, DEFAULT_PARAMETERS), pipe = layout.pipeSegments[0], history = pipe[STOCK_HISTORY]!
  expect(history).toBeDefined()
  const corrupt = (node: StockHistory) => ({...layout, pipeSegments: [{...pipe, [STOCK_HISTORY]: node}, ...layout.pipeSegments.slice(1)]})
  expect(() => buildEntityGraph(demo.site, corrupt({...history, selection: {...history.selection, memberConstructionId: 'lost-demand'}}))).toThrow(/matching member ancestor|Dangling lineage|Conflicting stock selection/)
  const cycle = {...history} as { -readonly [K in keyof StockHistory]: StockHistory[K] }; cycle.parent = cycle
  expect(() => buildEntityGraph(demo.site, corrupt(cycle))).toThrow('Cyclic stock history')
  const other = layout.pipeSegments[1]
  expect(() => buildEntityGraph(demo.site, {...layout, pipeSegments: [pipe, {...other, [STOCK_HISTORY]: {...history, start: [100,200,300]}}, ...layout.pipeSegments.slice(2)]})).toThrow('Conflicting stock history')
})
