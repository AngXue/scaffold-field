import { positionStock } from './rules/placement.ts'
import { calculateMaterials, reassembleSiteRuns, type ScaffoldLayout, type ScaffoldParameters } from './scaffold.ts'
import type { SectionSummary } from './site.ts'
import type { RoutedSpan, SiteTransition } from './siteRouting.ts'

import { resolveTransitions } from './rules/transitions.ts'
import type { JoinedLift, TransitionEnd, Bridge } from './rules/facts/transitions.ts'
export type { JoinedLift, TransitionEnd } from './rules/facts/transitions.ts'

export { isWallEndGuard } from './rules/policies/guardRemovals.ts'

export function fitTransitionStock(layout: Pick<ScaffoldLayout, 'members' | 'pipeSegments' | 'connectors'>,
  constraints: Map<number, TransitionEnd[]>, radius: number) {
  if (constraints.size) positionStock(layout, { transitions: [...constraints], cells: [], obstacles: [], radius, walkway: false })
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
