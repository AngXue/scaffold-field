import { calculateMaterials, deckBetweenStations, reassembleSiteRuns, type DeckPanel, type ScaffoldLayout, type ScaffoldMember, type ScaffoldParameters, type Vector3Tuple } from './scaffold.ts'
import { mm, roundSite, type SectionSummary } from './site.ts'
import type { RoutedSpan, SiteTransition } from './siteRouting.ts'

export type JoinedLift = { before: string; after: string; levels: number[] }
type Bridge = { left: number; right: number; rails: ScaffoldMember[]; decks: DeckPanel[] }

export function connectSiteTransitions(layout: ScaffoldLayout, spans: RoutedSpan[], summaries: SectionSummary[],
  transitions: SiteTransition[], settings: ScaffoldParameters) {
  const joined: JoinedLift[] = [], bridges: Bridge[] = [], failed: SiteTransition[] = []
  if (!transitions.length) return { layout, joined, failed, bridges }
  const summaryById = new Map(summaries.map(s => [s.id, s]))
  const spanIndex = new Map(spans.map((s, i) => [s.line.id, i]))
  const pointMm = (p: Vector3Tuple): Vector3Tuple => [roundSite(p[0]), roundSite(p[1]), roundSite(p[2])]
  const members = layout.members.map(member => {
    const section = member.pathSegment === undefined ? undefined : summaryById.get(spans[member.pathSegment]?.line.id)
    return { ...member, start: pointMm(member.start), end: pointMm(member.end), connectionPoints: member.connectionPoints.map(pointMm),
      layer: member.layer && section ? member.layer + section.firstLayer - 1 : member.layer }
  })
  const decks = layout.decks.map(deck => {
    const section = summaryById.get(spans[deck.pathSegment]?.line.id)
    return { ...deck, layer: deck.layer + (section?.firstLayer ?? 1) - 1 }
  })
  const links: ScaffoldMember[] = [], panels: DeckPanel[] = []
  const remove = new Set<string>()
  for (const { before, after } of transitions) {
    const left = spanIndex.get(before.id)!, right = spanIndex.get(after.id)!
    const linkStart = links.length, panelStart = panels.length
    const along = before.start.x === before.end.x ? 2 : 0, cross = along === 0 ? 2 : 0
    const a = along === 0 ? before.end.x : before.end.z, b = along === 0 ? after.start.x : after.start.z
    const gap = Math.abs(b - a)
    const shared = (summaryById.get(before.id)?.levels ?? []).filter(y => summaryById.get(after.id)?.levels.includes(y))
    const levels: number[] = []
    const ends = (index: number, station: number) => members.flatMap(member => {
      if (member.pathSegment !== index || !member.layer || (member.type !== 'longitudinal' && member.type !== 'guardrail')
        || mm(member.start[cross]) !== mm(member.end[cross])) return []
      const point = member.connectionPoints.find(p => mm(p[along]) === mm(station))
      return point ? [{ member, point }] : []
    })
    const first = ends(left, a), second = ends(right, b)
    const hasPanel = (index: number, layer: number, station: number) => decks.some(deck => deck.pathSegment === index
      && deck.layer === layer && deck.corners.some(p => mm(p[along]) === mm(station)))
    if (gap < 0.001 || gap > settings.postSpacing + 0.001) { failed.push({ before, after }); continue }
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
          start, end, length: roundSite(gap), connectionPoints: [start, end] })
        if (from.member.type !== 'guardrail') continue
        for (const cap of members) {
          const station = cap.pathSegment === left ? a : cap.pathSegment === right ? b : undefined
          if (station !== undefined && cap.type === 'guardrail' && cap.layer === layer && mm(cap.start[1]) === mm(start[1])
            && cap.connectionPoints.every(p => mm(p[along]) === mm(station))) remove.add(cap.id)
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
      bridges.push({ left, right, rails: links.slice(linkStart), decks: panels.slice(panelStart) })
    }
    if (levels.length !== shared.length) failed.push({ before, after })
  }
  if (!links.length) return { layout, joined, failed, bridges }
  const joinedIndices = new Set(bridges.flatMap(bridge => [bridge.left, bridge.right]))
  const groupOf = (id: string) => id.split('/')[0]
  const groups = new Set(members.filter(member => joinedIndices.has(member.pathSegment ?? -1)).map(member => groupOf(member.id)))
  const affected = (id: string) => groups.has(groupOf(id))
  const rebuilt = reassembleSiteRuns(layout, [...members.filter(member => affected(member.id) && !remove.has(member.id)), ...links],
    [...decks.filter(deck => affected(deck.id)), ...panels], settings)
  const combinedMembers = [...layout.members.filter(member => !affected(member.id)), ...rebuilt.members]
  const pipes = [...layout.pipeSegments.filter(pipe => !affected(pipe.memberId)), ...rebuilt.pipeSegments]
  const combinedDecks = [...layout.decks.filter(deck => !affected(deck.id)), ...rebuilt.decks]
  const fittings = [...layout.connectors.filter(connector => !affected(connector.memberId)), ...rebuilt.connectors]
  const plans = [...layout.materials.assemblyPlans.filter(plan => !affected(plan.memberId)), ...rebuilt.materials.assemblyPlans]
  const materials = calculateMaterials(combinedMembers, pipes, combinedDecks, fittings, layout.baseChannels, settings, plans, layout.materials.postHeights)
  return { layout: { ...layout, members: combinedMembers, pipeSegments: pipes, decks: combinedDecks, connectors: fittings, materials }, joined, failed, bridges }
}
