import { describe, expect, it } from 'vitest'
import { GRID_SIZE, snapPlanPoint, orthogonalEnd, addPlanSegment, EMPTY_DRAWING, measureDrawing, drawingPaths, deletePlanSegment, readDrawing, resizeDrawingSegment, movePlanNode, insertPathSegment, measurePath, PIXELS_PER_METER, resizePathSegment } from './plan'

const points = [
  { id: 'P1', x: 100, y: 100 },
  { id: 'P2', x: 100 + 7.2 * PIXELS_PER_METER, y: 100 },
  { id: 'P3', x: 100 + 7.2 * PIXELS_PER_METER, y: 100 + 4.8 * PIXELS_PER_METER },
]

describe('plan geometry', () => {
  it('uses one consistent canvas scale for every measured segment', () => {
    expect(measurePath(points)).toEqual([7.2, 4.8])
  })

  it('resizes one segment while preserving downstream segment geometry', () => {
    const resized = resizePathSegment(points, 0, 5.8)

    expect(measurePath(resized)).toEqual([5.8, 4.8])
    expect(resized[2].x - resized[1].x).toBe(0)
  })

  it('inserts a short segment after the selected one without moving the outline', () => {
    const inserted = insertPathSegment(points, 0, 0.5)
    const lengths = measurePath(inserted)

    // P1 -> P2 -> new -> P3: the new node sits 0.5 m down the LEG THAT FOLLOWS the
    // selected segment, so the outline through P2 is unchanged.
    expect(inserted.map((point) => point.id)).toEqual(['P1', 'P2', 'P4', 'P3'])
    expect(lengths).toEqual([7.2, 0.5, 4.3])
    expect(lengths[1] + lengths[2]).toBeCloseTo(4.8, 2)
    // Ids stay unique however often a segment is inserted.
    expect(new Set(insertPathSegment(inserted, 1, 0.5).map((point) => point.id)).size).toBe(5)
  })

  it('inserts on the other side too, hanging off the selected segment\'s start', () => {
    // Inserting BEFORE the middle segment hangs the new node off the leg that
    // precedes it, so the outline through (200, 0) does not move either.
    const before = insertPathSegment(points, 1, 0.5, 'before')
    const lengths = measurePath(before)

    expect(before.map((point) => point.id)).toEqual(['P1', 'P4', 'P2', 'P3'])
    expect(lengths).toEqual([6.7, 0.5, 4.8])
    expect(lengths[0] + lengths[1]).toBeCloseTo(7.2, 2)
  })

  it('grows the path at its start, back along the selected segment', () => {
    const extended = insertPathSegment(points, 0, 0.5, 'before')

    // Nothing precedes the first segment, so the path grows straight back.
    expect(measurePath(extended)).toEqual([0.5, 7.2, 4.8])
    expect(extended[0].y).toBe(extended[1].y)
    expect(extended[0].x).toBeLessThan(extended[1].x)
  })

  it('grows the path at its end along the selected segment', () => {
    const extended = insertPathSegment(points, 1, 0.5)

    // No following node, so the new node continues the selected segment's own
    // direction: +y, another 0.5 m.
    expect(measurePath(extended)).toEqual([7.2, 4.8, 0.5])
    expect(extended[3].x).toBe(extended[2].x)
  })

  it('never overshoots the node it is inserted before', () => {
    // A 0.3 m leg cannot take a 0.5 m insertion: the new node is held at the halfway
    // point, so it never passes the node it aims at.
    const short = [
      { id: 'P1', x: 0, y: 0 },
      { id: 'P2', x: 200, y: 0 },
      { id: 'P3', x: 200, y: 0.3 * PIXELS_PER_METER },
    ]
    const lengths = measurePath(insertPathSegment(short, 0, 0.5))

    expect(lengths[1]).toBeLessThan(0.3)
    expect(lengths[1]).toBeLessThanOrEqual(0.5)
    expect(lengths[1] + lengths[2]).toBeCloseTo(0.3, 2)
  })
})
// Direct drawing uses explicit edges, including multiple disconnected runs.
describe('free orthogonal drawing', () => {
  it('snaps to a 0.1 m lattice even at negative coordinates', () => {
    expect(GRID_SIZE).toBe(5)
    expect(snapPlanPoint({ x: 13, y: -14 })).toEqual({ x: 15, y: -15 })
    expect(orthogonalEnd({ x: 10, y: 20 }, { x: 98, y: 41 })).toEqual({ x: 100, y: 20 })
    expect(orthogonalEnd({ x: 10, y: 20 }, { x: 31, y: -98 })).toEqual({ x: 10, y: -100 })
    expect(orthogonalEnd({ x: 10, y: 20 }, { x: 31, y: -98 }, false)).toEqual({ x: 10, y: -98 })
  })

  it('never inserts a connection between independent strokes', () => {
    const first = addPlanSegment(EMPTY_DRAWING, { x: 0, y: 0 }, { x: 100, y: 0 })
    const second = addPlanSegment(first, { x: 400, y: 300 }, { x: 400, y: 450 })
    expect(measureDrawing(second)).toEqual([2, 3])
    expect(drawingPaths(second).map(path => measurePath(path.points))).toEqual([[2], [3]])
    expect(deletePlanSegment(second, first.segments[0].id).points).toHaveLength(2)
  })

  it('joins coincident endpoints regardless of stroke order and removes retracing', () => {
    let drawing = addPlanSegment(EMPTY_DRAWING, { x: 100, y: 0 }, { x: 100, y: 100 })
    drawing = addPlanSegment(drawing, { x: 0, y: 0 }, { x: 100, y: 0 })
    const duplicate = addPlanSegment(drawing, { x: 100, y: 100 }, { x: 100, y: 0 })
    expect(duplicate.points).toHaveLength(3)
    expect(duplicate.segments).toHaveLength(2)
    expect(drawingPaths(duplicate)).toHaveLength(1)
  })

  it('splits an edge at a T endpoint without double-counting overlaps', () => {
    let drawing = addPlanSegment(EMPTY_DRAWING, { x: 0, y: 0 }, { x: 200, y: 0 })
    drawing = addPlanSegment(drawing, { x: 100, y: 0 }, { x: 100, y: 100 })
    expect(drawing.points).toHaveLength(4)
    expect(measureDrawing(drawing)).toEqual([2, 2, 2])
    expect(drawingPaths(drawing)).toHaveLength(3)
    drawing = addPlanSegment(drawing, { x: 50, y: 0 }, { x: 150, y: 0 })
    expect(measureDrawing(drawing).reduce((a, b) => a + b, 0)).toBe(6)
  })

  it('resizes a rectangle without breaking shared corners or creating diagonal edges', () => {
    const drawing = readDrawing([
      { id: 'a', x: 0, y: 0 }, { id: 'b', x: 200, y: 0 }, { id: 'c', x: 200, y: 100 },
      { id: 'd', x: 0, y: 100 }, { id: 'e', x: 0, y: 0 },
    ])
    const resized = resizeDrawingSegment(drawing, drawing.segments[0].id, 3.5)
    expect(measureDrawing(resized)).toEqual([3.5, 2, 3.5, 2])
    expect(resized.points).toHaveLength(4)
    const paths = drawingPaths(resized)
    expect(paths).toHaveLength(1)
    expect(paths[0].points[0]).toEqual(paths[0].points.at(-1))
    expect(movePlanNode(resized, 'b', { x: 250, y: -50 }).points.find(p => p.id === 'c')?.x).toBe(250)
  })
})
