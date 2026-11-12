import type { LayoutWarning } from '../scaffold.ts'
import { pathWarnings, bandWarnings } from './policies/pathValidation.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'
type Facts = { points: [number, number][]; closed: boolean; width: number; path?: LayoutWarning[]; bands?: LayoutWarning[] }
type Change = Proposal & { kind: 'PathWarnings'; target: 'path' | 'bands'; value: LayoutWarning[] }
export const PATH_VALIDATION_STEPS: RuleStep<Facts, Change>[] = [
  { id: 'V04.path', ruleId: 'V04', phase: 2, after: [], reads: ['points', 'closed'], kinds: ['PathWarnings'], targets: ['path'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'PathWarnings', target: 'path', expectedRevision: revision,
      value: pathWarnings(facts.points as [number, number][], facts.closed!) }] }) },
  { id: 'V04.bands', ruleId: 'V04', phase: 2, after: [], reads: ['points', 'closed', 'width'], kinds: ['PathWarnings'], targets: ['bands'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'PathWarnings', target: 'bands', expectedRevision: revision,
      value: bandWarnings(facts.points as [number, number][], facts.closed!, facts.width!) }] }) },
]
const run = compilePipeline<Facts, Change>(RULES, PATH_VALIDATION_STEPS, (facts, proposals) => {
  let result = { ...facts } as Facts
  for (const proposal of proposals) result = { ...result, [proposal.target]: proposal.value }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS })
export function validatePath(points: [number, number][], closed: boolean, width: number) {
  const { facts } = run({ points, closed, width })
  return { path: facts.path!.map(warning => ({ ...warning })), bands: facts.bands!.map(warning => ({ ...warning })) }
}
