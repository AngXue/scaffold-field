import type { PathDimension, ScaffoldParameters, Vector3Tuple } from '../../scaffold.ts'
import { siteLength, type SiteSection } from '../../site.ts'
import type { RoutedSpan } from '../../siteRouting.ts'
import { roundDomain as round, roundSite } from '../facts/precision.ts'
export function pathDimensions(physical: [number, number][], segmentLengths: number[], parameters: ScaffoldParameters): PathDimension[] {
  return physical.slice(0, -1).flatMap((point, index) => {
    const next = physical[index + 1]
    const dx = next[0] - point[0]
    const dz = next[1] - point[1]
    const distance = Math.hypot(dx, dz)
    if (distance < 0.001) return []
    // Row 0 is the path. When row 1 is outside, move past the full row width.
    const offset = parameters.swapInnerOuter ? parameters.width + 1.2 : -1.2
    return [{
      index,
      length: round(Math.max(0.1, segmentLengths[index] ?? distance)),
      start: [point[0], 0, point[1]] as Vector3Tuple,
      end: [next[0], 0, next[1]] as Vector3Tuple,
      labelPosition: [
        round((point[0] + next[0]) / 2 - dz / distance * offset),
        0.015,
        round((point[1] + next[1]) / 2 + dx / distance * offset),
      ] as Vector3Tuple,
    }]
  })
}

export function sectionDimension(index: number, s: SiteSection, d: PathDimension, base: number, swapInnerOuter: boolean, width: number): PathDimension {
  const dx = s.end.x - s.start.x, dz = s.end.z - s.start.z, length = siteLength(s)
  const sign = (d.end[0] - d.start[0]) * dx + (d.end[2] - d.start[2]) * dz < 0 ? -1 : 1
  const offset = sign * (swapInnerOuter ? width + 1.2 : -1.2)
  return { index, length, start: [sign > 0 ? s.start.x : s.end.x, base, sign > 0 ? s.start.z : s.end.z], end: [sign > 0 ? s.end.x : s.start.x, base, sign > 0 ? s.end.z : s.start.z],
    labelPosition: [(s.start.x + s.end.x) / 2 - dz / length * offset, base + 0.015, (s.start.z + s.end.z) / 2 + dx / length * offset] }
}
export function sourceDimensions(dimensions: PathDimension[], spans: RoutedSpan[], labels: Map<string, number>): PathDimension[] {
  return dimensions.map(dimension => {
    const span = spans[dimension.index]
    const siblings = spans.filter(item => item.sourceId === span.sourceId)
    const labelIndex = String(labels.get(span.sourceId)) + (siblings.length > 1 ? `.${siblings.indexOf(span) + 1}` : '')
    return { ...dimension, labelIndex }
  })
}
/** Measurement is based on original strokes; joins and footing splits add no perimeter. */
export const sourcePerimeter = (sections: SiteSection[]) => roundSite(sections.reduce((total, line) => total + siteLength(line), 0))
