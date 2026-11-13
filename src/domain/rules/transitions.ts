import { DISPLAY_ID } from './facts/displayIdentity.ts'
import { mapParts } from './facts/partHistory.ts'
import type { RetiredUse } from './facts/memberUses.ts'
import type { ScaffoldMember, DeckPanel, PipeSegment, ScaffoldParameters } from '../scaffold.ts'
import type { SectionSummary } from '../site.ts'
import type { RoutedSpan, SiteTransition } from '../siteRouting.ts'
import { prepareTransitionGeometry, actualPostTops, planWorkingTransitions, planTransitions, openTransitionCaps, type TransitionGeometry, type TransitionPlan, type WorkingTransitions } from './policies/transitions.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'
type Facts = { members: ScaffoldMember[]; decks: DeckPanel[]; posts: PipeSegment[]; spans: RoutedSpan[]; summaries: SectionSummary[];
  transitions: SiteTransition[]; settings: ScaffoldParameters; geometry?: TransitionGeometry; working?: WorkingTransitions; guardGeometry?: TransitionGeometry; tops?: Record<string, number>; plan?: TransitionPlan; opened?: ReturnType<typeof openTransitionCaps> }
type Change = Proposal & (
  | { kind: 'GlobalTransitionGeometry'; target: 'geometry'; value: TransitionGeometry }
  | { kind: 'WorkingTransitionIntent'; target: 'working'; value: WorkingTransitions }
  | { kind: 'TransitionGuardGeometry'; target: 'guardGeometry'; value: TransitionGeometry }
  | { kind: 'ActualPostTops'; target: 'tops'; value: Record<string, number> }
  | { kind: 'TransitionLinks'; target: 'plan'; value: TransitionPlan }
  | { kind: 'OpenTransitionCaps'; target: 'opened'; value: ReturnType<typeof openTransitionCaps> }
)
export const TRANSITION_STEPS: RuleStep<Facts, Change>[] = [
  { id: 'P05.globalGeometry', ruleId: 'P05', phase: 3, after: [], reads: ['members', 'decks', 'spans', 'summaries'], kinds: ['GlobalTransitionGeometry'], targets: ['geometry'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'GlobalTransitionGeometry', target: 'geometry', expectedRevision: revision,
      value: prepareTransitionGeometry((facts.members as ScaffoldMember[]).filter(member => member.type !== 'guardrail'), facts.decks as DeckPanel[], facts.spans as RoutedSpan[], facts.summaries as SectionSummary[]) }] }) },
  { id: 'P05.workingLinks', ruleId: 'P05', phase: 3, after: ['P05.globalGeometry'], reads: ['geometry', 'spans', 'summaries', 'transitions', 'settings'], kinds: ['WorkingTransitionIntent'], targets: ['working'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'WorkingTransitionIntent', target: 'working', expectedRevision: revision,
      value: planWorkingTransitions(facts.geometry as TransitionGeometry, facts.spans as RoutedSpan[], facts.summaries as SectionSummary[], facts.transitions as SiteTransition[], facts.settings as ScaffoldParameters) }] }) },
  { id: 'P07.actualPostTops', ruleId: 'P07', phase: 4, after: [], reads: ['posts'], kinds: ['ActualPostTops'], targets: ['tops'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'ActualPostTops', target: 'tops', expectedRevision: revision,
      value: actualPostTops(facts.posts as PipeSegment[]) }] }) },
  { id: 'P05.guardGeometry', ruleId: 'P05', phase: 5, after: [], reads: ['members', 'geometry', 'spans', 'summaries'], kinds: ['TransitionGuardGeometry'], targets: ['guardGeometry'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'TransitionGuardGeometry', target: 'guardGeometry', expectedRevision: revision,
      value: attachTransitionGuards(facts.geometry as TransitionGeometry, facts.members as ScaffoldMember[], facts.spans as RoutedSpan[], facts.summaries as SectionSummary[]) }] }) },
  { id: 'P05.links', ruleId: 'P05', phase: 5, after: ['P05.guardGeometry'], reads: ['guardGeometry', 'working', 'tops', 'spans', 'summaries', 'transitions', 'settings'], kinds: ['TransitionLinks'], targets: ['plan'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'TransitionLinks', target: 'plan', expectedRevision: revision,
      value: planTransitions(facts.guardGeometry as TransitionGeometry, facts.tops as Record<string, number>, facts.spans as RoutedSpan[], facts.summaries as SectionSummary[], facts.transitions as SiteTransition[], facts.settings as ScaffoldParameters, facts.working as WorkingTransitions) }] }) },
  { id: 'P06.openCaps', ruleId: 'P06', phase: 5, after: ['P05.links'], reads: ['guardGeometry', 'plan'], kinds: ['OpenTransitionCaps'], targets: ['opened'],
    evaluate: (facts, revision) => facts.plan!.links.length ? ({ status: 'proposed', proposals: [{ kind: 'OpenTransitionCaps', target: 'opened', expectedRevision: revision,
      value: openTransitionCaps(facts.guardGeometry as TransitionGeometry, facts.plan as TransitionPlan) }] }) : ({ status: 'not-applicable', reason: 'No supported same-lift links; existing end protection remains' }) },
]
const compile = (steps: RuleStep<Facts, Change>[]) => compilePipeline<Facts, Change>(RULES, steps, (facts, proposals) => {
  let result = { ...facts } as Facts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'GlobalTransitionGeometry': result = { ...result, geometry: proposal.value }; break
    case 'WorkingTransitionIntent': result = { ...result, working: proposal.value }; break
    case 'TransitionGuardGeometry': result = { ...result, guardGeometry: proposal.value }; break
    case 'ActualPostTops': result = { ...result, tops: proposal.value }; break
    case 'TransitionLinks': {
      const ids = new Set(facts.guardGeometry!.members.map(member => member.id))
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
const runWorking = compile(TRANSITION_STEPS.filter(step => step.phase === 3))
const runPosts = compile(TRANSITION_STEPS.filter(step => step.phase === 4))
const runGuards = compile(TRANSITION_STEPS.filter(step => step.phase === 5))
export type TransitionInput = Pick<Facts, 'members' | 'decks' | 'posts' | 'spans' | 'summaries' | 'transitions' | 'settings'>
export function prepareTransitionWork(input: Omit<TransitionInput, 'posts'>, trace = false) {
  const result = runWorking({ ...input, posts: [] }, { trace })
  const { spans, summaries, transitions, settings } = input
  return { context: { spans, summaries, transitions, settings }, geometry: result.facts.geometry as TransitionGeometry,
    working: result.facts.working as WorkingTransitions, trace: result.trace }
}
export function commitTransitionPosts(prepared: ReturnType<typeof prepareTransitionWork>, posts: PipeSegment[], trace = false) {
  const result = runPosts({ ...prepared.context, members: [], decks: [], posts }, { trace })
  return { ...prepared, tops: result.facts.tops as Record<string, number>, trace: [...prepared.trace, ...result.trace] }
}
export type PreparedTransitions = ReturnType<typeof commitTransitionPosts>
/** Display aliases are restored at the boundary, never used to solve working geometry. */
function aliasPrepared(prepared: PreparedTransitions, aliases: ReadonlyMap<string, string>): PreparedTransitions {
  const alias = (id: string) => {
    const next = aliases.get(id)
    if (!next) throw new Error('Missing committed transition member alias')
    return next
  }
  const members = prepared.geometry.members.map(member => ({ ...member, [DISPLAY_ID]: alias(member.id) }))
  const byId = new Map(prepared.geometry.members.map((member, index) => [member.id, members[index]]))
  const match = (value: WorkingTransitions['intents'][number]['courses'][number]['matches'][number]) => ({
    from: { ...value.from, member: byId.get(value.from.member.id)! }, to: { ...value.to, member: byId.get(value.to.member.id)! },
  })
  return { ...prepared, geometry: { ...prepared.geometry, members },
    tops: prepared.tops,
    working: { ...prepared.working, intents: prepared.working.intents.map(intent => ({ ...intent,
      courses: intent.courses.map(course => ({ ...course, matches: course.matches.map(match), rails: course.rails.map(match) })) })) } }
}
function attachTransitionGuards(working: TransitionGeometry, sourceMembers: ScaffoldMember[], spans: RoutedSpan[], summaries: SectionSummary[]): TransitionGeometry {
  const normalized = prepareTransitionGeometry(sourceMembers, [], spans, summaries)
  const committed = new Map(working.members.map(member => [member.id, member])), seen = new Set<string>()
  const geometry = (member: ScaffoldMember) => JSON.stringify([member.type, member.layer, member.start, member.end, member.length, member.connectionPoints])
  const members = normalized.members.map(member => {
    if (member.type === 'guardrail') return member
    const fixed = committed.get(member.id)
    if (!fixed || geometry(fixed) !== geometry(member)) throw new Error('Protection cannot replace committed working geometry')
    seen.add(member.id)
    return fixed
  })
  if (seen.size !== committed.size) throw new Error('Protection cannot discard committed working geometry')
  return { members, decks: working.decks }
}
export function finishTransitions(prepared: PreparedTransitions, members: ScaffoldMember[], aliases?: ReadonlyMap<string, string>, trace = false) {
  if (aliases) prepared = aliasPrepared(prepared, aliases)
  const result = runGuards({ ...prepared.context, members, decks: prepared.geometry.decks, posts: [],
    geometry: prepared.geometry, working: prepared.working, tops: prepared.tops }, { trace }), { facts } = result
  return { trace: [...prepared.trace, ...result.trace], plan: facts.plan as TransitionPlan, opened: facts.opened && { groups: [...facts.opened.groups], retired: facts.opened.retired as RetiredUse[],
    members: facts.opened.members.map(member => ({ ...member })) as ScaffoldMember[], decks: mapParts(facts.opened.decks, deck => ({ ...deck })) as DeckPanel[] } }
}
export function resolveTransitions(input: TransitionInput, trace = false) {
  return finishTransitions(commitTransitionPosts(prepareTransitionWork(input, trace), input.posts, trace), input.members, undefined, trace)
}
