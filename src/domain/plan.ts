import type { Point2D } from './scaffold.ts'

export const PIXELS_PER_METER = 50
export const GRID_SIZE = PIXELS_PER_METER / 10

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

/** Which end of the selected segment a new segment is hung off. */
export type PathSide = 'before' | 'after'

/**
 * Inserts a new node at one end of `segmentIndex` and returns the new path, so the
 * segment the user is looking at grows a short handle instead of the path only ever
 * being appended to at its end.
 *
 * The node is placed ON the neighbouring leg — the one that follows the selection for
 * `after`, the one that precedes it for `before` — `length` metres from the end it
 * hangs off, and never past the halfway point of what is left, so the existing outline
 * is unchanged until the user drags the new node. At the start or end of the path
 * there is no neighbouring leg, so the path grows straight on (or straight back) along
 * the selected segment's own direction.
 *
 * Ids follow the editor's `P<n>` scheme, and `points.length + 1` cannot collide with
 * the ids already in the path however often segments are inserted.
 */
export function insertPathSegment(
  points: Point2D[],
  segmentIndex: number,
  length: number,
  side: PathSide = 'after',
) {
  const index = Math.max(0, Math.min(segmentIndex, points.length - 2))
  const start = points[index]
  const end = points[index + 1]
  if (!start || !end) return points

  const dx = end.x - start.x
  const dy = end.y - start.y
  const segmentLength = Math.hypot(dx, dy)
  const direction = segmentLength > 0 ? { x: dx / segmentLength, y: dy / segmentLength } : { x: 1, y: 0 }
  const anchor = side === 'after' ? end : start
  const neighbour = side === 'after' ? points[index + 2] : points[index - 1]
  const sign = side === 'after' ? 1 : -1
  const aim = neighbour
    ? { x: neighbour.x - anchor.x, y: neighbour.y - anchor.y }
    : { x: direction.x * sign * PIXELS_PER_METER, y: direction.y * sign * PIXELS_PER_METER }
  const aimLength = Math.max(1, Math.hypot(aim.x, aim.y))
  const insertedPixels = Math.min(length * PIXELS_PER_METER, aimLength / 2)
  const inserted: Point2D = {
    id: `P${points.length + 1}`,
    x: Math.round(anchor.x + (aim.x / aimLength) * insertedPixels),
    y: Math.round(anchor.y + (aim.y / aimLength) * insertedPixels),
  }

  return side === 'after'
    ? [...points.slice(0, index + 2), inserted, ...points.slice(index + 2)]
    : [...points.slice(0, index), inserted, ...points.slice(index)]
}
/** Explicit edges prevent disconnected drawings from acquiring phantom links. */
export type PlanSegment = { id: string; start: string; end: string }
export type PlanDrawing = { points: Point2D[]; segments: PlanSegment[] }
export const EMPTY_DRAWING: PlanDrawing = { points: [], segments: [] }

type Position = { x: number; y: number }
export function snapPlanPoint(point: Position): Position {
  return { x: round(Math.round(point.x / GRID_SIZE) * GRID_SIZE), y: round(Math.round(point.y / GRID_SIZE) * GRID_SIZE) }
}

export function orthogonalEnd(start: Position, end: Position, snap = true): Position {
  const target = snap ? snapPlanPoint(end) : end
  return Math.abs(target.x - start.x) >= Math.abs(target.y - start.y)
    ? { x: round(target.x), y: start.y }
    : { x: start.x, y: round(target.y) }
}

/** Also migrates the ordered points used by releases <= 1.2. */
export function readDrawing(points: Point2D[], segments?: PlanSegment[]): PlanDrawing {
  const valid = Array.isArray(points) ? points.filter(p => p && typeof p.id === 'string' && Number.isFinite(p.x) && Number.isFinite(p.y)) : []
  return normalizeDrawing({ points: valid, segments: Array.isArray(segments) ? segments : valid.slice(1).map((p, i) => ({ id: `S${i + 1}`, start: valid[i].id, end: p.id })) })
}

/** Merge coincident endpoints, split T junctions and remove duplicate/zero edges. */
export function normalizeDrawing(drawing: PlanDrawing): PlanDrawing {
  const points: Point2D[] = []
  const aliases = new Map<string, string>()
  for (const p of drawing.points) {
    const existing = points.find(q => Math.hypot(q.x - p.x, q.y - p.y) < 0.001)
    if (existing) aliases.set(p.id, existing.id)
    else { points.push({ ...p }); aliases.set(p.id, p.id) }
  }
  const segments: PlanSegment[] = []
  const seen = new Set<string>(), ids = new Set<string>()
  for (const edge of drawing.segments) {
    if (!edge || typeof edge.id !== 'string') continue
    const start = points.find(p => p.id === aliases.get(edge.start))
    const end = points.find(p => p.id === aliases.get(edge.end))
    if (!start || !end || start.id === end.id) continue
    const dx = end.x - start.x, dy = end.y - start.y, distance = Math.hypot(dx, dy)
    const along = (p: Position) => ((p.x - start.x) * dx + (p.y - start.y) * dy) / distance
    const onEdge = points.filter(p => Math.abs((p.x - start.x) * dy - (p.y - start.y) * dx) / distance < 0.001
      && along(p) >= -0.001 && along(p) <= distance + 0.001).sort((a, b) => along(a) - along(b))
    for (let i = 1; i < onEdge.length; i++) {
      const a = onEdge[i - 1].id, b = onEdge[i].id, key = [a, b].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      const baseId = i === 1 ? edge.id : `${edge.id}.${i}`
      let id = baseId
      while (ids.has(id)) id += '_'
      ids.add(id)
      segments.push({ id, start: a, end: b })
    }
  }
  const used = new Set(segments.flatMap(s => [s.start, s.end]))
  return { points: points.filter(p => used.has(p.id)), segments }
}

