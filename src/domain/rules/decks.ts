import type { DeckPanel, ScaffoldParameters } from '../scaffold.ts'
import { generateDecks, resolveDeckCoverage, type PanelGeometry } from './policies/decks.ts'
import type { CornerTopology, PlanPoint } from './policies/topology.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'
type Facts = { geometry: PanelGeometry[]; order: number[]; corners: CornerTopology['cornerDecks']; counts: number[]; lifts: number[];
  parameters: ScaffoldParameters; deckLayerOffset: number; physical: PlanPoint[]; closed: boolean; perSegmentCounts: boolean; candidates?: DeckPanel[]; panels?: DeckPanel[] }
type Change = Proposal & ({ kind: 'PanelCandidates'; target: 'candidates'; value: DeckPanel[] } | { kind: 'ResolveCoverage'; target: 'panels'; value: DeckPanel[] })
export const DECK_STEPS: RuleStep<Facts, Change>[] = [
  { id: 'M05.panels', ruleId: 'M05', phase: 3, after: [], reads: ['geometry', 'order', 'corners', 'counts', 'lifts', 'parameters', 'deckLayerOffset'], kinds: ['PanelCandidates'], targets: ['candidates'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'PanelCandidates', target: 'candidates', expectedRevision: revision,
      value: generateDecks(facts.geometry as PanelGeometry[], facts.order!, facts.corners as CornerTopology['cornerDecks'], facts.counts!, facts.lifts!, facts.parameters as ScaffoldParameters, facts.deckLayerOffset!) }] }) },
  { id: 'M06.coverage', ruleId: 'M06', phase: 3, after: ['M05.panels'], reads: ['candidates', 'physical', 'closed', 'perSegmentCounts'], kinds: ['ResolveCoverage'], targets: ['panels'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'ResolveCoverage', target: 'panels', expectedRevision: revision,
      value: resolveDeckCoverage(facts.candidates as DeckPanel[], facts.physical as PlanPoint[], facts.closed!, facts.perSegmentCounts!) }] }) },
]
const run = compilePipeline<Facts, Change>(RULES, DECK_STEPS, (facts, proposals) => {
  let result = { ...facts } as Facts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'PanelCandidates': result = { ...result, candidates: proposal.value }; break
    case 'ResolveCoverage': {
      const ids = new Set(facts.candidates!.map(panel => panel.id))
      if (new Set(proposal.value.map(panel => panel.id)).size !== proposal.value.length || proposal.value.some(panel => !ids.has(panel.id)))
        throw new Error('Duplicate or dangling coverage panel')
      result = { ...result, panels: proposal.value }; break
    }
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS })
export function resolveDecks(input: Omit<Facts, 'candidates' | 'panels'>): DeckPanel[] {
  return run(input).facts.panels!.map(panel => ({ ...panel })) as DeckPanel[]
}
