import type { ScaffoldMember, PipeSegment, Vector3Tuple, DeckPanel } from '../../scaffold.ts'
import { signedArea, type PlanPolygon } from '../../polygons.ts'
import { mm } from '../facts/precision.ts'
import type { Interval, AxialRange, WallCell, GuardObstacle, Walkway } from '../facts/placement.ts'
import type { TransitionEnd } from '../facts/transitions.ts'

/** Portion of an infinite centreline strictly inside a convex face. */
export function insideInterval(origin: Vector3Tuple, direction: Vector3Tuple, polygon: PlanPolygon, inset = 0.002): Interval | undefined {
  const winding = Math.sign(signedArea(polygon))
  let low = -Infinity, high = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz)
    if (length < 1e-9) continue
    const distance = winding * (dx * (origin[2] - a[1]) - dz * (origin[0] - a[0])) / length
    const slope = winding * (dx * direction[2] - dz * direction[0]) / length
    if (Math.abs(slope) < 1e-9) { if (distance < inset) return; continue }
    const at = (inset - distance) / slope
    if (slope > 0) low = Math.max(low, at)
    else high = Math.min(high, at)
    if (high <= low) return
  }
  return Number.isFinite(low) && Number.isFinite(high) ? [low, high] : undefined
}


export function transitionRange(member: ScaffoldMember, pipes: readonly PipeSegment[], ends: readonly TransitionEnd[], radius: number): AxialRange | undefined {
  if (member.type !== 'longitudinal' && member.type !== 'guardrail') return
  const axis = mm(member.start[0]) === mm(member.end[0]) ? 2 : 0, cross = axis === 0 ? 2 : 0
  if (mm(member.start[cross]) !== mm(member.end[cross])) return
  const relevant = ends.filter(end => end.axis === axis && member.start[1] < end.roof + radius
    && member.connectionPoints.some(point => mm(point[axis]) === mm(end.station)))
  if (!relevant.length || !pipes.length) return
  const points = pipes.flatMap(pipe => [pipe.start[axis], pipe.end[axis]])
  const low = Math.min(...points), high = Math.max(...points)
  let lower = Math.max(member.start[axis], member.end[axis]) - high, upper = Math.min(member.start[axis], member.end[axis]) - low
  for (const end of relevant) {
    if (end.towardRoof > 0) upper = Math.min(upper, end.boundary - radius - 0.002 - high)
    else lower = Math.max(lower, end.boundary + radius + 0.002 - low)
  }
  return { axis, allowed: lower > upper + 1e-6 ? [] : [[lower, upper]] }
}
export function wallRange(member: ScaffoldMember, pipes: readonly PipeSegment[], cells: readonly WallCell[], radius: number): AxialRange | undefined {
  if (member.type === 'post' || member.start[1] !== member.end[1] || !pipes.length) return
  const axis = member.start[0] === member.end[0] ? 2 : 0, cross = axis === 0 ? 2 : 0
  if (member.start[cross] !== member.end[cross]) return
  const low = Math.min(...pipes.flatMap(pipe => [pipe.start[axis], pipe.end[axis]])), high = Math.max(...pipes.flatMap(pipe => [pipe.start[axis], pipe.end[axis]]))
  let allowed: Interval[] = [[Math.max(member.start[axis], member.end[axis]) - high, Math.min(member.start[axis], member.end[axis]) - low]]
  for (const cell of cells) {
    if (member.start[1] + radius <= cell.base || member.start[1] - radius >= cell.top) continue
    const c = cross === 0 ? cell.x : cell.z, size = cross === 0 ? cell.width : cell.depth
    if (member.start[cross] + radius <= c || member.start[cross] - radius >= c + size) continue
    const a = (axis === 0 ? cell.x : cell.z) - high - 0.002, b = (axis === 0 ? cell.x + cell.width : cell.z + cell.depth) - low + 0.002
    allowed = allowed.flatMap(([l, r]) => b <= l || a >= r ? [[l, r]] : [[l, Math.min(r, a)], [Math.max(l, b), r]].filter(([lo, hi]) => hi >= lo) as Interval[])
  }
  return { axis, allowed: allowed.filter(([l, r]) => l <= r) }
}
export function walkwayObjective(member: ScaffoldMember, faces: PlanPolygon[]): Walkway | undefined {
  if (member.type !== 'guardrail' || member.length <= 0.001) return
  const origin = member.start, length = Math.hypot(...member.end.map((value, index) => value - origin[index]))
  const direction = member.end.map((value, index) => (value - origin[index]) / length) as Vector3Tuple
    const merged = (ranges: Interval[]) => {
      const result: Interval[] = []
      for (const interval of ranges.sort((a,b) => a[0] - b[0])) {
        const previous = result.at(-1)
        if (previous && interval[0] <= previous[1] + 0.001) previous[1] = Math.max(previous[1], interval[1])
        else result.push([...interval])
      }
      return result
    }
    // A seam between panels is still inside the walkway. Require deck on BOTH
    // sides of the rail, instead of treating each panel boundary as an outer edge.
    const sides = [-1,1].map(sign => {
      const offset: Vector3Tuple = [origin[0] - direction[2] * sign * 0.0001, origin[1], origin[2] + direction[0] * sign * 0.0001]
      return merged(faces.flatMap(face => {
        const interval = insideInterval(offset, direction, face, 0)
        return interval ? [interval] : []
      }))
    })
    const occupied = merged(sides[0].flatMap(([a,b]) => sides[1].flatMap(([c,d]) =>
      Math.min(b,d) - Math.max(a,c) > 0.001 ? [[Math.max(a,c),Math.min(b,d)] as Interval] : [])))

  return occupied.length ? { memberId: member.id, direction, origin, length, occupied } : undefined
}
export function walkwayObjectives(members: readonly ScaffoldMember[], decks: readonly DeckPanel[]): Walkway[] {
  const byLayer = new Map<number, PlanPolygon[]>()
  for (const deck of decks) {
    const faces = byLayer.get(deck.layer) ?? []
    faces.push(...(deck.coverage ?? [deck.corners]).map(face => face.map(point => [point[0], point[2]] as [number, number])))
    byLayer.set(deck.layer, faces)
  }
  return members.flatMap(member => { const objective = walkwayObjective(member, byLayer.get(member.layer ?? -1) ?? []); return objective ? [objective] : [] })
}
export function guardBounds(objective: Walkway, pipes: readonly PipeSegment[], obstacles: readonly GuardObstacle[], radius: number) {
  const { origin, direction, length } = objective
  const project = (point: Vector3Tuple) => point.reduce((sum, value, index) => sum + (value - origin[index]) * direction[index], 0)
  const low = Math.min(...pipes.flatMap(pipe => [project(pipe.start), project(pipe.end)])), high = Math.max(...pipes.flatMap(pipe => [project(pipe.start), project(pipe.end)]))
  let allowed: Interval[] = [[length - high, -low]]
  for (const obstacle of obstacles) {
    if (origin[1] + radius <= obstacle.base || origin[1] - radius >= obstacle.top) continue
    const interval = insideInterval(origin, direction, obstacle.polygon, -radius - 0.002)
    if (!interval) continue
    const a = interval[0] - high, b = interval[1] - low
    allowed = allowed.flatMap(([l, r]) => b <= l || a >= r ? [[l, r]] : [[l, Math.min(r, a)], [Math.max(l, b), r]].filter(([x, y]) => y >= x) as Interval[])
  }
  return { low, high, allowed }
}
export function intersectIntervals(left: readonly Interval[], right: readonly Interval[]): Interval[] {
  return left.flatMap(([a, b]) => right.flatMap(([c, d]) => Math.max(a, c) <= Math.min(b, d) + 1e-6 ? [[Math.max(a, c), Math.min(b, d)] as Interval] : []))
}
export function closestShift(allowed: readonly Interval[]): number | undefined {
  return allowed.map(([low, high]) => Math.max(low, Math.min(0, high))).sort((a, b) => Math.abs(a) - Math.abs(b))[0]
}
