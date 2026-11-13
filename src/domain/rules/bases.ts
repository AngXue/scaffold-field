import type { BaseChannel, ScaffoldMember } from '../scaffold.ts'
import { baseCandidates, retainSupportingBases, type BaseInput } from './policies/bases.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'
type Facts = { input?: BaseInput; candidates?: BaseChannel[]; posts?: ScaffoldMember[]; kept?: BaseChannel[] }
type Change = Proposal & ({ kind: 'BaseCandidates'; target: 'candidates'; value: BaseChannel[] } | { kind: 'RetainSupportingBases'; target: 'kept'; value: BaseChannel[] })
export const BASE_STEPS: RuleStep<Facts, Change>[] = [
  { id: 'M07.baseCandidates', ruleId: 'M07', phase: 3, after: [], reads: ['input'], kinds: ['BaseCandidates'], targets: ['candidates'],
    evaluate: (facts, revision) => facts.input ? ({ status: 'proposed', proposals: [{ kind: 'BaseCandidates', target: 'candidates', expectedRevision: revision,
      value: baseCandidates(facts.input as BaseInput) }] }) : ({ status: 'not-applicable', reason: 'Existing component bases supplied for support reconciliation' }) },
  { id: 'M07.supportingBases', ruleId: 'M07', phase: 3, after: [], reads: ['candidates', 'posts'], kinds: ['RetainSupportingBases'], targets: ['kept'],
    evaluate: (facts, revision) => facts.posts ? ({ status: 'proposed', proposals: [{ kind: 'RetainSupportingBases', target: 'kept', expectedRevision: revision,
      value: retainSupportingBases(facts.candidates as BaseChannel[], facts.posts as ScaffoldMember[]) }] }) : ({ status: 'not-applicable', reason: 'Final physical posts have not been emitted' }) },
]
const compile = (steps: RuleStep<Facts, Change>[]) => compilePipeline<Facts, Change>(RULES, steps, (facts, proposals) => {
  let result = { ...facts } as Facts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'BaseCandidates': result = { ...result, candidates: proposal.value }; break
    case 'RetainSupportingBases': result = { ...result, kept: proposal.value }; break
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS,
  // These pure policies read calculation-owned facts and allocate their changes.
  // Development still clones/freezes the full snapshot to verify that contract.
  snapshot: VERIFY_RULE_INPUTS ? undefined : facts => facts,
})
// Candidate generation and later reconciliation have separate entry contracts.
// Supplied candidates are already committed; a support pass only reads committed post demands.
const runCandidates = compile(BASE_STEPS.filter(step => step.id === 'M07.baseCandidates'))
const runSupporting = compile(BASE_STEPS.filter(step => step.id === 'M07.supportingBases'))
export function resolveBaseCandidates(input: BaseInput): BaseChannel[] {
  return runCandidates({ input }).facts.candidates!.map(base => ({ ...base })) as BaseChannel[]
}
export function resolveSupportingBases(candidates: BaseChannel[], members: ScaffoldMember[]): BaseChannel[] {
  // The post projection excludes horizontal geometry and its provenance graph.
  const posts = members.filter(member => member.type === 'post')
  return runSupporting({ candidates, posts }).facts.kept!.map(base => ({ ...base })) as BaseChannel[]
}
