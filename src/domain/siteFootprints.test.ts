import { describe, expect, it } from 'vitest'
import { footprintCells, footprintContains, footprintFromOutline, footprintSupportsSegment, reshapeFootprint } from './siteFootprints'
import { calculateSite, GROUND, readSite, resolveBlocks, type Site, type SitePoint } from './site'
import { DEFAULT_PARAMETERS } from './scaffold'
import { siteWallEdges } from './siteRouting'

const points = (coords: number[][]): SitePoint[] => coords.map(([x, z]) => ({ x, z }))
const lShape = points([[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]])
const shape = footprintFromOutline(lShape)!
const block = { ...shape, id: 'B1', parentId: GROUND, height: 3.5 }
const scene: Site = { blocks: [block], guides: [], sections: [] }

describe('closed orthogonal house footprints', () => {
  it('keeps the concave boundary and its actual area instead of filling the bounding box', () => {
    expect(shape).toMatchObject({ x: 0, z: 0, width: 6, depth: 6, outline: lShape })
    expect(footprintCells(shape).reduce((sum, cell) => sum + cell.width * cell.depth, 0)).toBe(20)
    expect(footprintContains(shape, { x: 3, z: 3, width: 1, depth: 1 })).toBe(false)
    expect(footprintFromOutline([...lShape, lShape[0]])).toEqual(shape)
    expect(footprintCells(footprintFromOutline([...lShape].reverse())!).reduce((sum, c) => sum + c.width * c.depth, 0)).toBe(20)
  })

  it('rejects diagonal edges and crossing or open boundaries', () => {
    expect(footprintFromOutline(points([[0, 0], [3, 1], [3, 3], [0, 3]]))).toBeUndefined()
    expect(footprintFromOutline(points([[0, 0], [4, 0], [4, 4], [2, 4], [2, -1], [0, -1]]))).toBeUndefined()
    expect(footprintFromOutline(lShape.slice(0, -1))).toBeUndefined()
  })

  it('checks support across a U-shaped notch even when both endpoints are on the roof', () => {
    const u = footprintFromOutline(points([[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6]]))!
    expect(footprintSupportsSegment(u, { x: 1, z: 4 }, { x: 5, z: 4 })).toBe(false)
    expect(footprintSupportsSegment(u, { x: 1, z: 1 }, { x: 5, z: 1 })).toBe(true)
  })

  it('allows a separate block in the notch and checks the actual parent top for stacking', () => {
    const child = { id: 'B2', parentId: GROUND, x: 3, z: 3, width: 1, depth: 1, height: 1 }
    expect(resolveBlocks({ ...scene, blocks: [block, child] }).issues).toEqual([])
    expect(resolveBlocks({ ...scene, blocks: [block, { ...child, parentId: 'B1' }] }).issues).toHaveLength(1)
    expect(resolveBlocks({ ...scene, blocks: [block, { ...child, x: 0.5, parentId: 'B1' }] }).blocks[1].top).toBe(4.5)
  })

  it('scales and moves every outline vertex and preserves it in the scene file', () => {
    const moved = reshapeFootprint(block, { x: -3, z: 4, width: 12 })
    expect(moved.outline?.[3]).toEqual({ x: 1, z: 6 })
    const restored = readSite(JSON.parse(JSON.stringify({ ...scene, blocks: [{ ...block, ...moved }] })))!
    expect(restored.blocks[0].outline).toEqual(moved.outline)
    expect(siteWallEdges(resolveBlocks(scene).blocks)).toHaveLength(6)
    expect(siteWallEdges(resolveBlocks(scene).blocks)).toContainEqual({ axis: 'x', at: 2, low: 2, high: 6, outward: 1 })
  })

  it('checks house penetration and roof footing using the true footprint', () => {
    const section = { id: 'S1', surfaceId: GROUND, layers: 1, start: { x: 3, z: 3 }, end: { x: 5, z: 3 } }
    expect(calculateSite({ ...scene, sections: [section] }, DEFAULT_PARAMETERS).canExportMaterials).toBe(true)
    expect(calculateSite({ ...scene, sections: [{ ...section, surfaceId: 'B1' }] }, DEFAULT_PARAMETERS).canExportMaterials).toBe(false)
    const onRoof = { ...section, surfaceId: 'B1', start: { x: 1, z: 0.5 }, end: { x: 3, z: 0.5 } }
    expect(calculateSite({ ...scene, sections: [onRoof] }, DEFAULT_PARAMETERS).canExportMaterials).toBe(true)
  })

  it('routes only across the filled leg of a concave roof', () => {
    const section = { id: 'S1', surfaceId: GROUND, automatic: true, layers: 5, start: { x: -2, z: 3 }, end: { x: 8, z: 3 } }
    const layout = calculateSite({ ...scene, sections: [section] }, DEFAULT_PARAMETERS)
    expect(layout.canExportMaterials).toBe(true)
    expect(layout.spans?.map(span => span.line.surfaceId)).toEqual([GROUND, 'B1', GROUND])
  })
})
