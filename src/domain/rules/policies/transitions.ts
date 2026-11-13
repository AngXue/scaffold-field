import { MEMBER_USES, memberUses, makeUse, clipUses, hasSource, type RetiredUse } from '../facts/memberUses.ts'
import { deckBetweenStations } from './decks.ts'
import type { DeckPanel, ScaffoldMember, ScaffoldParameters, Vector3Tuple, PipeSegment } from '../../scaffold.ts'
import { mm, roundSite } from '../facts/precision.ts'
import type { SectionSummary } from '../../site.ts'
import type { RoutedSpan, SiteTransition } from '../../siteRouting.ts'
import type { JoinedLift, Bridge, CapCut } from '../facts/transitions.ts'

export function prepareTransitionGeometry(sourceMembers: ScaffoldMember[], sourceDecks: DeckPanel[], spans: RoutedSpan[], summaries: SectionSummary[]) {
  const summaryById = new Map(summaries.map(s => [s.id, s]))
  const pointMm = (p: Vector3Tuple): Vector3Tuple => [roundSite(p[0]), roundSite(p[1]), roundSite(p[2])]
  const members = sourceMembers.map(member => {
    const section = member.pathSegment === undefined ? undefined : summaryById.get(spans[member.pathSegment]?.line.id)
    return { ...member, [MEMBER_USES]: memberUses(member).map(use => ({ ...use, sectionId: spans[use.pathSegment]?.sourceId ?? use.sectionId, spanId: spans[use.pathSegment]?.line.id ?? use.spanId })), start: pointMm(member.start), end: pointMm(member.end), connectionPoints: member.connectionPoints.map(pointMm),
      layer: member.layer && section ? member.layer + section.firstLayer - 1 : member.layer }
  })
  const decks = sourceDecks.map(deck => {
    const section = summaryById.get(spans[deck.pathSegment]?.line.id)
    return { ...deck, layer: deck.layer + (section?.firstLayer ?? 1) - 1 }
  })

  return { members, decks }
}
export type TransitionGeometry = ReturnType<typeof prepareTransitionGeometry>
export function actualPostTops(pipes: readonly PipeSegment[]): Record<string, number> {
  const tops: Record<string, number> = {}
  for (const pipe of pipes) if (pipe.type === 'post') tops[pipe.memberId] = Math.max(tops[pipe.memberId] ?? -Infinity, pipe.start[1], pipe.end[1])
  return tops
}
export function planTransitions(geometry: TransitionGeometry, tops: Record<string, number>, spans: RoutedSpan[], summaries: SectionSummary[], transitions: SiteTransition[], settings: ScaffoldParameters) {
  const { members, decks } = geometry, postTops = new Map(Object.entries(tops))
  const summaryById = new Map(summaries.map(summary => [summary.id, summary])), spanIndex = new Map(spans.map((span, index) => [span.line.id, index]))
  const joined: JoinedLift[] = [], bridges: Bridge[] = [], failed: SiteTransition[] = []
  const links: ScaffoldMember[] = [], panels: DeckPanel[] = []
  const capCuts = new Map<string, Array<{ axis: 0 | 2; low: number; high: number }>>()
  for (const transition of transitions) {
    const { before, after } = transition
    const left = spanIndex.get(before.id)!, right = spanIndex.get(after.id)!
    const linkStart = links.length, panelStart = panels.length
    const along = before.start.x === before.end.x ? 2 : 0, cross = along === 0 ? 2 : 0
    const a = along === 0 ? before.end.x : before.end.z, b = along === 0 ? after.start.x : after.start.z
    const gap = Math.abs(b - a)
    const shared = (summaryById.get(before.id)?.levels ?? []).filter(y => summaryById.get(after.id)?.levels.includes(y))
    const levels: number[] = []
    const ends = (index: number, station: number) => {
      const own = members.flatMap(member => {
        if (!hasSource(member, index) || !member.layer || (member.type !== 'longitudinal' && member.type !== 'guardrail')
          || mm(member.start[cross]) !== mm(member.end[cross])) return []
        const point = member.connectionPoints.find(p => mm(p[along]) === mm(station))
        return point ? [{ member, point }] : []
      })
      // A short inward return can have no longitudinal guard of its own: it
      // finishes at the corner post already carrying the adjacent face's guard.
      // That real supported corner is also a valid end for the transition rail.
      const span = spans[index], line = span.line
      const direction = Math.sign(along === 0 ? line.end.x - line.start.x : line.end.z - line.start.z)
      const offset = span.wall || settings.swapInnerOuter ? settings.width * direction * (along === 0 ? 1 : -1) : 0
      const outside = (cross === 0 ? line.start.x : line.start.z) + offset
      const base = summaryById.get(line.id)!.base
      const posts = members.filter(m => m.type === 'post' && mm(m.start[along]) === mm(station)
        && mm(m.start[cross]) === mm(outside) && mm(m.start[1]) === mm(base))
      if (!posts.length) return own
      for (const member of members) {
        if (member.type !== 'guardrail' || !member.layer
          || !memberUses(member).some(use => spans[use.pathSegment]?.line.surfaceId === line.surfaceId)) continue
        const point: Vector3Tuple = along === 0 ? [station,member.start[1],outside] : [outside,member.start[1],station]
        if (!posts.some(post => point[1] >= post.start[1] && point[1] <= (postTops.get(post.id) ?? post.end[1]) + 0.001)
          || !member.connectionPoints.some(p => p.every((v,i) => mm(v) === mm(point[i])))
          || own.some(item => item.member.type === 'guardrail' && item.member.layer === member.layer && item.point.every((v,i) => mm(v) === mm(point[i])))) continue
        own.push({member,point})
      }
      return own
    }
    const first = ends(left, a), second = ends(right, b)
    const hasPanel = (index: number, layer: number, station: number) => decks.some(deck => deck.pathSegment === index
      && deck.layer === layer && deck.corners.some(p => mm(p[along]) === mm(station)))
    if (gap < 0.001 || gap > settings.postSpacing + 0.001) { failed.push(transition); continue }
    for (const elevation of shared) {
      const layer = Math.round(elevation / settings.liftHeight)
      const matches = first.filter(item => item.member.layer === layer).flatMap(from => {
        const to = second.find(to => to.member.layer === layer && to.member.type === from.member.type
          && mm(to.point[1]) === mm(from.point[1]) && mm(to.point[cross]) === mm(from.point[cross]))
        return to ? [{ from, to }] : []
      })
      const rails = matches.filter(({ from }) => from.member.type === 'longitudinal' && mm(from.point[1]) === mm(elevation))
        .sort((p, q) => p.from.point[cross] - q.from.point[cross])
      if (rails.length < 2 || Math.abs(rails.at(-1)!.from.point[cross] - rails[0].from.point[cross] - settings.width) > 0.002) continue
      levels.push(elevation)
      for (const { from, to } of matches) {
        const start = from.point, end = to.point
        links.push({ id: `transition-${links.length + 1}`, type: from.member.type, layer, pathSegment: left,
          start, end, length: roundSite(gap), connectionPoints: [start, end],
          [MEMBER_USES]: [left, right].map(index => ({ ...makeUse(index, from.member.type === 'guardrail' ? 'bridge-guard' : 'bridge-working', start, end, 'P05'), sectionId: spans[index].sourceId, spanId: spans[index].line.id })) })
        if (from.member.type !== 'guardrail') continue
        for (const cap of members) {
          if (cap.type !== 'guardrail' || cap.layer !== layer || mm(cap.start[1]) !== mm(start[1])) continue
          const low = rails[0].from.point[cross], high = rails.at(-1)!.from.point[cross]
          // A cap may have merged into the adjoining face's longitudinal guard.
          // Find its geometry, not its surviving owner, and cut only the interior
          // return between the two post rows. Keep the adjoining outside guard.
          if (![a,b].some(station => cap.connectionPoints.every(p => mm(p[along]) === mm(station))
            && [low,high].every(at => cap.connectionPoints.some(p => mm(p[cross]) === mm(at))))) continue
          const cuts = capCuts.get(cap.id) ?? []
          cuts.push({axis:cross,low,high}); capCuts.set(cap.id,cuts)
        }
      }
      if (hasPanel(left, layer, a) && hasPanel(right, layer, b)) {
        const sides = [rails[0], rails.at(-1)!]
        const from: [Vector3Tuple, Vector3Tuple] = [sides[0].from.point, sides[1].from.point]
        const to: [Vector3Tuple, Vector3Tuple] = [sides[0].to.point, sides[1].to.point]
        panels.push(...deckBetweenStations(from, to, layer, left, `transition-deck-${left}-${right}-${layer}`, settings))
      }
    }
    if (levels.length) {
      joined.push({ before: before.id, after: after.id, levels })
      // Keep a separate bridge envelope; final runs may extend far beyond it.
      // The pure merge also preserves this snapshot for validation.
      bridges.push({ left, right, rails: links.slice(linkStart).map(rail => ({...rail})), decks: panels.slice(panelStart) })
    }
    if (levels.length !== shared.length) failed.push(transition)
  }

  return { joined, bridges, failed, links, panels, capCuts: [...capCuts] as [string, CapCut[]][] }
}
export type TransitionPlan = ReturnType<typeof planTransitions>
export function openTransitionCaps(geometry: TransitionGeometry, plan: TransitionPlan) {
  const { members, decks } = geometry, { bridges, links, panels } = plan, capCuts = new Map(plan.capCuts)
  const retired: RetiredUse[] = []
  const openCaps = (member: ScaffoldMember): ScaffoldMember[] => {
    const cuts = capCuts.get(member.id)
    if (!cuts?.length) return [member]
    const axis = cuts[0].axis
    let intervals = [[Math.min(member.start[axis],member.end[axis]),Math.max(member.start[axis],member.end[axis])]]
    for (const {low,high} of cuts) intervals = intervals.flatMap(([a,b]) => high<=a || low>=b ? [[a,b]]
      : [[a,Math.min(b,low)],[Math.max(a,high),b]].filter(([l,r]) => r-l>0.001))
    const remaining = intervals.flatMap(([low,high],i) => {
      const points = member.connectionPoints.filter(p => p[axis]>=low-0.001 && p[axis]<=high+0.001)
      // Surplus alone is not a remaining rail. Retain a real supported run only.
      if (new Set(points.map(p => mm(p[axis]))).size<2) return []
      const at = (value: number): Vector3Tuple => member.start.map((n,j) => j===axis ? value : n) as Vector3Tuple
      return [{...member,id:i ? `${member.id}-open-${i}` : member.id,start:at(low),end:at(high),length:roundSite(high-low),connectionPoints:points,
        [MEMBER_USES]: clipUses(member, at(low), at(high), 'P06')}]
    })
    // A fully discarded purpose has no survivor on which to keep its origin.
    // Retain a compact tombstone beside the phase product, never a material item.
    const retained = remaining.flatMap(member => [...memberUses(member)])
    for (const use of memberUses(member)) {
      const survives = retained.some(other => other.pathSegment === use.pathSegment && other.sectionId === use.sectionId
        && other.spanId === use.spanId && other.purpose === use.purpose
        && Math.min(Math.max(other.start[axis], other.end[axis]), Math.max(use.start[axis], use.end[axis]))
          - Math.max(Math.min(other.start[axis], other.end[axis]), Math.min(use.start[axis], use.end[axis])) > 0.000001)
      if (!survives) retired.push({ use, rule: 'P06', reason: 'transition-cap' })
    }
    return remaining
  }
  const joinedIndices = new Set(bridges.flatMap(bridge => [bridge.left, bridge.right]))
  const groupOf = (id: string) => id.split('/')[0]
  const groups = new Set(members.filter(member => [...joinedIndices].some(index => hasSource(member, index)) || capCuts.has(member.id)).map(member => groupOf(member.id)))
  const affected = (id: string) => groups.has(groupOf(id))
  return { groups: [...groups], members: [...members.filter(member => affected(member.id)).flatMap(openCaps), ...links],
    decks: [...decks.filter(deck => affected(deck.id)), ...panels], retired }

}
