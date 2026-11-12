import type { ScaffoldParameters } from '../scaffold.ts'
import { resolvePostDemands, initialPostSequences, type PostInput, type PostDemand } from './policies/posts.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'
type Facts = { input: PostInput; parameters: ScaffoldParameters; posts?: PostDemand[]; sequences?: Record<string, number[]> }
type Change = Proposal & ({ kind: 'SharedPostDemands'; target: 'posts'; value: PostDemand[] } | { kind: 'InitialPostSequences'; target: 'sequences'; value: Record<string, number[]> })
export const POST_STEPS: RuleStep<Facts, Change>[] = [
  { id: 'G08.sharedPosts', ruleId: 'G08', phase: 3, after: [], reads: ['input'], kinds: ['SharedPostDemands'], targets: ['posts'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'SharedPostDemands', target: 'posts', expectedRevision: revision,
      value: resolvePostDemands(facts.input as PostInput) }] }) },
  { id: 'S03.initialPosts', ruleId: 'S03', phase: 4, after: ['G08.sharedPosts'], reads: ['posts', 'parameters'], kinds: ['InitialPostSequences'], targets: ['sequences'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'InitialPostSequences', target: 'sequences', expectedRevision: revision,
      value: initialPostSequences(facts.posts as PostDemand[], facts.parameters as ScaffoldParameters) }] }) },
]
const run = compilePipeline<Facts, Change>(RULES, POST_STEPS, (facts, proposals) => {
  let result = { ...facts } as Facts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'SharedPostDemands': {
      if (new Set(proposal.value.map(post => post.key)).size !== proposal.value.length) throw new Error('Duplicate physical post demand')
      result = { ...result, posts: proposal.value }; break
    }
    case 'InitialPostSequences': result = { ...result, sequences: proposal.value }; break
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS })
export function startPosts(input: PostInput, parameters: ScaffoldParameters) {
  const stage = run.start({ input, parameters })
  return { advance: (phase: import('./contracts.ts').Phase) => {
    const { facts } = stage.advance(phase)
    return { posts: facts.posts as PostDemand[], sequences: facts.sequences as Record<string, number[]> }
  } }
}
export function resolvePosts(input: PostInput, parameters: ScaffoldParameters) {
  return startPosts(input, parameters).advance(4)
}
