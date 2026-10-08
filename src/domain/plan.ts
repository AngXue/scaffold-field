import type { Point2D } from './scaffold'

export const PIXELS_PER_METER = 50
export const GRID_SIZE = PIXELS_PER_METER / 2

const round = (value: number, precision = 2) => Number(value.toFixed(precision))

export function measurePath(points: Point2D[]) {
  return points.slice(0, -1).map((point, index) => {
    const next = points[index + 1]
    return round(Math.hypot(next.x - point.x, next.y - point.y) / PIXELS_PER_METER)
  })
}

export function resizePathSegment(points: Point2D[], segmentIndex: number, length: number) {
  const start = points[segmentIndex]
  const end = points[segmentIndex + 1]
  if (!start || !end) return points

  const dx = end.x - start.x
  const dy = end.y - start.y
  const currentLength = Math.hypot(dx, dy)
  const direction = currentLength > 0 ? { x: dx / currentLength, y: dy / currentLength } : { x: 1, y: 0 }
  const targetEnd = {
    x: round(start.x + direction.x * length * PIXELS_PER_METER),
    y: round(start.y + direction.y * length * PIXELS_PER_METER),
  }
  const translation = { x: targetEnd.x - end.x, y: targetEnd.y - end.y }

  return points.map((point, index) => index > segmentIndex
    ? { ...point, x: round(point.x + translation.x), y: round(point.y + translation.y) }
    : point)
}

/**
 * Inserts a new node AFTER `segmentIndex` and returns the new path, so the segment
 * the user is looking at grows a short handle instead of the path only ever being
 * appended to at its end.
 *
 * The node is placed ON the leg that follows it, `length` metres from the selected
 * segment's end — and never past the halfway point of what is left — so the existing
 * outline is unchanged until the user drags the new node. When the selected segment
 * is the last one there is no leg to aim at, so the path grows straight on in the
 * selected segment's own direction.
 *
 * Ids follow the editor's `P<n>` scheme, and `points.length + 1` cannot collide with
 * the ids already in the path however often segments are inserted and re-inserted.
 */
export function insertPathSegment(points: Point2D[], segmentIndex: number, length: number) {
  const index = Math.max(0, Math.min(segmentIndex, points.length - 2))
  const start = points[index]
  const end = points[index + 1]
  if (!start || !end) return points

  const dx = end.x - start.x
  const dy = end.y - start.y
  const segmentLength = Math.hypot(dx, dy)
  const direction = segmentLength > 0 ? { x: dx / segmentLength, y: dy / segmentLength } : { x: 1, y: 0 }
  const following = points[index + 2]
  const aim = following
    ? { x: following.x - end.x, y: following.y - end.y }
    : { x: direction.x * PIXELS_PER_METER, y: direction.y * PIXELS_PER_METER }
  const aimLength = Math.max(1, Math.hypot(aim.x, aim.y))
  const insertedPixels = Math.min(length * PIXELS_PER_METER, aimLength / 2)
  const inserted: Point2D = {
    id: `P${points.length + 1}`,
    x: Math.round(end.x + (aim.x / aimLength) * insertedPixels),
    y: Math.round(end.y + (aim.y / aimLength) * insertedPixels),
  }

  return [...points.slice(0, index + 2), inserted, ...points.slice(index + 2)]
}