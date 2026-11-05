import type { ScaffoldLayout, Vector3Tuple } from './scaffold.ts'
import { signedArea, type PlanPolygon } from './polygons.ts'

type Interval = [number, number]
export type GuardObstacle = { polygon: PlanPolygon; base: number; top: number }

/** Portion of an infinite centreline strictly inside a convex face. */
function insideInterval(origin: Vector3Tuple, direction: Vector3Tuple, polygon: PlanPolygon, inset = 0.002): Interval | undefined {
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

/** Slide whole stock, never cut it or lose a design endpoint. Minimise intrusion,
 * then movement. Unavoidable surplus remains and never blocks material export. */
export function fitGuardrailStock(layout: Pick<ScaffoldLayout, 'members' | 'pipeSegments' | 'connectors' | 'decks'>,
  obstacles: GuardObstacle[] = [], radius = 0.024) {
  const pipesByMember = new Map<string, ScaffoldLayout['pipeSegments']>()
  for (const pipe of layout.pipeSegments) {
    const pipes = pipesByMember.get(pipe.memberId) ?? []
    pipes.push(pipe); pipesByMember.set(pipe.memberId, pipes)
  }
  const facesByLayer = new Map<number, PlanPolygon[]>()
  for (const deck of layout.decks) {
    const faces = facesByLayer.get(deck.layer) ?? []
    faces.push(...(deck.coverage ?? [deck.corners]).map(face => face.map(p => [p[0], p[2]] as [number, number])))
    facesByLayer.set(deck.layer, faces)
  }
  for (const member of layout.members) {
    if (member.type !== 'guardrail' || member.length <= 0.001) continue
    const origin = member.start
    const length = Math.hypot(...member.end.map((v,i) => v - origin[i]))
    const direction = member.end.map((v, i) => (v - origin[i]) / length) as Vector3Tuple
    const project = (p: Vector3Tuple) => p.reduce((sum, v, i) => sum + (v - origin[i]) * direction[i], 0)
    const pipes = pipesByMember.get(member.id)
    if (!pipes?.length) continue
    const low = Math.min(...pipes.flatMap(p => [project(p.start), project(p.end)]))
    const high = Math.max(...pipes.flatMap(p => [project(p.start), project(p.end)]))
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
      return merged((facesByLayer.get(member.layer ?? -1) ?? []).flatMap(face => {
        const interval = insideInterval(offset, direction, face, 0)
        return interval ? [interval] : []
      }))
    })
    const occupied = merged(sides[0].flatMap(([a,b]) => sides[1].flatMap(([c,d]) =>
      Math.min(b,d) - Math.max(a,c) > 0.001 ? [[Math.max(a,c),Math.min(b,d)] as Interval] : [])))
    if (!occupied.length) continue
    let allowed: Interval[] = [[length - high, -low]]
    // Wall clearance remains a hard constraint; walkway intrusion is best-effort.
    for (const obstacle of obstacles) {
      if (origin[1] + radius <= obstacle.base || origin[1] - radius >= obstacle.top) continue
      const interval = insideInterval(origin, direction, obstacle.polygon, -radius - 0.002)
      if (!interval) continue
      const a = interval[0] - high, b = interval[1] - low
      allowed = allowed.flatMap(([l,r]) => b <= l || a >= r ? [[l,r] as Interval]
        : [[l,Math.min(r,a)],[Math.max(l,b),r]].filter(([x,y]) => y >= x) as Interval[])
    }
    const score = (shift: number) => occupied.reduce((sum,[a,b]) => sum + Math.max(0,Math.min(high + shift,b) - Math.max(low + shift,a)),0)
    const breaks = [0,...occupied.flatMap(([a,b]) => [a-low,a-high,b-low,b-high])]
    const candidates = allowed.flatMap(([a,b]) => a > b + 1e-6 ? [] : [a,b,...breaks.map(n => Math.max(a,Math.min(b,n)))])
    candidates.sort((a,b) => Math.abs(score(a)-score(b)) > 1e-7 ? score(a)-score(b) : Math.abs(a)-Math.abs(b))
    const shift = candidates[0]
    if (shift === undefined || Math.abs(shift) < 1e-6 || score(shift) >= score(0) - 1e-7) continue
    const move = (point: Vector3Tuple): Vector3Tuple => point.map((v,i) => v + direction[i] * shift) as Vector3Tuple
    for (const pipe of pipes) { pipe.start = move(pipe.start); pipe.end = move(pipe.end) }
    for (const connector of layout.connectors) if (connector.type === 'butt' && connector.memberId === member.id) connector.position = move(connector.position)
  }
}
