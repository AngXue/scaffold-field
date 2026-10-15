import type { Point2D } from '../domain/scaffold'

export const PLAN_LABEL_WIDTH = 108
export const PLAN_LABEL_HEIGHT = 26
type Point = { x: number; y: number }
type Rect = Point & { width: number; height: number }

/** Liang–Barsky clipping, including the outline of the rectangle. */
export function segmentIntersectsLabel(a: Point, b: Point, box: Rect) {
  const dx = b.x - a.x, dy = b.y - a.y
  const p = [-dx, dx, -dy, dy]
  const q = [a.x - box.x, box.x + box.width - a.x, a.y - box.y, box.y + box.height - a.y]
  let lo = 0, hi = 1
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) { if (q[i] < 0) return false; continue }
    const t = q[i] / p[i]
    if (p[i] < 0) lo = Math.max(lo, t)
    else hi = Math.min(hi, t)
    if (lo > hi) return false
  }
  return true
}

/** Screen-space label avoidance only; never edits the measured path. */
export function placePlanLabels(points: Point2D[], zoom: number, viewport?: Rect): Point[] {
  const screen = points.map(p => ({ x: p.x * zoom, y: p.y * zoom }))
  const occupied: Rect[] = screen.flatMap(p => [
    { x: p.x - 18, y: p.y - 39, width: 36, height: 23 },
    { x: p.x - 15, y: p.y - 15, width: 30, height: 30 },
  ])
  const area = screen.slice(1).reduce((sum, b, i) => sum + screen[i].x * b.y - b.x * screen[i].y, 0)
  const side = area > 0 ? -1 : 1
  const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y
  const boxAt = (p: Point): Rect => ({ x: p.x - PLAN_LABEL_WIDTH / 2 - 5,
    y: p.y - PLAN_LABEL_HEIGHT / 2 - 5, width: PLAN_LABEL_WIDTH + 10, height: PLAN_LABEL_HEIGHT + 10 })
  const free = (box: Rect) => (!viewport || (box.x >= viewport.x && box.y >= viewport.y
    && box.x + box.width <= viewport.x + viewport.width && box.y + box.height <= viewport.y + viewport.height))
    && !occupied.some(other => overlaps(box, other))
    && !screen.slice(1).some((b, i) => segmentIntersectsLabel(screen[i], b, box))
  const labels: Point[] = []
  // Short edges have fewer nearby slots; let long edges yield their midpoint.
  const segments = screen.slice(0, -1).map((a, index) => ({ a, b: screen[index + 1], index }))
    .sort((u, v) => Math.hypot(u.b.x - u.a.x, u.b.y - u.a.y) - Math.hypot(v.b.x - v.a.x, v.b.y - v.a.y))
  segments.forEach(({ a, b, index }) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length
    const gap = Math.abs(nx) * PLAN_LABEL_WIDTH / 2 + Math.abs(ny) * PLAN_LABEL_HEIGHT / 2 + 15
    let chosen: Point | undefined
    let bestDistance = Infinity
    for (let ring = 0; ring < 8; ring++) {
      for (const sign of [side, -side]) {
        for (const t of [0.5, 0.35, 0.65, -PLAN_LABEL_WIDTH * 0.75 / length, 1 + PLAN_LABEL_WIDTH * 0.75 / length]) {
          const p = { x: a.x + (b.x - a.x) * t + nx * sign * (gap + ring * 20),
            y: a.y + (b.y - a.y) * t + ny * sign * (gap + ring * 20) }
          const distance = Math.hypot(p.x - (a.x + b.x) / 2, p.y - (a.y + b.y) / 2) + (sign === side ? 0 : 4)
          if (distance < bestDistance && free(boxAt(p))) { chosen = p; bestDistance = distance }
        }
      }
    }
    // Dense drawings at extreme zoom still must not have labels on their lines.
    if (!chosen) {
      chosen = { x: (a.x + b.x) / 2, y: Math.min(...screen.map(p => p.y)) - 70 }
      // Off-screen geometry need not pull a label onto the visible canvas.
      while (occupied.some(other => overlaps(boxAt(chosen!), other))) chosen.y -= PLAN_LABEL_HEIGHT + 12
    }
    occupied.push(boxAt(chosen))
    labels[index] = { x: chosen.x / zoom, y: chosen.y / zoom }
  })
  return labels
}
