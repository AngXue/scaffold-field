import type { Vector3Tuple } from '../../scaffold.ts'
import type { SitePoint, Footprint, ResolvedBlock } from '../../site.ts'
import { footprintCells } from '../../siteFootprints.ts'
import { signedArea, type PlanPolygon } from '../../polygons.ts'
import { SITE_EPS as EPS } from '../facts/precision.ts'
export type AxisBox = { min: Vector3Tuple; max: Vector3Tuple }
export function entersBox(a: Vector3Tuple, b: Vector3Tuple, box: AxisBox) {
  let start = 0, end = 1
  for (let axis = 0; axis < 3; axis++) {
    const d = b[axis] - a[axis], low = box.min[axis], high = box.max[axis]
    if (Math.abs(d) < 1e-9) {
      if (a[axis] <= low || a[axis] >= high) return false
    } else {
      const u = (low - a[axis]) / d, v = (high - a[axis]) / d
      start = Math.max(start, Math.min(u, v)); end = Math.min(end, Math.max(u, v))
      if (start >= end) return false
    }
  }
  return start < end
}
export function planEnters(a: SitePoint, b: SitePoint, block: Footprint) {
  return footprintCells(block).some(cell => entersBox([a.x, 0, a.z], [b.x, 0, b.z], {
    min: [cell.x + EPS, -1, cell.z + EPS], max: [cell.x + cell.width - EPS, 1, cell.z + cell.depth - EPS],
  }))
}
export const footprintPolygon = (r: Footprint): PlanPolygon =>
  [[r.x, r.z], [r.x + r.width, r.z], [r.x + r.width, r.z + r.depth], [r.x, r.z + r.depth]]
export const coveredArea = (polygons: PlanPolygon[]) => polygons.reduce((total, face) => total + Math.abs(signedArea(face)), 0)

export function pipeEntersBlock(a: Vector3Tuple, b: Vector3Tuple, block: ResolvedBlock, radius: number) {
  const vertical = Math.abs(a[0] - b[0]) < EPS && Math.abs(a[2] - b[2]) < EPS
  // Uprights have flat ends: bearing on the top is permitted, penetration is not.
  if (vertical && Math.min(a[1], b[1]) >= block.top - EPS) return false
  const delta = a.map((value, i) => Math.abs(value - b[i]))
  const axis = delta.indexOf(Math.max(...delta))
  const padding = (i: number) => i === axis ? 0 : radius
  return footprintCells(block).some(cell => entersBox(a, b, {
    min: [cell.x - padding(0) + EPS, block.base - padding(1) + EPS, cell.z - padding(2) + EPS],
    max: [cell.x + cell.width + padding(0) - EPS, block.top + padding(1) - EPS, cell.z + cell.depth + padding(2) - EPS],
  }))
}

export function stockBounds(a: Vector3Tuple, b: Vector3Tuple, radius: number): AxisBox {
  // The model's tubes have flat ends. For axis-aligned tubes the dominant axis
  // needs no padding, so two end-to-end runs aren't mistaken for overlap.
  const delta = a.map((v, i) => Math.abs(v - b[i]))
  const axis = delta.indexOf(Math.max(...delta))
  const padding = (i: number) => i === axis ? 0 : radius
  return {
    min: a.map((v, i) => Math.min(v, b[i]) - padding(i)) as Vector3Tuple,
    max: a.map((v, i) => Math.max(v, b[i]) + padding(i)) as Vector3Tuple,
  }
}
export function overlapBoxes(a: AxisBox, b: AxisBox) {
  return a.min.every((v, i) => Math.min(a.max[i], b.max[i]) - Math.max(v, b.min[i]) > EPS)
}

export function deckBounds(corners: Vector3Tuple[]): AxisBox {
  return { min: [Math.min(...corners.map(p => p[0])), corners[0][1], Math.min(...corners.map(p => p[2]))],
    max: [Math.max(...corners.map(p => p[0])), corners[0][1] + 0.004, Math.max(...corners.map(p => p[2]))] }
}