export function measureDrawing(drawing: PlanDrawing) {
  const nodes = new Map(drawing.points.map(p => [p.id, p]))
  return drawing.segments.map(s => {
    const a = nodes.get(s.start)!, b = nodes.get(s.end)!
    return round(Math.hypot(b.x - a.x, b.y - a.y) / PIXELS_PER_METER)
  })
}

export function addPlanSegment(drawing: PlanDrawing, start: Position, end: Position): PlanDrawing {
  end = orthogonalEnd(start, end, false)
  if (Math.hypot(end.x - start.x, end.y - start.y) < 0.5) return drawing
  const points = [...drawing.points]
  const nextId = (prefix: string, ids: string[]) => {
    let index = ids.length + 1
    while (ids.includes(`${prefix}${index}`)) index++
    return `${prefix}${index}`
  }
  const node = (position: Position) => {
    let p = points.find(p => Math.hypot(p.x - position.x, p.y - position.y) < 0.001)
    if (!p) { p = { id: nextId('P', points.map(p => p.id)), x: round(position.x), y: round(position.y) }; points.push(p) }
    return p.id
  }
  const a = node(start), b = node(end)
  return normalizeDrawing({ points, segments: [...drawing.segments, { id: nextId('S', drawing.segments.map(s => s.id)), start: a, end: b }] })
}

export function deletePlanSegment(drawing: PlanDrawing, id: string): PlanDrawing {
  return normalizeDrawing({ ...drawing, segments: drawing.segments.filter(s => s.id !== id) })
}

/** Move a shared node and propagate each coordinate through perpendicular edges. */
export function movePlanNode(drawing: PlanDrawing, id: string, target: Position): PlanDrawing {
  const anchor = drawing.points.find(p => p.id === id)
  if (!anchor) return drawing
  const group = (coordinate: 'x' | 'y') => {
    const ids = new Set([id]), nodes = new Map(drawing.points.map(p => [p.id, p]))
    let changed = true
    while (changed) {
      changed = false
      for (const s of drawing.segments) {
        if (Math.abs(nodes.get(s.start)![coordinate] - nodes.get(s.end)![coordinate]) > 0.001) continue
        if (ids.has(s.start) !== ids.has(s.end)) { ids.add(s.start); ids.add(s.end); changed = true }
      }
    }
    return ids
  }
  const xs = group('x'), ys = group('y')
  return normalizeDrawing({ ...drawing, points: drawing.points.map(p => ({ ...p,
    x: round(p.x + (xs.has(p.id) ? target.x - anchor.x : 0)),
    y: round(p.y + (ys.has(p.id) ? target.y - anchor.y : 0)),
  })) })
}

export function resizeDrawingSegment(drawing: PlanDrawing, id: string, length: number): PlanDrawing {
  const s = drawing.segments.find(s => s.id === id)
  if (!s || !Number.isFinite(length) || length < 0.1) return drawing
  const a = drawing.points.find(p => p.id === s.start)!, b = drawing.points.find(p => p.id === s.end)!
  const distance = Math.hypot(b.x - a.x, b.y - a.y)
  return movePlanNode(drawing, b.id, {
    x: a.x + (b.x - a.x) / distance * length * PIXELS_PER_METER,
    y: a.y + (b.y - a.y) / distance * length * PIXELS_PER_METER,
  })
}

/** Degree-two corners form paths; branches are explicit, never invented bridges. */
export function drawingPaths(drawing: PlanDrawing): Array<{ points: Point2D[]; edgeIndices: number[] }> {
  const nodes = new Map(drawing.points.map(p => [p.id, p]))
  const incident = new Map(drawing.points.map(p => [p.id, [] as number[]]))
  drawing.segments.forEach((s, i) => { incident.get(s.start)!.push(i); incident.get(s.end)!.push(i) })
  const used = new Set<number>(), paths: Array<{ points: Point2D[]; edgeIndices: number[] }> = []
  const walk = (first: number, from: string) => {
    const points = [nodes.get(from)!], edgeIndices: number[] = []
    let index: number | undefined = first, at = from
    while (index !== undefined && !used.has(index)) {
      used.add(index); edgeIndices.push(index)
      const edge = drawing.segments[index]
      at = edge.start === at ? edge.end : edge.start
      points.push(nodes.get(at)!)
      if (incident.get(at)!.length !== 2) break
      index = incident.get(at)!.find(i => !used.has(i))
    }
    paths.push({ points, edgeIndices })
  }
  // Start at a true path end if one exists; retain the first drawn edge's direction.
  drawing.segments.forEach((s, i) => {
    if (used.has(i)) return
    if (incident.get(s.start)!.length !== 2) walk(i, s.start)
    else if (incident.get(s.end)!.length !== 2) walk(i, s.end)
  })
  drawing.segments.forEach((s, i) => { if (!used.has(i)) walk(i, s.start) })
  return paths
}
