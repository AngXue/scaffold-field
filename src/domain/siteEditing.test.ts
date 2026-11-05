import fixtureText from '../../docs/fixtures/user-adjacent-houses.json?raw'
import { describe, expect, it } from 'vitest'
import { closeAlongHouse, outerHouseLoops, scaffoldAroundHouses, splitSectionRange } from './siteEditing'
import { calculateSite, readSite, siteLength, type Site } from './site'
import { footprintCells, footprintFromOutline } from './siteFootprints'
const fixture = JSON.parse(fixtureText)
const site = fixture.scene as Site

describe('attached houses and scaffold editing', () => {
  it('closes B2 using the two existing B1 wall edges', () => {
    const result = closeAlongHouse(site.blocks[1].outline!.slice(0,5), [site.blocks[0]])!
    expect(result).toBeDefined()
    expect(result.outline).toHaveLength(6)
    expect(footprintCells(result).reduce((sum,c)=>sum+c.width*c.depth,0)).toBeCloseTo(105.75,6)
  })
  it('traces the outer 81.4 m boundary without the shared walls', () => {
    const loops=outerHouseLoops(site.blocks)
    expect(loops).toHaveLength(1)
    expect(loops[0]).toHaveLength(14)
    const result=scaffoldAroundHouses({...site,sections:[]},4)
    expect(result.sections.reduce((s,line)=>s+siteLength(line),0)).toBeCloseTo(81.4,6)
    expect(new Set(result.sections.map(s=>s.groupId)).size).toBe(1)
    expect(scaffoldAroundHouses(result,4).sections).toEqual(result.sections)
    expect(readSite(JSON.parse(JSON.stringify(result)))?.sections).toEqual(result.sections)
  })
  it('splits only the requested range while retaining connection endpoints and group membership', () => {
    const line={id:'S1',surfaceId:'ground',start:{x:0,z:0},end:{x:10,z:0},layers:4,automatic:true,groupId:'围架1'}
    const result=splitSectionRange({blocks:[],guides:[],sections:[line]},line,{x:7,z:.1},{x:3,z:0})
    expect(result.site.sections.map(siteLength)).toEqual([3,4,3])
    expect(result.site.sections.map(s=>s.groupId)).toEqual(['围架1',undefined,'围架1'])
    expect(result.selected).toBe(result.site.sections[1].id)
    expect(result.site.sections[0].end).toEqual(result.site.sections[1].start)
    expect(result.site.sections[1].end).toEqual(result.site.sections[2].start)
  })
  it('routes the supplied 14-section scene onto both ground and B2 and joins its shared roof corner', () => {
    const result=calculateSite(site,fixture.parameters)
    expect(result.canExportMaterials).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.spans?.filter(s=>s.sourceId==='S1').map(s=>s.line.surfaceId).sort()).toEqual(['B2','ground'])
    const roof=result.spans!.filter(s=>s.line.surfaceId==='B2')
    expect(roof.map(s=>s.sourceId).sort()).toEqual(['S1','S10'])
    expect(roof.every(s=>s.line.layers===2)).toBe(true)
    expect(result.warnings.some(w=>w.id.includes('branch-junction'))).toBe(false)
    const posts=result.members.filter(m=>m.type==='post')
    const shared = posts.filter(m=>Math.hypot(m.start[0]-5.05,m.start[2]+4.1)<0.001 && m.start[1]===0)
    expect(shared).toHaveLength(1)
    for (let i=0;i<posts.length;i++) for(let j=i+1;j<posts.length;j++) if(Math.abs(posts[i].start[1]-posts[j].start[1])<0.001) {
      expect(Math.hypot(posts[i].start[0]-posts[j].start[0],posts[i].start[2]-posts[j].start[2])).toBeGreaterThanOrEqual(0.25)
    }
    expect(new Set(posts.map(m=>m.start.map(v=>v.toFixed(3)).join(','))).size).toBe(posts.length)
  })
})

it('keeps quantities when the complete supplied scene rotates and translates', () => {
  const transform = (p: {x:number;z:number}) => ({x:13-p.z,z:p.x-7})
  const changed = {...site,blocks:site.blocks.map(b=>({...b,...footprintFromOutline(b.outline!.map(transform))!})),sections:site.sections.map(s=>({...s,start:transform(s.start),end:transform(s.end)}))}
  const original=calculateSite(site,fixture.parameters), rotated=calculateSite(changed,fixture.parameters)
  expect(rotated.issues).toEqual([])
  expect(rotated.materials.stockSummary).toEqual(original.materials.stockSummary)
  expect(rotated.materials.connectorSummary).toEqual(original.materials.connectorSummary)
})
it('calculates the generated whole perimeter with one common target', () => {
  const whole=scaffoldAroundHouses({...site,sections:[]},4)
  const result=calculateSite(whole,fixture.parameters)
  expect(result.issues).toEqual([])
  expect(result.canExportMaterials).toBe(true)
})

