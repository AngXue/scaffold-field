import type { ScaffoldMember } from '../scaffold.ts'
import { memberUses } from './facts/memberUses.ts'
import { mergeSharedRuns } from './policies/sharedMembers.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'

type MergeFacts = { candidates: ScaffoldMember[]; members?: ScaffoldMember[] }
type MergeProposal = Proposal & { kind: 'MergeSharedMemberRuns'; target: 'members'; value: ScaffoldMember[] }
export const MERGE_STEPS: RuleStep<MergeFacts, MergeProposal>[] = [
  { id: 'M08.shared', ruleId: 'M08', phase: 6, after: [], reads: ['candidates'], kinds: ['MergeSharedMemberRuns'], targets: ['members'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'MergeSharedMemberRuns', target: 'members', expectedRevision: revision,
      value: mergeSharedRuns(facts.candidates as ScaffoldMember[]) }] }) },
]
// Protection resolves interval unions as candidate geometry. Physical sharing
// and stock assembly still commit through M08 at S6 after all protection settles.
export const CANDIDATE_STEPS: RuleStep<MergeFacts, MergeProposal>[] = [
  { ...MERGE_STEPS[0], id: 'P02.candidateIntervals', ruleId: 'P02', phase: 5 },
]
const compile = (steps: RuleStep<MergeFacts, MergeProposal>[]) => compilePipeline<MergeFacts, MergeProposal>(RULES, steps, (facts, proposals) => {
  const members = proposals.flatMap(proposal => proposal.value), source = new Set(facts.candidates.map(member => member.id))
  if (source.size !== facts.candidates.length || new Set(members.map(member => member.id)).size !== members.length || members.some(member => !source.has(member.id)))
    throw new Error('Duplicate or dangling merge result')
  if (VERIFY_RULE_INPUTS) {
    const key = (use: ReturnType<typeof memberUses>[number]) => JSON.stringify([use.pathSegment, use.sectionId, use.spanId, use.purpose, use.start, use.end])
    const kept = new Set(members.flatMap(member => memberUses(member).map(key)))
    if (facts.candidates.some(member => memberUses(member as ScaffoldMember).some(use => !kept.has(key(use))))) throw new Error('Merge lost a source or purpose interval')
  }
  return { ...facts, members } as MergeFacts
}, { verifyImmutability: VERIFY_RULE_INPUTS,
  // The production caller owns these calculation entities. The pure policy reads
  // them synchronously and creates replacements; no authored scene is borrowed.
  snapshot: VERIFY_RULE_INPUTS ? undefined : facts => facts,
})
const run = compile(MERGE_STEPS)
const candidates = compile(CANDIDATE_STEPS)
export function prepareMemberCandidates(members: ScaffoldMember[]): ScaffoldMember[] {
  if (!members.length) return []
  return candidates({ candidates: members }).facts.members!.map(member => ({ ...member })) as ScaffoldMember[]
}
export function mergeMemberStage(members: ScaffoldMember[]): ScaffoldMember[] {
  if (!members.length) return []
  return run({ candidates: members }).facts.members!.map(member => ({ ...member })) as ScaffoldMember[]
}
