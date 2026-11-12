import type { SiteSection, ResolvedBlock, SectionSummary, SiteIssue } from '../site.ts'
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
  { id: 'V01.sectionInputs', ruleId: 'V01', phase: 1, after: ['I04.sectionFacts'], reads: ['levels', 'minimumLength'], kinds: ['SectionInputIssues'], targets: ['inputIssues'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'SectionInputIssues', target: 'inputIssues', expectedRevision: revision,
      value: sectionInputIssues(facts.levels as SectionFact[], facts.minimumLength!) }] }) },
  { id: 'V02.sweepClearance', ruleId: 'V02', phase: 1, after: ['I04.sectionFacts'], reads: ['levels', 'parameters'], kinds: ['SweepIssues'], targets: ['sweepIssues'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'SweepIssues', target: 'sweepIssues', expectedRevision: revision,
      value: sweepIssues(facts.levels as SectionFact[], facts.parameters as ScaffoldParameters) }] }) },
]
const run = compilePipeline<Facts, Change>(RULES, SECTION_VALIDATION_STEPS, (facts, proposals) => {
  let result = { ...facts } as Facts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'SectionLevels': result = { ...result, levels: proposal.value }; break
    case 'SectionInputIssues': result = { ...result, inputIssues: proposal.value }; break
    case 'SweepIssues': result = { ...result, sweepIssues: proposal.value }; break
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS })
export function validateSectionInputs(sections: SiteSection[], blocks: ResolvedBlock[], parameters: ScaffoldParameters, minimumLength: number) {
  const { facts } = run({ sections, blocks, parameters, minimumLength })
  return { summaries: facts.levels!.flatMap(section => section.summary ? [{ ...section.summary }] : []) as SectionSummary[],
    issues: [...facts.inputIssues!, ...facts.sweepIssues!].sort((a, b) => a.order - b.order).map(item => ({ ...item.issue, sectionIds: [...item.issue.sectionIds] })) as SiteIssue[] }
}
