import { signedArea, subtractCoverage, type PlanPolygon } from './polygons.ts'
import type { Footprint, SitePoint } from './site.ts'

const EPS = 0.001
const round = (n: number) => Math.round(n * 1000) / 1000
const same = (a: SitePoint, b: SitePoint) => Math.abs(a.x - b.x) < EPS && Math.abs(a.z - b.z) < EPS
export const rectanglePolygon = (r: Footprint): PlanPolygon =>
  [[r.x, r.z], [r.x + r.width, r.z], [r.x + r.width, r.z + r.depth], [r.x, r.z + r.depth]]
export const footprintOutline = (r: Footprint): SitePoint[] => r.outline ?? rectanglePolygon(r).map(([x, z]) => ({ x, z }))

/** A single simple orthogonal boundary, with closure implicit in storage. */
export function footprintFromOutline(input: SitePoint[]): Footprint | undefined {
  const points = input.map(p => ({ x: round(p.x), z: round(p.z) }))
  if (points.length > 1 && same(points[0], points.at(-1)!)) points.pop()
  if (points.length < 4 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) return
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    if ((a.x === b.x) === (a.z === b.z)) return
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || i === 0 && j === points.length - 1) continue
      const c = points[j], d = points[(j + 1) % points.length]
      // Non-neighbouring edges may neither intersect nor touch.
      const overlapsX = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
      const overlapsZ = Math.max(Math.min(a.z, b.z), Math.min(c.z, d.z)) <= Math.min(Math.max(a.z, b.z), Math.max(c.z, d.z))
      if (overlapsX && overlapsZ) return
    }
  }
  if (Math.abs(signedArea(points.map(p => [p.x, p.z]))) < 1e-6) return
  const x = Math.min(...points.map(p => p.x)), z = Math.min(...points.map(p => p.z))
  return { x, z, width: round(Math.max(...points.map(p => p.x)) - x), depth: round(Math.max(...points.map(p => p.z)) - z), outline: points }
}

const cellsCache = new WeakMap<Footprint, Footprint[]>()
/** Disjoint rectangles cover the actual orthogonal face, including concave shapes. */
export function footprintCells(block: Footprint): Footprint[] {
  if (!block.outline) return [block]
  const cached = cellsCache.get(block)
  if (cached) return cached
  const xs = [...new Set(block.outline.map(p => p.x))].sort((a, b) => a - b)
  const cells: Footprint[] = []
  for (let i = 1; i < xs.length; i++) {
    const x = (xs[i - 1] + xs[i]) / 2
    const zs = block.outline.flatMap((a, j) => {
      const b = block.outline![(j + 1) % block.outline!.length]
      return a.z === b.z && x > Math.min(a.x, b.x) && x < Math.max(a.x, b.x) ? [a.z] : []
    }).sort((a, b) => a - b)
    for (let j = 1; j < zs.length; j += 2) cells.push({ x: xs[i - 1], z: zs[j - 1], width: round(xs[i] - xs[i - 1]), depth: round(zs[j] - zs[j - 1]) })
  }
  cellsCache.set(block, cells)
  return cells
}

export function footprintContainsPoint(block: Footprint, p: SitePoint, tolerance = EPS) {
  return footprintCells(block).some(r => p.x >= r.x - tolerance && p.x <= r.x + r.width + tolerance
    && p.z >= r.z - tolerance && p.z <= r.z + r.depth + tolerance)
}

export function footprintCoversPolygon(block: Footprint, polygon: PlanPolygon) {
  return subtractCoverage([polygon], footprintCells(block).map(rectanglePolygon))
    .reduce((sum, part) => sum + Math.abs(signedArea(part)), 0) < 1e-6
}

export function footprintContains(parent: Footprint, child: Footprint) {
  return footprintCells(child).every(cell => footprintCoversPolygon(parent, rectanglePolygon(cell)))
}

export function footprintSupportsSegment(block: Footprint, a: SitePoint, b: SitePoint) {
  if (!footprintContainsPoint(block, a) || !footprintContainsPoint(block, b)) return false
  const dx = b.x - a.x, dz = b.z - a.z
  const cuts = [0, 1]
  for (const r of footprintCells(block)) {
    if (Math.abs(dx) > EPS) for (const x of [r.x, r.x + r.width]) cuts.push((x - a.x) / dx)
    if (Math.abs(dz) > EPS) for (const z of [r.z, r.z + r.depth]) cuts.push((z - a.z) / dz)
  }
  cuts.sort((p, q) => p - q)
  return cuts.slice(1).every((end, i) => {
    const t = (end + cuts[i]) / 2
    return t <= 0 || t >= 1 || footprintContainsPoint(block, { x: a.x + dx * t, z: a.z + dz * t })
  })
}

export function footprintsOverlap(a: Footprint, b: Footprint) {
  return footprintCells(a).some(left => footprintCells(b).some(right =>
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x) > EPS
      && Math.min(left.z + left.depth, right.z + right.depth) - Math.max(left.z, right.z) > EPS))
}

export function reshapeFootprint(block: Footprint, update: Partial<Footprint>): Footprint {
  const result = { ...block, ...update }
  if (!block.outline) return result
  const outline = block.outline.map(p => ({
    x: round(result.x + (p.x - block.x) * result.width / block.width),
    z: round(result.z + (p.z - block.z) * result.depth / block.depth),
  }))
  return { ...result, outline }
}
