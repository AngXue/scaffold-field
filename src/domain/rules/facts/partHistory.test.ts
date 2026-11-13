import { expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, type BaseChannel, type DeckPanel, type ScaffoldMember } from '../../scaffold'
import { calculateSite } from '../../site'
import { SITE_DEMOS } from '../../siteDemos'
import { componentDeckCoverage, uniqueComponentBases } from '../policies/components'
import { resolveDeckCoverage } from '../policies/decks'
import { resolveSupportingBases } from '../bases'
import { historyOf } from './memberHistory'
import { PART_HISTORY, partBirth, partHistory, partChanged, removedParts, mapParts, partProjection, type PartHistory } from './partHistory'
import { buildEntityGraph } from './entityGraph'
function panel(id: string, x: number, pathSegment: number, y = 2): DeckPanel {
  const part: DeckPanel = { id, corners: [[x,y,0],[x+1,y,0],[x+1,y,1],[x,y,1]], area: 1, layer: y, pathSegment }
  part[PART_HISTORY] = partBirth(part, `frame-${pathSegment}`)
  return part
}
function beam(id: string, start: number, end: number, pathSegment: number): BaseChannel {
  const part: BaseChannel = {id, start:[start,0,0],end:[end,0,0],length:end-start,pathSegment}
  part[PART_HISTORY] = partBirth(part,`frame-${pathSegment}`,'M07')
  return part
}
const post = (id: string, x: number): ScaffoldMember => ({id,type:'post',start:[x,0,0],end:[x,4,0],length:4,pathSegment:0,connectionPoints:[[x,0,0],[x,4,0]]})
it('deck coverage keeps purchased panels separate from cut faces and retains fully removed origins', () => {
  const input = [panel('A',0,0),panel('B',0.5,1),panel('C',0,2)], before = JSON.stringify(input)
  const result = componentDeckCoverage(input), [a,b] = result.decks, retired = removedParts(result.decks)
  expect(result.decks.map(part => [part.id,part.area])).toEqual([['A',1],['B',0.5]])
  expect(b.coverage).toEqual([[[1,2,0],[1.5,2,0],[1.5,2,1],[1,2,1]]])
  expect(partHistory(b).operation).toBe('coverage')
  expect(partHistory(b).parents[0]).toBe(partHistory(input[1]))
  expect(partHistory(b).inputs).toEqual([partHistory(a)])
  expect(retired).toHaveLength(1)
  expect(retired[0]).toMatchObject({kind:'deck',operation:'remove',reason:'overlap',area:0,faces:[],origins:[{pathSegment:2}]})
  expect(retired[0].parents[0]).toBe(partHistory(input[2]))
  expect(JSON.stringify(input)).toBe(before)
  expect(input.every(part => part.area === 1)).toBe(true)
  expect(() => { retired[0].parents[0].points[0][0] = 10 }).toThrow()
})
it('local coverage templates preserve a separate removal at every real lift', () => {
  const input = [panel('A',0,0,2),panel('B',0,1,2),panel('C',0,0,4),panel('D',0,1,4)]
  const result = resolveDeckCoverage(input,[[0,0],[1,0],[1,1]],false,false)
  expect(result.map(part => part.id)).toEqual(['A','C'])
  expect(removedParts(result).map(node => node.points[0][1]).sort()).toEqual([2,4])
  expect(removedParts(result).every(node => node.operation === 'remove' && node.origins[0].pathSegment === 1)).toBe(true)
  const projected = partProjection(([x,y,z])=>[x+10,y+3.5,z],origin=>origin).list(result,part=>part)
  const removed = removedParts(projected)
  expect(removed[0].inputs).toBe(removed[1].inputs)
  expect(Object.isFrozen(removed[0].inputs)).toBe(true)
  expect(removed[0].inputs.map(node=>node.id)).toEqual(removedParts(result)[0].inputs.map(node=>node.id))
})
it('duplicate bases merge their independent origins without purchasing another beam', () => {
  const a = beam('first',0,1.2,0), b = beam('last',0,1.2,1)
  const result = uniqueComponentBases([a,b])
  expect(result).toHaveLength(1); expect(result[0].id).toBe('last')
  expect(result[0].length).toBe(1.2)
  const history = partHistory(result[0])
  expect(history.operation).toBe('merge'); expect(history.reason).toBe('duplicate')
  expect(history.parents.map(parent => parent.id).sort()).toEqual([partHistory(a).id,partHistory(b).id].sort())
  expect(history.origins.map(origin => origin.pathSegment)).toEqual([0,1])
  expect(partHistory(a).operation).toBe('create'); expect(partHistory(b).operation).toBe('create')
})
it('base removal records actual support coverage and survives even when the kept collection is empty', () => {
  const wide = beam('wide',-0.2,1.2,0), narrow = beam('narrow',0,0.3,1), posts = [post('A',0),post('B',0.75)]
  const result = resolveSupportingBases([wide,narrow],posts)
  expect(result.map(part => part.id)).toEqual(['wide'])
  expect(partHistory(result[0]).supportIds).toEqual(posts.map(historyOf).map(node => node.id).sort())
  const retired = removedParts(result)[0]
  expect(retired.reason).toBe('covered-support')
  expect(retired.parents[0].id).toBe(partHistory(narrow).id)
  expect(retired.inputs[0].id).toBe(partHistory(wide).id)
  expect(retired.supportIds).toEqual([historyOf(posts[0]).id])
  const empty = resolveSupportingBases([wide,narrow],[])
  expect(empty).toHaveLength(0); expect(JSON.stringify(empty)).toBe('[]')
  expect(removedParts(mapParts(empty,part => ({...part})))).toHaveLength(2)
  expect(removedParts(empty).every(node => node.reason === 'unsupported' && node.inputs.length === 0)).toBe(true)
  const moved = partProjection(([x,y,z]) => [x+5,y+3.5,z], origin => ({...origin,pathSegment:origin.pathSegment+2})).list(empty,part => part)
  expect(moved).toHaveLength(0)
  expect(removedParts(moved).map(node => node.points[0])).toEqual([[5,3.5,0],[4.8,3.5,0]])
})
it('part projection carries live, clipped and deleted geometry with shared immutable ancestors', () => {
  const parts = componentDeckCoverage([panel('A',0,0),panel('B',0.5,1),panel('C',0,2)]).decks
  const projection = partProjection(([x,y,z]) => [10-z,y+3.5,x-2], origin => ({pathSegment:origin.pathSegment+3,sectionId:`S${origin.pathSegment}`,spanId:`roof-${origin.pathSegment}`}))
  const projected = projection.list(parts,part => part)
  const a = partHistory(projected[0]), b = partHistory(projected[1]), removed = removedParts(projected)[0]
  expect(b.inputs[0]).toBe(a)
  expect(removed.inputs[0]).toBe(a)
  expect(a.id).toBe(partHistory(parts[0]).id)
  expect(a.points[0]).toEqual([10,5.5,-2])
  expect(removed.points[0]).toEqual([10,5.5,-2])
  expect(removed.origins).toEqual([{pathSegment:5,sectionId:'S2',spanId:'roof-2'}])
  expect(partHistory(parts[0]).points[0]).toEqual([0,2,0])
})
it('part identities ignore display labels and reject conflicting parents or missing ancestors', () => {
  const a = panel('A',0,0), root = partHistory(a)
  expect(partBirth({...a,id:'other'},'frame-0').id).toBe(root.id)
  expect(partBirth(a,'other-frame').id).not.toBe(root.id)
  expect(() => partChanged(a,[],'M06','coverage')).toThrow('requires a parent')
  expect(() => partChanged(a,[root,{...root,area:100}],'M06','coverage')).toThrow('Conflicting part parent')
})
it('the explanation graph rejects stale part poses, lost supports and cyclic coverage history', () => {
  const demo = SITE_DEMOS[0], layout = calculateSite(demo.site,DEFAULT_PARAMETERS), part = layout.decks[0], root = partHistory(part)
  const corrupt = (history: PartHistory) => ({...layout,decks:[{...part,[PART_HISTORY]:history},...layout.decks.slice(1)]})
  expect(() => buildEntityGraph(demo.site,corrupt({...root,area:999}))).toThrow(/differs from its construction|Conflicting part history/)
  expect(() => buildEntityGraph(demo.site,corrupt({...root,supportIds:['lost-post']}))).toThrow('Dangling part support')
  const cycle = {...root} as {-readonly [K in keyof PartHistory]: PartHistory[K]}; cycle.inputs = [cycle]
  expect(() => buildEntityGraph(demo.site,corrupt(cycle))).toThrow('Cyclic part history')
})
