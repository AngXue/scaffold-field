import type { ScaffoldMember, DeckPanel, BaseChannel } from '../scaffold.ts'
import { sharedComponentPosts, uniqueComponentBases, componentDeckCoverage } from './policies/components.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'
type Facts = { members: ScaffoldMember[]; decks: DeckPanel[]; bases: BaseChannel[]; sequences: Record<string, number[]>;
  shared?: ReturnType<typeof sharedComponentPosts>; uniqueBases?: BaseChannel[]; coverage?: ReturnType<typeof componentDeckCoverage> }
type Change = Proposal & (
  | { kind: 'SharedComponentPosts'; target: 'shared'; value: ReturnType<typeof sharedComponentPosts> }
  | { kind: 'UniqueComponentBases'; target: 'uniqueBases'; value: BaseChannel[] }
  | { kind: 'ComponentCoverage'; target: 'coverage'; value: ReturnType<typeof componentDeckCoverage> }
)
export const COMPONENT_STEPS: RuleStep<Facts, Change>[] = [
  { id: 'G08.componentPosts', ruleId: 'G08', phase: 3, after: [], reads: ['members', 'sequences'], kinds: ['SharedComponentPosts'], targets: ['shared'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'SharedComponentPosts', target: 'shared', expectedRevision: revision,
      value: sharedComponentPosts(facts.members as ScaffoldMember[], facts.sequences as Record<string, number[]>) }] }) },
  { id: 'M07.componentBases', ruleId: 'M07', phase: 3, after: [], reads: ['bases'], kinds: ['UniqueComponentBases'], targets: ['uniqueBases'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'UniqueComponentBases', target: 'uniqueBases', expectedRevision: revision,
      value: uniqueComponentBases(facts.bases as BaseChannel[]) }] }) },
  { id: 'M06.componentCoverage', ruleId: 'M06', phase: 3, after: [], reads: ['decks'], kinds: ['ComponentCoverage'], targets: ['coverage'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'ComponentCoverage', target: 'coverage', expectedRevision: revision,
      value: componentDeckCoverage(facts.decks as DeckPanel[]) }] }) },
]
const run = compilePipeline<Facts, Change>(RULES, COMPONENT_STEPS, (facts, proposals) => {
  let result = { ...facts } as Facts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'SharedComponentPosts': result = { ...result, shared: proposal.value }; break
    case 'UniqueComponentBases': result = { ...result, uniqueBases: proposal.value }; break
    case 'ComponentCoverage': result = { ...result, coverage: proposal.value }; break
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS })
export function reconcileComponents(members: ScaffoldMember[], decks: DeckPanel[], bases: BaseChannel[], sequences: Record<string, number[]>) {
  const { facts } = run({ members, decks, bases, sequences })
  return { members: facts.shared!.members.map(member => ({ ...member })) as ScaffoldMember[],
    decks: facts.coverage!.decks.map(deck => ({ ...deck })) as DeckPanel[], bases: facts.uniqueBases!.map(base => ({ ...base })) as BaseChannel[],
    sequences: facts.shared!.sequences as Record<string, number[]>, overlap: facts.coverage!.overlap }
}
