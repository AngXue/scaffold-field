import { siteLength, type SiteSection, type ResolvedBlock, type SectionSummary, type SiteIssue } from '../site.ts'
import type { ScaffoldParameters } from '../scaffold.ts'
import { sectionFacts, sectionInputIssues, sweepIssues, type SectionFact, type OrderedIssue } from './policies/sectionValidation.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'
type Facts = { sections: SiteSection[]; blocks: ResolvedBlock[]; parameters: ScaffoldParameters; minimumLength: number;
  levels?: SectionFact[]; inputIssues?: OrderedIssue[]; sweepIssues?: OrderedIssue[] }
type Change = Proposal & (
  | { kind: 'SectionLevels'; target: 'levels'; value: SectionFact[] }
  | { kind: 'SectionInputIssues'; target: 'inputIssues'; value: OrderedIssue[] }
  | { kind: 'SweepIssues'; target: 'sweepIssues'; value: OrderedIssue[] }
)
export const SECTION_VALIDATION_STEPS: RuleStep<Facts, Change>[] = [
  { id: 'I04.sectionFacts', ruleId: 'I04', phase: 1, after: [], reads: ['sections', 'blocks', 'parameters'], kinds: ['SectionLevels'], targets: ['levels'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'SectionLevels', target: 'levels', expectedRevision: revision,
      value: sectionFacts(facts.sections as SiteSection[], facts.blocks as ResolvedBlock[], facts.parameters as ScaffoldParameters) }] }) },
  { id: 'V01.sectionInputs', ruleId: 'V01', phase: 2, after: [], reads: ['levels', 'minimumLength'], kinds: ['SectionInputIssues'], targets: ['inputIssues'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'SectionInputIssues', target: 'inputIssues', expectedRevision: revision,
      value: sectionInputIssues(facts.levels as SectionFact[], facts.minimumLength!) }] }) },
  { id: 'V02.sweepClearance', ruleId: 'V02', phase: 2, after: [], reads: ['levels', 'parameters'], kinds: ['SweepIssues'], targets: ['sweepIssues'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'SweepIssues', target: 'sweepIssues', expectedRevision: revision,
      value: sweepIssues(facts.levels as SectionFact[], facts.parameters as ScaffoldParameters) }] }) },
]
const compile = (steps: RuleStep<Facts, Change>[]) => compilePipeline<Facts, Change>(RULES, steps, (facts, proposals) => {
  let result = { ...facts } as Facts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'SectionLevels': result = { ...result, levels: proposal.value }; break
    case 'SectionInputIssues': result = { ...result, inputIssues: proposal.value }; break
    case 'SweepIssues': result = { ...result, sweepIssues: proposal.value }; break
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS,
  // Production borrows calculation-owned readonly geometry. Policies allocate
  // their changed entities privately; copying the entire scene here is redundant.
  // Development still clones/freezes every nested input to enforce that contract.
  snapshot: VERIFY_RULE_INPUTS ? undefined : facts => facts,
})
const runLevels = compile(SECTION_VALIDATION_STEPS.filter(step => step.phase === 1))
const runInputs = compile(SECTION_VALIDATION_STEPS.filter(step => step.phase === 2))
const footingKey = (section: SiteSection) => JSON.stringify([section.surfaceId, section.layers])
export function prepareSectionLevels(sections: SiteSection[], blocks: ResolvedBlock[], parameters: ScaffoldParameters) {
  const { facts } = runLevels({ sections, blocks, parameters, minimumLength: 0 })
  // Support and layer semantics are fixed in S1. S2 may relocate endpoints and
  // assign routed display IDs, but cannot silently recalculate those elevations.
  return new Map(sections.map((section, index) => [footingKey(section), facts.levels![index].summary as SectionSummary | undefined]))
}
export type PreparedSectionLevels = ReturnType<typeof prepareSectionLevels>
export function validateSectionInputs(sections: SiteSection[], blocks: ResolvedBlock[], parameters: ScaffoldParameters, minimumLength: number,
  prepared = prepareSectionLevels(sections, blocks, parameters)) {
  const levels = sections.map((section, index): SectionFact => {
    const key = footingKey(section)
    if (!prepared.has(key)) throw new Error('Station stage introduced an uncommitted footing or layer count')
    const fixed = prepared.get(key)
    return { index, id: section.id, summary: fixed && { ...fixed, id: section.id, length: siteLength(section) } }
  })
  const { facts } = runInputs({ sections, blocks, parameters, minimumLength, levels })
  return { summaries: facts.levels!.flatMap(section => section.summary ? [{ ...section.summary }] : []) as SectionSummary[],
    issues: [...facts.inputIssues!, ...facts.sweepIssues!].sort((a, b) => a.order - b.order).map(item => ({ ...item.issue, sectionIds: [...item.issue.sectionIds] })) as SiteIssue[] }
}
