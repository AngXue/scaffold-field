import { SITE_EPS as EPS } from '../facts/precision.ts'
import { siteLength, type SiteSection, type SitePoint } from '../../site.ts'


export function meetOnPlan(a: SiteSection, b: SiteSection) {
  const on = (p: SitePoint, line: SiteSection) => {
    const dx = line.end.x - line.start.x, dz = line.end.z - line.start.z
    const length = Math.hypot(dx, dz)
    if (length < EPS) return false
    const x = p.x - line.start.x, z = p.z - line.start.z
    const along = (x * dx + z * dz) / length
    return Math.abs(x * dz - z * dx) / length <= EPS && along >= -EPS && along <= length + EPS
  }
  return on(a.start, b) || on(a.end, b) || on(b.start, a) || on(b.end, a)
}

export function footingStations(s: SiteSection, width: number) {
  const length = siteLength(s), dx = -(s.end.z-s.start.z)/length*width, dz = (s.end.x-s.start.x)/length*width
  return [s.start,s.end].map(p=>[p,{x:p.x+dx,z:p.z+dz}])
}
function sharedFootingPair(a: SiteSection, b: SiteSection, width: number) {
  return footingStations(a,width).some(pair=>footingStations(b,width).some(other=>pair.every(p=>other.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<EPS))))
}
export function groupSections(sections: SiteSection[], wallIds = new Set<string>(), width = 0) {
  const groups: SiteSection[][] = []
  const indices = new Map(sections.map((section, i) => [section.id, i]))
  const remaining = new Set(sections)
  for (const first of sections) {
    if (!remaining.delete(first)) continue
    const group = [first]
    for (const current of group) for (const candidate of remaining) {
      if (candidate.surfaceId === current.surfaceId && (candidate.layers === current.layers || candidate.automatic && current.automatic)
        && wallIds.has(candidate.id) === wallIds.has(current.id) && (meetOnPlan(current, candidate) || width > 0 && wallIds.has(current.id) && sharedFootingPair(current, candidate, width))) {
        group.push(candidate); remaining.delete(candidate)
      }
    }
    groups.push(group.sort((a, b) => indices.get(a.id)! - indices.get(b.id)!))
  }
  return groups
}

