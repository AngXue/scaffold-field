import { memberUses } from '../facts/memberUses.ts'
import type { SiteSection } from '../../site.ts'
import type { PipeSegment, ScaffoldMember, Vector3Tuple } from '../../scaffold.ts'
import { containsPoint, type ResolvedBlock, type SitePoint, type SiteIssue } from '../../site.ts'
import { footprintCells, footprintCoversPolygon, footprintSupportsSegment } from '../../siteFootprints.ts'
import { subtractCoverage, type PlanPolygon } from '../../polygons.ts'
import { SITE_EPS as EPS } from '../facts/precision.ts'
import { sourcedIssue } from '../facts/issues.ts'
import { planEnters, coveredArea, footprintPolygon, pipeEntersBlock, overlapBoxes, type AxisBox } from './collisionGeometry.ts'
export type PhysicalCheck = { sectionId: string } & (
  | { kind: 'line'; a: SitePoint; b: SitePoint }
  | { kind: 'post'; point: Vector3Tuple }
  | { kind: 'base'; footprint: PlanPolygon }
  | { kind: 'pipe'; start: Vector3Tuple; end: Vector3Tuple }
  | { kind: 'deck'; elevation: number; polygons: PlanPolygon[] }
)
export type ValidationContext = { blocks: ResolvedBlock[]; surface?: ResolvedBlock; obstructing: ResolvedBlock[]; radius: number; labels: Record<string, string> }
export type CheckFinding = { order: number; issue: SiteIssue }
export type ElementBounds = { bounds: AxisBox; sectionId: string; deck?: PlanPolygon[] }
export type PhysicalGroup = { bounds: AxisBox; elements: ElementBounds[] }
export function supportFindings(checks: readonly PhysicalCheck[], context: ValidationContext): CheckFinding[] {
  const { surface, obstructing, radius, labels } = context
  const supported = (a: SitePoint, b: SitePoint) => (!surface || footprintSupportsSegment(surface, a, b))
    && !obstructing.some(block => containsPoint(block, a, -EPS) || containsPoint(block, b, -EPS) || planEnters(a, b, block))
  return checks.flatMap((check, order) => {
    let element: string | undefined
    if (check.kind === 'line' && !supported(check.a, check.b)) element = '绘制线'
    if (check.kind === 'post') {
      const [x, , z] = check.point, rim = [{ x: x - radius, z }, { x: x + radius, z }, { x, z: z - radius }, { x, z: z + radius }]
      if (rim.some(point => !supported(point, point))) element = '立杆柱脚'
    }
    if (check.kind === 'base' && ((surface && !footprintCoversPolygon(surface, check.footprint)) || obstructing.some(block =>
      coveredArea([check.footprint]) - coveredArea(subtractCoverage([check.footprint], footprintCells(block).map(footprintPolygon))) > 1e-6))) element = '底座'
    return element ? [{ order, issue: sourcedIssue('V01', { code: 'off-surface', sectionIds: [check.sectionId], blocking: true,
      message: `${labels[check.sectionId]}的${element}超出或跨越所选落脚面，请调整位置或分段。` }) }] : []
  })
}
export function penetrationFindings(checks: readonly PhysicalCheck[], context: ValidationContext): CheckFinding[] {
  return checks.flatMap((check, order) => {
    const penetrated = check.kind === 'pipe' ? context.blocks.some(block => pipeEntersBlock(check.start, check.end, block, context.radius))
      : check.kind === 'deck' && context.blocks.some(block => check.elevation > block.base + EPS && check.elevation < block.top - EPS
        && coveredArea(check.polygons) - coveredArea(subtractCoverage(check.polygons, footprintCells(block).map(footprintPolygon))) > 1e-6)
    return penetrated ? [{ order, issue: sourcedIssue('V03', { code: 'house-penetration', blocking: true, sectionIds: [check.sectionId],
      message: `${context.labels[check.sectionId]}的架体穿入房屋体块，请调整架段位置。` }) }] : []
  })
}
export function independentOverlapIssues(physicalGroups: readonly PhysicalGroup[], order: readonly string[], labels: Record<string, string>): SiteIssue[] {
  const issues: SiteIssue[] = [], indexById = new Map(order.map((id, index) => [id, index]))
  for (let i = 0; i < physicalGroups.length; i++) for (let j = i + 1; j < physicalGroups.length; j++) {
    const left = physicalGroups[i], right = physicalGroups[j]
    if (!overlapBoxes(left.bounds, right.bounds)) continue
    const colliding = new Set<string>()
    for (const a of left.elements) for (const b of right.elements) {
      if (b.bounds.min[0] >= a.bounds.max[0] - EPS) break
      if (!overlapBoxes(a.bounds, b.bounds)) continue
      if (a.deck && b.deck && coveredArea(a.deck) - coveredArea(subtractCoverage(a.deck, b.deck)) < 1e-6) continue
      colliding.add(a.sectionId); colliding.add(b.sectionId)
    }
    if (colliding.size) {
      const ids = [...colliding].sort((a, b) => indexById.get(a)! - indexById.get(b)!)
      issues.push(sourcedIssue('V03', { code: 'independent-overlap', sectionIds: ids, blocking: true, message: `${ids.map(id => labels[id]).join('、')}的独立架体发生实体重叠，请移开柱脚或调整架段。` }))
    }
  }

  return issues
}

/** V03 collision ownership follows source intervals after a physical run is shared.
 * Bridge intervals are checked by bridgeIssues against final entities. A surviving
 * display prefix must not turn a supported shared run into an independent overlap.
 * All physical surplus outside the logical ends stays with its end owner.
 */
export function independentPipeScopes(pipe: PipeSegment, member: ScaffoldMember, sections: readonly SiteSection[], groupBySection: ReadonlyMap<string, number>) {
  const uses = memberUses(member)
  const origins = new Set(uses.map(use => groupBySection.get(sections[use.pathSegment]?.id)))
  const sectionId = sections[member.pathSegment ?? -1]?.id
  if (origins.size <= 1) return [{ group: groupBySection.get(sectionId), sectionId, start: pipe.start, end: pipe.end }]
  const axis = Math.abs(member.end[0] - member.start[0]) > EPS ? 0 : 2
  const low = Math.min(pipe.start[axis], pipe.end[axis]), high = Math.max(pipe.start[axis], pipe.end[axis])
  const memberLow = Math.min(member.start[axis], member.end[axis]), memberHigh = Math.max(member.start[axis], member.end[axis])
  return uses.flatMap(use => {
    if (use.purpose.startsWith('bridge-')) return []
    const a = Math.min(use.start[axis], use.end[axis]), b = Math.max(use.start[axis], use.end[axis])
    const from = Math.max(low, a <= memberLow + EPS ? low : a), to = Math.min(high, b >= memberHigh - EPS ? high : b)
    if (to - from <= EPS) return []
    const point = (value: number) => pipe.start.map((coordinate, index) => index === axis ? value : coordinate) as Vector3Tuple
    const id = sections[use.pathSegment]?.id
    return [{ group: groupBySection.get(id), sectionId: id, start: point(from), end: point(to) }]
  })
}
