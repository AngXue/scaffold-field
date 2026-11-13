import { expect, it } from 'vitest'
import { DEFAULT_PARAMETERS } from '../../scaffold'
import { calculateSite } from '../../site'
import { SITE_DEMOS } from '../../siteDemos'
import { resolveTopology } from '../topology'
import { alignStationGrid } from '../policies/topology'
import { MEMBER_HISTORY, type MemberHistory } from './memberHistory'
import { buildEntityGraph } from './entityGraph'
import { STATION_TRACK, stationProjection } from './stations'
it('station history records each accepted corner alignment before the next anchor changes it', () => {
  const input: [number,number][] = [[0,0],[4,0]], anchors = [[1.4,1.5]]
  const segment = alignStationGrid(input,DEFAULT_PARAMETERS,anchors,'frame')[0]
  const track = segment[STATION_TRACK]!, nodes = new Map(track.versions.map(node => [node.id,node]))
  expect(segment.stations).toEqual([0,1.5,8/3,4])
  for (const row of [0,1]) {
    const head = track.heads[row][1], middle = nodes.get(head.parentIds[0])!, original = nodes.get(middle.parentIds[0])!
    expect([original.point,middle.point,head.point]).toEqual([[1.333,0,row*0.75],[1.4,0,row*0.75],[1.5,0,row*0.75]])
    expect(original.operation).toBe('grid'); expect(middle.operation).toBe('align'); expect(head.reason).toBe('corner-anchor')
    expect(Object.isFrozen(original.point)).toBe(true)
  }
  expect(input).toEqual([[0,0],[4,0]]); expect(anchors).toEqual([[1.4,1.5]])
})
it('station decisions retain both transition end pairs while recording ordinary inside-corner omissions', () => {
  const points: [number,number][] = [[0,0],[3.6,0],[3.6,3.6]]
  const normal = resolveTopology(points,DEFAULT_PARAMETERS,false,3,[],'normal').stationPlan!
  const required = resolveTopology(points,DEFAULT_PARAMETERS,false,3,[[false,true],[true,false]],'required').stationPlan!
  const node = (plan: typeof normal,id:string) => plan.versions.find(node => node.id===id)!
  expect(normal.versions.filter(node => node.operation==='omit')).toHaveLength(2)
  for (const [segment,station] of [[0,2],[1,0]]) {
    expect(node(normal,normal.heads[segment][1][station])).toMatchObject({operation:'omit',reason:'shared-corner'})
    expect(node(required,required.heads[segment][1][station])).toMatchObject({operation:'keep',reason:'transition-pair'})
    expect(node(normal,normal.heads[segment][0][station]).operation).toBe('keep')
  }
  expect(normal.cornerIds).toHaveLength(1)
  expect(node(normal,normal.cornerIds[0])).toMatchObject({operation:'corner',point:[2.85,0,0.75],origins:[{pathSegment:0},{pathSegment:1}]})
})
it('station projection preserves all omitted ancestors and shares one transformed plan across post demands', () => {
  const plan = resolveTopology([[0,0],[3.6,0],[3.6,3.6]],DEFAULT_PARAMETERS,false,3,[],'roof').stationPlan!
  const project = stationProjection(([x,y,z]) => [10-z,y+3.5,x], origin => ({pathSegment:origin.pathSegment+2,sectionId:`S${origin.pathSegment}`,spanId:`roof${origin.pathSegment}`}))
  const a = project({plan,ids:[plan.heads[0][0][0]]}), b=project({plan,ids:[plan.heads[1][0][1]]})
  expect(a.plan).toBe(b.plan); expect(a.plan.id).toBe(plan.id)
  expect(a.plan.versions.every(node => node.point[1]===3.5)).toBe(true)
  expect(a.plan.versions.filter(node=>node.operation==='omit')).toHaveLength(2)
  expect(a.plan.versions[0].point).toEqual([10,3.5,0])
  expect(a.plan.versions[0].origins).toEqual([{pathSegment:2,sectionId:'S0',spanId:'roof0'}])
  expect(plan.versions[0].point).toEqual([0,0,0]); expect(Object.isFrozen(a.plan.versions[0].point)).toBe(true)
})
it('station identities are deterministic and isolate separate authored frame scopes', () => {
  const get = (scope:string) => resolveTopology([[0,0],[3.6,0]],DEFAULT_PARAMETERS,false,3,[],scope).stationPlan!
  const a=get('A'), b=get('B')
  expect(get('A')).toEqual(a)
  expect(new Set(a.versions.map(node=>node.id)).size).toBe(a.versions.length)
  expect(b.versions.some(node=>a.versions.some(other=>other.id===node.id))).toBe(false)
})
it('explanation rejects omitted supports, altered station positions and missing station ancestors', () => {
  const demo=SITE_DEMOS[0], layout=calculateSite(demo.site,DEFAULT_PARAMETERS)
  const all = (head:MemberHistory): MemberHistory[] => [head,...head.parents.flatMap(all)]
  const member=layout.members.find(member=>member.type==='post')!, root=all(member[MEMBER_HISTORY]!).find(node=>node.station)!
  const binding=root.station!, station=binding.plan.versions.find(node=>node.id===binding.ids[0])!
  const corrupt = (change:Partial<typeof station>) => {
    const history:MemberHistory={...root, station:{...binding,plan:{...binding.plan,versions:binding.plan.versions.map(node=>node.id===station.id?{...node,...change}:node)}}}
    return {...layout,members:layout.members.map(item=>item===member?{...item,[MEMBER_HISTORY]:history}:item)}
  }
  expect(()=>buildEntityGraph(demo.site,corrupt({operation:'omit'}))).toThrow('Invalid post station')
  expect(()=>buildEntityGraph(demo.site,corrupt({point:[1000,0,0]}))).toThrow('Post differs from its station')
  expect(()=>buildEntityGraph(demo.site,corrupt({parentIds:['missing']}))).toThrow('Dangling station ancestor')
  expect(()=>buildEntityGraph(demo.site,corrupt({parentIds:[station.id]}))).toThrow(/cycle|Cyclic/i)
})
