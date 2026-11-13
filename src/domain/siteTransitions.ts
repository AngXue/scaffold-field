import { fitGuardrailStock } from './guardrails.ts'
import { selectFittingPlans } from './rules/facts/fittings.ts'
import { inFrameScopes } from './rules/facts/scopes.ts'
import { RETIRED_USES } from './rules/facts/memberUses.ts'
import type { ScaffoldAssembly } from './rules/facts/draft.ts'
import { positionStock } from './rules/placement.ts'
import { assembleConnectedRuns, type ScaffoldLayout, type ScaffoldParameters } from './scaffold.ts'
import type { SectionSummary } from './site.ts'
import type { RoutedSpan, SiteTransition } from './siteRouting.ts'

import { resolveTransitions, finishTransitions, type PreparedTransitions } from './rules/transitions.ts'
import type { JoinedLift, TransitionEnd, Bridge } from './rules/facts/transitions.ts'
export type { JoinedLift, TransitionEnd } from './rules/facts/transitions.ts'

export { isWallEndGuard } from './rules/policies/guardRemovals.ts'

export function fitTransitionStock(layout: Pick<ScaffoldLayout, 'members' | 'pipeSegments' | 'connectors'>,
  constraints: Map<number, TransitionEnd[]>, radius: number) {
  if (constraints.size) positionStock(layout, { transitions: [...constraints], cells: [], obstacles: [], radius, walkway: false })
}

export function connectSiteTransitions(layout: ScaffoldAssembly, spans: RoutedSpan[], summaries: SectionSummary[],
  transitions: SiteTransition[], settings: ScaffoldParameters, preparation?: { prepared: PreparedTransitions; aliases: ReadonlyMap<string, string> }, deferPlacement = false) {
  if (!transitions.length) return { layout, joined: [] as JoinedLift[], failed: [] as SiteTransition[], bridges: [] as Bridge[], affected: [] as string[] }
  const { plan, opened } = preparation ? finishTransitions(preparation.prepared, layout.members, preparation.aliases) : resolveTransitions({ members: layout.members, decks: layout.decks, posts: layout.pipeSegments.filter(pipe => pipe.type === 'post'), spans, summaries, transitions, settings })
  const { joined, failed, bridges } = plan
  if (!opened) return { layout, joined, failed, bridges, affected: [] as string[] }
  const groups = new Set(opened.groups)
  const affectedIds = new Set(layout.members.filter(member => inFrameScopes(member, groups)).map(member => member.id))
  const affected = (id: string) => affectedIds.has(id)
  const assembled = assembleConnectedRuns(layout, opened.members, opened.decks, settings, deferPlacement)
  const combinedMembers = [...layout.members.filter(member => !affected(member.id)), ...assembled.members]
  const pipes = [...layout.pipeSegments.filter(pipe => !affected(pipe.memberId)), ...assembled.pipeSegments]
  const combinedDecks = [...layout.decks.filter(deck => !inFrameScopes(deck, groups)), ...assembled.decks]
  const fittingPlans = [...selectFittingPlans(layout.fittingPlans, id => !affected(id)), ...assembled.fittingPlans]
  const fittings = [...layout.connectors.filter(connector => !affected(connector.memberId)), ...assembled.connectors]
  const plans = [...layout.assemblyPlans.filter(plan => !affected(plan.memberId)), ...assembled.assemblyPlans]
  return { layout: { ...layout, [RETIRED_USES]: [...(layout[RETIRED_USES] ?? []), ...opened.retired], fittingPlans, members: combinedMembers, pipeSegments: pipes, decks: combinedDecks, connectors: fittings, assemblyPlans: plans }, joined, failed, bridges, affected: [...groups], place: deferPlacement ? () => fitGuardrailStock(assembled) : undefined }
}
