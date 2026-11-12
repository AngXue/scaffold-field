import type { ScaffoldMember } from '../scaffold.ts'
import type { ResolvedBlock } from '../site.ts'
import type { TransitionEnd } from './facts/transitions.ts'
import { wallGuardRemovals, sharedCapRemovals, type SharedStation } from './policies/guardRemovals.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'
type Facts = { members: ScaffoldMember[]; ends: [number, TransitionEnd[]][]; blocks: ResolvedBlock[]; followsWall: boolean; clearance: number;
  stations: SharedStation[]; wall?: string[]; shared?: string[] }
type Change = Proposal & ({ kind: 'WallGuardRemovals'; target: 'wall'; value: string[] } | { kind: 'SharedCapRemovals'; target: 'shared'; value: string[] })
export const GUARD_REMOVAL_STEPS: RuleStep<Facts, Change>[] = [
  { id: 'P04.wallGuards', ruleId: 'P04', phase: 5, after: [], reads: ['members', 'ends', 'blocks', 'followsWall', 'clearance'], kinds: ['WallGuardRemovals'], targets: ['wall'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'WallGuardRemovals', target: 'wall', expectedRevision: revision,
      value: wallGuardRemovals(facts.members as ScaffoldMember[], facts.ends as [number, TransitionEnd[]][], facts.blocks as ResolvedBlock[], facts.followsWall!, facts.clearance!) }] }) },
  { id: 'P06.sharedCaps', ruleId: 'P06', phase: 5, after: [], reads: ['members', 'stations'], kinds: ['SharedCapRemovals'], targets: ['shared'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'SharedCapRemovals', target: 'shared', expectedRevision: revision,
      value: sharedCapRemovals(facts.members as ScaffoldMember[], facts.stations as SharedStation[]) }] }) },
]
const run = compilePipeline<Facts, Change>(RULES, GUARD_REMOVAL_STEPS, (facts, proposals) => {
  let result = { ...facts } as Facts
  const members = new Map(facts.members.map(member => [member.id, member]))
  for (const proposal of proposals) {
    if (proposal.value.some(id => members.get(id)?.type !== 'guardrail')) throw new Error('Guard removal must reference a known guard member')
    switch (proposal.kind) {
      case 'WallGuardRemovals': result = { ...result, wall: proposal.value }; break
      case 'SharedCapRemovals': result = { ...result, shared: proposal.value }; break
    }
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS,
  // Production borrows calculation-owned readonly geometry. Policies allocate
  // their changed entities privately; copying the entire scene here is redundant.
  // Development still clones/freezes every nested input to enforce that contract.
  snapshot: VERIFY_RULE_INPUTS ? undefined : facts => facts,
})
export function resolveGuardRemovals(input: Omit<Facts, 'wall' | 'shared'>) {
  const { facts } = run(input)
  return [...new Set([...facts.wall!, ...facts.shared!])]
}
