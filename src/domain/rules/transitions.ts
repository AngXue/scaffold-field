import type { ScaffoldMember, DeckPanel, PipeSegment, ScaffoldParameters } from '../scaffold.ts'
import type { SectionSummary } from '../site.ts'
import type { RoutedSpan, SiteTransition } from '../siteRouting.ts'
import { prepareTransitionGeometry, actualPostTops, planTransitions, openTransitionCaps, type TransitionGeometry, type TransitionPlan } from './policies/transitions.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'
type Facts = { members: ScaffoldMember[]; decks: DeckPanel[]; posts: PipeSegment[]; spans: RoutedSpan[]; summaries: SectionSummary[];
  transitions: SiteTransition[]; settings: ScaffoldParameters; geometry?: TransitionGeometry; tops?: Record<string, number>; plan?: TransitionPlan; opened?: ReturnType<typeof openTransitionCaps> }
type Change = Proposal & (
  | { kind: 'GlobalTransitionGeometry'; target: 'geometry'; value: TransitionGeometry }
  | { kind: 'ActualPostTops'; target: 'tops'; value: Record<string, number> }
  | { kind: 'TransitionLinks'; target: 'plan'; value: TransitionPlan }
  | { kind: 'OpenTransitionCaps'; target: 'opened'; value: ReturnType<typeof openTransitionCaps> }
)
export const TRANSITION_STEPS: RuleStep<Facts, Change>[] = [
  { id: 'P05.globalGeometry', ruleId: 'P05', phase: 3, after: [], reads: ['members', 'decks', 'spans', 'summaries'], kinds: ['GlobalTransitionGeometry'], targets: ['geometry'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'GlobalTransitionGeometry', target: 'geometry', expectedRevision: revision,
      value: prepareTransitionGeometry(facts.members as ScaffoldMember[], facts.decks as DeckPanel[], facts.spans as RoutedSpan[], facts.summaries as SectionSummary[]) }] }) },
  { id: 'P07.actualPostTops', ruleId: 'P07', phase: 4, after: [], reads: ['posts'], kinds: ['ActualPostTops'], targets: ['tops'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'ActualPostTops', target: 'tops', expectedRevision: revision,
      value: actualPostTops(facts.posts as PipeSegment[]) }] }) },
  { id: 'P05.links', ruleId: 'P05', phase: 5, after: ['P05.globalGeometry', 'P07.actualPostTops'], reads: ['geometry', 'tops', 'spans', 'summaries', 'transitions', 'settings'], kinds: ['TransitionLinks'], targets: ['plan'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'TransitionLinks', target: 'plan', expectedRevision: revision,
      value: planTransitions(facts.geometry as TransitionGeometry, facts.tops as Record<string, number>, facts.spans as RoutedSpan[], facts.summaries as SectionSummary[], facts.transitions as SiteTransition[], facts.settings as ScaffoldParameters) }] }) },
  { id: 'P06.openCaps', ruleId: 'P06', phase: 5, after: ['P05.links'], reads: ['geometry', 'plan'], kinds: ['OpenTransitionCaps'], targets: ['opened'],
    evaluate: (facts, revision) => facts.plan!.links.length ? ({ status: 'proposed', proposals: [{ kind: 'OpenTransitionCaps', target: 'opened', expectedRevision: revision,
      value: openTransitionCaps(facts.geometry as TransitionGeometry, facts.plan as TransitionPlan) }] }) : ({ status: 'not-applicable', reason: 'No supported same-lift links; existing end protection remains' }) },
]
const run = compilePipeline<Facts, Change>(RULES, TRANSITION_STEPS, (facts, proposals) => {
  let result = { ...facts } as Facts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'GlobalTransitionGeometry': result = { ...result, geometry: proposal.value }; break
    case 'ActualPostTops': result = { ...result, tops: proposal.value }; break
    case 'TransitionLinks': {
      const ids = new Set(facts.geometry!.members.map(member => member.id))
      if (proposal.value.capCuts.some(([id]) => !ids.has(id))) throw new Error('Cap interval references an unknown member')
      result = { ...result, plan: proposal.value }; break
    }
    case 'OpenTransitionCaps': result = { ...result, opened: proposal.value }; break
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS,
  // Production borrows calculation-owned readonly geometry. Policies allocate
  // their changed entities privately; copying the entire scene here is redundant.
  // Development still clones/freezes every nested input to enforce that contract.
  snapshot: VERIFY_RULE_INPUTS ? undefined : facts => facts,
})
export function resolveTransitions(input: Omit<Facts, 'geometry' | 'tops' | 'plan' | 'opened'>, trace = false) {
  const result = run(input, { trace }), { facts } = result
  return { trace: result.trace, plan: facts.plan as TransitionPlan, opened: facts.opened && { groups: [...facts.opened.groups],
    members: facts.opened.members.map(member => ({ ...member })) as ScaffoldMember[], decks: facts.opened.decks.map(deck => ({ ...deck })) as DeckPanel[] } }
}
