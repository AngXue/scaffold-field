import { expect, it } from 'vitest'
import { calculateScaffold, calculateScaffoldPlan, DEFAULT_PARAMETERS, type DeckPanel, type ScaffoldLayout } from './scaffold'
import { readDrawing } from './plan'
import { fitGuardrailStock } from './guardrails'

const settings = {...DEFAULT_PARAMETERS, layerCount:1, swapInnerOuter:true}
const points = (sign: number) => [{id:'A',x:0,y:0},{id:'B',x:300,y:0},{id:'C',x:300,y:sign*200}]
it('ends inward corner guards at the shared post, keeps the supporting longitudinals full, and moves stock surplus outside', () => {
  const r=calculateScaffold(points(1),[6,4],settings)
  const rails=r.members.filter(m=>m.type==='guardrail' && m.connectionPoints.length>2)
  expect(rails.map(m=>m.length)).toEqual([5.35,5.35,3.35,3.35])
  expect(r.members.filter(m=>m.type==='longitudinal' && m.layer===1).map(m=>m.length)).toEqual([6.2,6.2,6.2,4.2,4.2,4.2])
  for (const rail of rails) {
    const pipes=r.pipeSegments.filter(p=>p.memberId===rail.id)
    if(rail.pathSegment===0) expect(Math.max(...pipes.flatMap(p=>[p.start[0],p.end[0]]))).toBeCloseTo(5.25,3)
    else expect(Math.min(...pipes.flatMap(p=>[p.start[2],p.end[2]]))).toBeCloseTo(.75,3)
    expect(r.connectors.some(c=>c.memberId===rail.id && Math.abs(c.position[0]-5.25)<.05 && Math.abs(c.position[2]-.75)<.05)).toBe(true)
    for(const pipe of pipes) expect(Math.hypot(...pipe.end.map((v,i)=>v-pipe.start[i]))).toBeCloseTo(pipe.stockLength,6)
  }
})
it('keeps outward guard crossings the same length as the outer supporting rails', () => {
  const r=calculateScaffold(points(-1),[6,4],settings)
  for (const index of [0,1]) {
    const longitudinal=r.members.find(m=>m.type==='longitudinal' && m.layer===1 && m.pathSegment===index)!
    const rails=r.members.filter(m=>m.type==='guardrail' && m.pathSegment===index && m.connectionPoints.length>2)
    expect(rails.every(m=>m.length===longitudinal.length)).toBe(true)
  }
})
it('retains end protection above the adjacent face when lift counts differ', () => {
  const r=calculateScaffoldPlan(readDrawing(points(1)),settings,undefined,0,[1,3])
  const rails=r.members.filter(m=>m.type==='guardrail' && m.pathSegment===1 && m.layer===2 && m.connectionPoints.length>2)
  expect(rails).toHaveLength(1)
  expect(rails[0].length).toBe(4.2)
})
const panel = (id: string,a: number,b: number): DeckPanel => ({id,layer:1,pathSegment:1,area:(b-a)*2,
  corners:[[a,1.935,-1],[b,1.935,-1],[b,1.935,1],[a,1.935,1]]})
function stockFixture(decks: DeckPanel[]): Pick<ScaffoldLayout,'members'|'pipeSegments'|'connectors'|'decks'> {
  return {members:[{id:'rail',type:'guardrail',layer:1,start:[0,2.82,0],end:[3.7,2.82,0],length:3.7,connectionPoints:[[0,2.82,0],[3.7,2.82,0]]}],
    pipeSegments:[{id:'p1',memberId:'rail',type:'guardrail',start:[-.15,2.82,0],end:[1.85,2.82,0],stockLength:2,sequence:1,overlapWithPrevious:0},
      {id:'p2',memberId:'rail',type:'guardrail',start:[1.85,2.82,0],end:[3.85,2.82,0],stockLength:2,sequence:2,overlapWithPrevious:0}],
    connectors:[{id:'butt',memberId:'rail',type:'butt',position:[1.85,2.82,0],axis:[1,0,0]}],decks}
}
it('moves both pipes and their butt fitting together without shortening purchased stock', () => {
  const r=stockFixture([panel('right',3.7,5)])
  fitGuardrailStock(r)
  expect(r.pipeSegments[1].end[0]).toBeCloseTo(3.7,6)
  expect(r.pipeSegments[0].start[0]).toBeCloseTo(-.3,6)
  expect(r.connectors[0].position[0]).toBeCloseTo(1.7,6)
  expect(r.pipeSegments.map(p=>p.stockLength)).toEqual([2,2])
})
it('allows unavoidable intrusion at both ends and never cuts or removes the guard', () => {
  const r=stockFixture([panel('left',-1,0),panel('right',3.7,5)])
  fitGuardrailStock(r)
  expect(r.pipeSegments[0].start[0]).toBe(-.15)
  expect(r.pipeSegments[1].end[0]).toBe(3.85)
  expect(r.members[0].length).toBe(3.7)
})
it('does not trade walkway intrusion for a pipe through a house', () => {
  const r=stockFixture([panel('right',3.7,5)])
  fitGuardrailStock(r,[{base:0,top:5,polygon:[[-2,-1],[-.2,-1],[-.2,1],[-2,1]]}],0)
  expect(r.pipeSegments[0].start[0]).toBeGreaterThanOrEqual(-.2)
  expect(r.pipeSegments[1].end[0]).toBeGreaterThan(3.7)
})
