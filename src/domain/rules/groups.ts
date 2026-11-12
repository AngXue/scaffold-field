import type { SiteSection } from '../site.ts'
import { groupSections } from './policies/groups.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { RuleStep, Proposal } from './contracts.ts'

type GroupFacts = { sections: SiteSection[]; wallIds: string[]; width: number; groups?: string[][] }
type GroupProposal = Proposal & { kind: 'GroupConnectedSupport'; target: 'groups'; value: string[][] }
export const GROUP_STEPS: RuleStep<GroupFacts, GroupProposal>[] = [
  { id: 'G07.components', ruleId: 'G07', phase: 2, after: [], reads: ['sections', 'wallIds', 'width'], kinds: ['GroupConnectedSupport'], targets: ['groups'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'GroupConnectedSupport', target: 'groups', expectedRevision: revision,
      value: groupSections(facts.sections as SiteSection[], new Set(facts.wallIds), facts.width).map(group => group.map(section => section.id)) }] }) },
]
const run = compilePipeline<GroupFacts, GroupProposal>(RULES, GROUP_STEPS, (facts, proposals) => {
  const groups = proposals.flatMap(proposal => proposal.value), assigned = groups.flat(), sources = new Set(facts.sections.map(section => section.id))
  if (assigned.length !== facts.sections.length || new Set(assigned).size !== assigned.length || assigned.some(id => !sources.has(id)))
    throw new Error('Missing, duplicate or dangling grouped section')
  return { ...facts, groups } as GroupFacts
}, { verifyImmutability: VERIFY_RULE_INPUTS })
export function componentGroups(sections: SiteSection[], wallIds = new Set<string>(), width = 0): SiteSection[][] {
  const inputs = sections.map(({ id, surfaceId, start, end, layers, automatic }) => ({ id, surfaceId, start, end, layers, automatic }))
  const { facts } = run({ sections: inputs, wallIds: [...wallIds], width })
  const source = new Map(sections.map(section => [section.id, section]))
  return facts.groups!.map(ids => ids.map(id => source.get(id)!))
}
