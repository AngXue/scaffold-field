import { memberUses } from './rules/facts/memberUses.ts'
import { calculateMaterials, reassembleSiteRuns, type ScaffoldLayout, type ScaffoldParameters, type Vector3Tuple } from './scaffold.ts'
import { mm, type SectionSummary } from './site.ts'
import type { RoutedSpan, SiteTransition } from './siteRouting.ts'

import { resolveTransitions } from './rules/transitions.ts'
import type { JoinedLift, TransitionEnd, Bridge } from './rules/facts/transitions.ts'
export type { JoinedLift, TransitionEnd } from './rules/facts/transitions.ts'

export { isWallEndGuard } from './rules/policies/guardRemovals.ts'

/** Move stock surplus away from the higher face without shortening a tube or moving its ties. */
export function fitTransitionStock(layout: Pick<ScaffoldLayout, 'members' | 'pipeSegments' | 'connectors'>,
  constraints: Map<number, TransitionEnd[]>, radius: number) {
  if (!constraints.size) return
  const pipesByMember = new Map<string, ScaffoldLayout['pipeSegments']>()
  const buttByMember = new Map<string, ScaffoldLayout['connectors']>()
  for (const pipe of layout.pipeSegments) {
    const pipes = pipesByMember.get(pipe.memberId) ?? []
    pipes.push(pipe); pipesByMember.set(pipe.memberId, pipes)
  }
  for (const connector of layout.connectors) if (connector.type === 'butt') {
    const fittings = buttByMember.get(connector.memberId) ?? []
    fittings.push(connector); buttByMember.set(connector.memberId, fittings)
  }
  for (const member of layout.members) {
    if (member.type !== 'longitudinal' && member.type !== 'guardrail') continue
    const sources = memberUses(member).map(use => use.pathSegment)
    const ends = [...new Set(sources.length ? sources : [member.pathSegment ?? -1])].flatMap(index => constraints.get(index) ?? [])
    const axis = mm(member.start[0]) === mm(member.end[0]) ? 2 : 0
    const cross = axis === 0 ? 2 : 0
    if (mm(member.start[cross]) !== mm(member.end[cross])) continue
    const relevant = ends.filter(end => end.axis === axis && member.start[1] < end.roof + radius
      && member.connectionPoints.some(point => mm(point[axis]) === mm(end.station)))
    const pipes = pipesByMember.get(member.id)
    if (!relevant.length || !pipes?.length) continue
    const points = pipes.flatMap(pipe => [pipe.start[axis], pipe.end[axis]])
    const stockLow = Math.min(...points), stockHigh = Math.max(...points)
    let lower = Math.max(member.start[axis], member.end[axis]) - stockHigh
    let upper = Math.min(member.start[axis], member.end[axis]) - stockLow
    for (const end of relevant) {
      if (end.towardRoof > 0) upper = Math.min(upper, end.boundary - radius - 0.002 - stockHigh)
      else lower = Math.max(lower, end.boundary + radius + 0.002 - stockLow)
    }
    if (lower > upper + 1e-6) continue
    const shift = Math.max(lower, Math.min(0, upper))
    if (Math.abs(shift) < 1e-6) continue
    const moved = (point: Vector3Tuple): Vector3Tuple => point.map((value, i) => i === axis ? value + shift : value) as Vector3Tuple
    for (const pipe of pipes) { pipe.start = moved(pipe.start); pipe.end = moved(pipe.end) }
    for (const fitting of buttByMember.get(member.id) ?? []) fitting.position = moved(fitting.position)
  }
}

export function connectSiteTransitions(layout: ScaffoldLayout, spans: RoutedSpan[], summaries: SectionSummary[],
  transitions: SiteTransition[], settings: ScaffoldParameters) {
  if (!transitions.length) return { layout, joined: [] as JoinedLift[], failed: [] as SiteTransition[], bridges: [] as Bridge[] }
  const { plan, opened } = resolveTransitions({ members: layout.members, decks: layout.decks, posts: layout.pipeSegments.filter(pipe => pipe.type === 'post'), spans, summaries, transitions, settings })
  const { joined, failed, bridges } = plan
  if (!opened) return { layout, joined, failed, bridges }
  const groups = new Set(opened.groups), affected = (id: string) => groups.has(id.split('/')[0])
  const rebuilt = reassembleSiteRuns(layout, opened.members, opened.decks, settings)
  const combinedMembers = [...layout.members.filter(member => !affected(member.id)), ...rebuilt.members]
  const pipes = [...layout.pipeSegments.filter(pipe => !affected(pipe.memberId)), ...rebuilt.pipeSegments]
  const combinedDecks = [...layout.decks.filter(deck => !affected(deck.id)), ...rebuilt.decks]
  const fittings = [...layout.connectors.filter(connector => !affected(connector.memberId)), ...rebuilt.connectors]
  const plans = [...layout.materials.assemblyPlans.filter(plan => !affected(plan.memberId)), ...rebuilt.materials.assemblyPlans]
  const materials = calculateMaterials(combinedMembers, pipes, combinedDecks, fittings, layout.baseChannels, settings, plans, layout.materials.postHeights)
  return { layout: { ...layout, members: combinedMembers, pipeSegments: pipes, decks: combinedDecks, connectors: fittings, materials }, joined, failed, bridges }
}
