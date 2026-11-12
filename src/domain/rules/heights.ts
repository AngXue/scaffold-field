import type { ScaffoldParameters } from '../scaffold.ts'
import { heightProfile, supportProfile, type HeightProfile, type SupportProfile } from './policies/heights.ts'
import { candidateCourses, supportedCourses, type GuardCandidate, type GuardCourse } from './policies/guardCourses.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'

type Facts = { counts: number[]; parameters: ScaffoldParameters; localLifts?: readonly number[]; deckLayerOffset: number;
  heights?: HeightProfile[]; supports?: SupportProfile[]; candidates?: GuardCandidate[][]; courses?: GuardCourse[][] }
type Change = Proposal & (
  | { kind: 'HeightDemands'; target: 'heights'; value: HeightProfile[] }
  | { kind: 'SupportPreview'; target: 'supports'; value: SupportProfile[] }
  | { kind: 'GuardCandidates'; target: 'candidates'; value: GuardCandidate[][] }
  | { kind: 'SupportedCourses'; target: 'courses'; value: GuardCourse[][] }
)
export const HEIGHT_STEPS: RuleStep<Facts, Change>[] = [
  { id: 'M02.heights', ruleId: 'M02', phase: 3, after: [], reads: ['counts', 'parameters', 'localLifts'], kinds: ['HeightDemands'], targets: ['heights'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'HeightDemands', target: 'heights', expectedRevision: revision,
      value: facts.counts!.map(count => heightProfile(count, facts.parameters as ScaffoldParameters, facts.localLifts)) }] }) },
  { id: 'P01.courses', ruleId: 'P01', phase: 3, after: ['M02.heights'], reads: ['heights', 'parameters', 'deckLayerOffset'], kinds: ['GuardCandidates'], targets: ['candidates'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'GuardCandidates', target: 'candidates', expectedRevision: revision,
      value: facts.heights!.map(height => candidateCourses(height as HeightProfile, facts.parameters as ScaffoldParameters, facts.deckLayerOffset!)) }] }) },
  { id: 'S01.supportPreview', ruleId: 'S01', phase: 4, after: ['M02.heights'], reads: ['heights', 'parameters'], kinds: ['SupportPreview'], targets: ['supports'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'SupportPreview', target: 'supports', expectedRevision: revision,
      value: facts.heights!.map(height => supportProfile(height as HeightProfile, facts.parameters as ScaffoldParameters)) }] }) },
  { id: 'P07.supportedCourses', ruleId: 'P07', phase: 5, after: ['S01.supportPreview', 'P01.courses'], reads: ['heights', 'supports', 'candidates', 'parameters'], kinds: ['SupportedCourses'], targets: ['courses'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'SupportedCourses', target: 'courses', expectedRevision: revision,
      value: facts.candidates!.map((courses, index) => supportedCourses(courses as GuardCandidate[], facts.heights![index] as HeightProfile,
        facts.supports![index] as SupportProfile, facts.parameters as ScaffoldParameters)) }] }) },
]
const run = compilePipeline<Facts, Change>(RULES, HEIGHT_STEPS, (facts, proposals) => {
  let result = { ...facts } as Facts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'HeightDemands': result = { ...result, heights: proposal.value }; break
    case 'SupportPreview': result = { ...result, supports: proposal.value }; break
    case 'GuardCandidates': result = { ...result, candidates: proposal.value }; break
    case 'SupportedCourses': result = { ...result, courses: proposal.value }; break
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS })

export function resolveHeightStages(parameters: ScaffoldParameters, segmentCounts: readonly number[], localLifts: readonly number[] | undefined,
  deckLayerOffset: number, trace = false) {
  const counts = [...new Set([parameters.layerCount, ...segmentCounts].map(count => Math.max(1, Math.round(count))))]
  const result = run({ counts, parameters, localLifts, deckLayerOffset }, { trace })
  const profiles = counts.map((count, index) => ({ count, height: result.facts.heights![index] as HeightProfile,
    support: result.facts.supports![index] as SupportProfile, courses: result.facts.courses![index] as GuardCourse[] }))
  return { profiles, trace: result.trace }
}
