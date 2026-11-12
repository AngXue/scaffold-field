import type { ScaffoldMember } from '../../scaffold.ts'
import type { ResolvedBlock, SitePoint } from '../../site.ts'
import type { TransitionEnd } from '../facts/transitions.ts'
import { footprintOutline } from '../../siteFootprints.ts'
import { mm, SITE_EPS as EPS } from '../facts/precision.ts'
export function guardFacesWall(member: ScaffoldMember, blocks: ResolvedBlock[], clearance: number) {
  if (member.type !== 'guardrail') return false
  const points = member.connectionPoints.length ? member.connectionPoints : [member.start, member.end]
  return blocks.some(block => member.start[1] > block.base && member.start[1] < block.top && footprintOutline(block).some((a, i, outline) => {
    const b = outline[(i + 1) % outline.length], axis = a.x === b.x ? 0 : 2, along = axis === 0 ? 2 : 0
    const at = axis === 0 ? a.x : a.z, low = Math.min(along === 0 ? a.x : a.z, along === 0 ? b.x : b.z)
    const high = Math.max(along === 0 ? a.x : a.z, along === 0 ? b.x : b.z)
    return points.every(p => Math.abs(p[axis] - at) <= clearance + 0.001 && p[along] >= low - 0.001 && p[along] <= high + 0.001)
  }))
}
export function isWallEndGuard(member: ScaffoldMember, ends: TransitionEnd[]) {
  return member.type === 'guardrail' && ends.some(end => end.wall && member.start[1] < end.roof
    && member.connectionPoints.every(point => mm(point[end.axis]) === mm(end.station)))
}


export type SharedStation = { points: SitePoint[]; layers: number }
export function wallGuardRemovals(members: readonly ScaffoldMember[], ends: readonly (readonly [number, TransitionEnd[]])[], blocks: ResolvedBlock[], followsWall: boolean, clearance: number): string[] {
  const transitionEnds = new Map(ends)
  return members.filter(member => isWallEndGuard(member, transitionEnds.get(member.pathSegment ?? -1) ?? [])
    || followsWall && guardFacesWall(member, blocks, clearance)).map(member => member.id)
}
export function sharedCapRemovals(members: readonly ScaffoldMember[], sharedStations: SharedStation[]): string[] {
  return members.filter(member => member.type === 'guardrail' && sharedStations.some(station => (member.layer ?? Infinity) <= station.layers
    && member.connectionPoints.every(point => station.points.some(other => Math.hypot(point[0] - other.x, point[2] - other.z) < EPS)))).map(member => member.id)
}
