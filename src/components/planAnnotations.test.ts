import { describe, expect, it } from 'vitest'
import fixtureText from '../../docs/fixtures/user-adjacent-houses.json?raw'
import { formatMetres, sectionAnnotationSize, layoutPlanAnnotations, type PlanBlockInput } from './planAnnotations'

const block = (id: string, x: number, z: number, width: number, depth: number, extra: Partial<PlanBlockInput> = {}): PlanBlockInput =>
  ({ id, x, z, width, depth, name: id, ...extra })

describe('plan annotations', () => {
  it('shows every exposed edge of adjacent blocks', () => {
    const result = layoutPlanAnnotations([
      block('B1', 0, 0, 8, 4),
      block('B2', 8, 0, 4, 4),
    ], [], 50)
    const b1 = result.dimensions.filter((item) => item.blockId === 'B1')
    const b2 = result.dimensions.filter((item) => item.blockId === 'B2')
    expect(new Set(b1.map((item) => item.side)).size).toBe(3)
    expect(new Set(b2.map((item) => item.side)).size).toBe(3)
    expect(b1.every((item) => !item.selected)).toBe(true)
  })

  it('shows all four sides of the selected block even when neighbours surround it', () => {
    const result = layoutPlanAnnotations([
      block('B1', 0, 0, 4, 4, { selected: true }),
      block('B2', 4, 0, 4, 4),
      block('B3', 0, 4, 4, 4),
    ], [], 50)
    expect(result.dimensions.filter((item) => item.blockId === 'B1').map((item) => item.side).sort())
      .toEqual(['bottom', 'left', 'right', 'top'])
  })

  it('hides the shared edge of two adjacent rectangles and never shows a covered side', () => {
    const result = layoutPlanAnnotations([
      block('B1', 0, 0, 4, 4),
      block('B2', 4, 0, 4, 4),
    ], [], 50)
    const sides = new Map(result.dimensions.map((item) => [`${item.blockId}:${item.side}`, item]))
    expect(sides.has('B1:right')).toBe(false)
    expect(sides.has('B2:left')).toBe(false)
    expect(sides.has('B1:left')).toBe(true)
    expect(sides.has('B2:right')).toBe(true)
  })

  it('does not label a footprint completely hidden under a stacked block', () => {
    const result = layoutPlanAnnotations([
      block('B1', 0, 0, 6, 4, { base: 0, top: 3 }),
      block('B2', 0, 0, 6, 4, { base: 3, top: 6 }),
    ], [], 50)
    expect(result.dimensions.filter((item) => item.blockId === 'B1')).toHaveLength(0)
    expect(result.dimensions.filter((item) => item.blockId === 'B2')).toHaveLength(4)
  })

  it('still labels an inset upper block and its exposed parent edges', () => {
    const result = layoutPlanAnnotations([
      block('B1', 0, 0, 6, 4, { base: 0, top: 3 }),
      block('B2', 1, 0, 4, 4, { base: 3, top: 4 }),
    ], [], 50)
    expect(result.dimensions.filter((item) => item.blockId === 'B1').length).toBeGreaterThan(0)
    expect(result.dimensions.filter((item) => item.blockId === 'B2').length).toBeGreaterThan(0)
  })

  it('keeps section labels clear of block dimensions and keeps the measured text', () => {
    const result = layoutPlanAnnotations([
      block('B1', 0, 0, 8, 4),
    ], [
      { id: 'S1', start: { x: 0, z: 0 }, end: { x: 8, z: 0 }, text: '第 1 段 · 8.00 m' },
    ], 50)
    expect(result.sectionLabels).toHaveLength(1)
    expect(result.sectionLabels[0].text).toBe('第 1 段 · 8.00 m')
    expect(result.dimensions.length).toBeGreaterThan(0)
  })

  it('formats dimensions to the drawing precision', () => {
    expect(formatMetres(4)).toBe('4.00 m')
    expect(formatMetres(10)).toBe('10.00 m')
    expect(formatMetres(9.4)).toBe('9.40 m')
  })
})

it('labels both exposed remnants of a long wall beside an attached rectangle', () => {
  const result = layoutPlanAnnotations([block('B1', 0, 0, 10, 4), block('B2', 3, -2, 4, 2)], [], 50)
  expect(result.dimensions.filter(d => d.blockId === 'B1' && d.side === 'top').map(d => d.length)).toEqual([3, 3])
})
it('labels all six actual edges of a selected L shape', () => {
  const outline = [[0,0],[6,0],[6,2],[2,2],[2,6],[0,6]].map(([x,z]) => ({x,z}))
  const result = layoutPlanAnnotations([block('B1',0,0,6,6,{outline,selected:true})],[],50)
  expect(result.dimensions.map(d=>d.length)).toEqual([6,2,4,4,2,6])
})

it.each([10,30,80])('keeps every section chip off selected contour dimensions at scale %s', scale => {
  const fixture=JSON.parse(fixtureText)
  for (const selected of ['B1','B2']) {
    const result=layoutPlanAnnotations(fixture.scene.blocks.map((b: PlanBlockInput)=>({...b,name:b.id,selected:b.id===selected})),
      fixture.scene.sections.map((line: {id:string;start:{x:number;z:number};end:{x:number;z:number}},i:number)=>({...line,text:`第 ${i+1} 段`})),scale)
    for(const label of result.sectionLabels) for(const dim of result.dimensions.filter(d=>d.selected)) {
      const size=sectionAnnotationSize(label.text)
      const width=label.vertical?size.height:size.width, height=label.vertical?size.width:size.height
      const dx=(dim.from.x+dim.to.x)/2*scale+dim.normal.x*(dim.offset*scale+10)
      const dy=(dim.from.z+dim.to.z)/2*scale+dim.normal.z*(dim.offset*scale+10)
      const dw=dim.normal.x===0?dim.text.length*6.6+10:15, dh=dim.normal.x===0?15:dim.text.length*6.6+10
      const overlap=Math.abs(label.position.x*scale-dx)<(width+dw)/2 && Math.abs(label.position.z*scale-dy)<(height+dh)/2
      expect(overlap,`${selected} ${dim.key} versus ${label.id}`).toBe(false)
    }
  }
})