it('anchors both B2 roof approaches 1.80 m from the connected lower post pairs', () => {
  const result=calculateSite(site,fixture.parameters)
  expect(result.issues).toEqual([])
  const first=result.spans!.find(s=>s.sourceId==='S1' && s.line.surfaceId==='B2')!.line
  const side=result.spans!.find(s=>s.sourceId==='S10' && s.line.surfaceId==='B2')!.line
  expect([first.end.x, first.end.z]).toEqual([6.85,-2.5])
  expect([side.end.x, side.end.z]).toEqual([8.5,-2.5])
  expect([side.start.x, side.start.z]).toEqual([8.5,7.8])
  const posts=result.members.filter(m=>m.type==='post')
  for(const position of [[6.85,4,-2.5],[6.85,4,-3.25],[8.5,4,7.8],[9.25,4,7.8],
    [5.05,0,-2.5],[5.05,0,-3.25],[8.5,0,9.6],[9.25,0,9.6]]) {
    expect(posts.some(m=>m.start.every((v,i)=>Math.abs(v-position[i])<0.001)), `post at ${position}`).toBe(true)
  }
  expect(result.joinedLifts?.filter(j=>j.levels.join(',')==='5.64,7.52')).toHaveLength(2)
})

it.each([[1.5,6.55,8.1],[2,7.05,7.6]])('uses configured %s m spacing for terminal roof approaches', (postSpacing,x,z) => {
  const result=calculateSite(site,{...fixture.parameters,postSpacing})
  expect(result.issues).toEqual([])
  const posts=result.members.filter(m=>m.type==='post')
  for (const position of [[x,4,-2.5],[x,4,-3.25],[8.5,4,z],[9.25,4,z]]) {
    expect(posts.some(m=>m.start.every((v,i)=>Math.abs(v-position[i])<0.001))).toBe(true)
  }
  expect(result.joinedLifts).toHaveLength(2)
})

it.each([1,2])('keeps every S1 upper guard continuous across the height change with %s rail courses', guardrailRailCount => {
  const result=calculateSite(site,{...fixture.parameters,guardrailRailCount})
  expect(result.issues).toEqual([])
  const roof=result.spans!.findIndex(s=>s.sourceId==='S1' && s.line.surfaceId==='B2')
  const rails=result.members.filter(m=>m.type==='guardrail' && m.pathSegment===roof && Math.abs(m.start[2]+3.25)<.001 && Math.abs(m.end[2]+3.25)<.001)
  const heights=[...new Set(rails.map(m=>m.start[1]))]
  expect(heights).toHaveLength(guardrailRailCount*2+1)
  for(const y of heights) {
    const actual=result.members.filter(m=>m.type==='guardrail' && Math.abs(m.start[1]-y)<.001 && Math.abs(m.start[2]+3.25)<.001 && Math.abs(m.end[2]+3.25)<.001)
    const intervals=actual.flatMap(m=>result.pipeSegments.filter(p=>p.memberId===m.id).map(p=>[Math.min(p.start[0],p.end[0]),Math.max(p.start[0],p.end[0])])).sort((a,b)=>a[0]-b[0])
    let end=5.05
    for(const [a,b] of intervals) if(a<=end+.001 && b>end) end=b
    expect(end,`S1 guard continuity at ${y} m`).toBeGreaterThanOrEqual(9.25)
    expect(result.members.some(m=>m.type==='guardrail' && Math.abs(m.start[1]-y)<.001 && Math.abs(m.start[0]-6.85)<.001 && Math.abs(m.end[0]-6.85)<.001)).toBe(false)
    expect(result.members.some(m=>m.type==='guardrail' && Math.abs(m.start[1]-y)<.001
      && Math.abs(m.start[0]-5.05)<.001 && Math.abs(m.end[0]-5.05)<.001
      && Math.min(m.start[2],m.end[2])<=-4.85 && Math.abs(Math.max(m.start[2],m.end[2])+3.25)<.001)).toBe(true)
    expect(result.members.filter(m=>m.type==='post')).toHaveLength(140)
  }
})
