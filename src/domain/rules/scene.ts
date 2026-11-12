import { resolveBlocks, siteWithTargetLayers, type Site, type ResolvedBlock, type SiteIssue } from '../site.ts'
import type { ScaffoldParameters } from '../scaffold.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import type { Proposal, RuleStep } from './contracts.ts'

type SceneFacts = {
  site: Site
  parameters: ScaffoldParameters
  resolved?: { blocks: ResolvedBlock[]; issues: SiteIssue[] }
  prepared?: Site
}
type SceneProposal = Proposal & (
  | { kind: 'ResolveBlocks'; target: 'resolved'; value: { blocks: ResolvedBlock[]; issues: SiteIssue[] } }
  | { kind: 'ApplyLayerTargets'; target: 'prepared'; value: Site }
)
// Block resolution still uses its legacy adapter. Layer targets now use the
// extracted I04/I05 policy; both retain existing business semantics.
const steps: RuleStep<SceneFacts, SceneProposal>[] = [
  { id: 'I03.resolve', ruleId: 'I03', phase: 1, after: [], reads: ['site'], kinds: ['ResolveBlocks'], targets: ['resolved'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'ResolveBlocks', target: 'resolved', expectedRevision: revision,
      value: resolveBlocks(facts.site as Site) }] }) },
  { id: 'I05.targets', ruleId: 'I05', phase: 1, after: ['I03.resolve'], reads: ['site', 'parameters', 'resolved'], kinds: ['ApplyLayerTargets'], targets: ['prepared'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'ApplyLayerTargets', target: 'prepared', expectedRevision: revision,
      value: siteWithTargetLayers(facts.site as Site, facts.parameters as ScaffoldParameters, facts.resolved!.blocks as ResolvedBlock[]) }] }) },
]
const run = compilePipeline<SceneFacts, SceneProposal>(RULES, steps, (facts, proposals) => {
  let next = { ...facts } as SceneFacts
  for (const proposal of proposals) {
    switch (proposal.kind) {
      case 'ResolveBlocks': next = { ...next, resolved: proposal.value }; break
      case 'ApplyLayerTargets': next = { ...next, prepared: proposal.value }; break
    }
  }
  return next
})

export function prepareScene(site: Site, parameters: ScaffoldParameters, trace = false) {
  const result = run({ site, parameters }, { trace })
  return { site: result.facts.prepared as Site, blocks: result.facts.resolved!.blocks as ResolvedBlock[],
    parameters: result.facts.parameters as ScaffoldParameters, trace: result.trace }
}
