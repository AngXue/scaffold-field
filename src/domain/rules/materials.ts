import type { ScaffoldMember, PipeSegment, DeckPanel, ScaffoldConnector, BaseChannel, ScaffoldParameters, PipeAssemblyPlan, MaterialResult } from '../scaffold.ts'
import { physicalContributions, type PhysicalContribution } from './facts/materialLedger.ts'
import { summarizeContributions, unmodelledQuantities, type ComputedQuantities, type LogicalDemand, type QuantitySettings } from './policies/materials.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'

type MaterialFacts = { contributions: PhysicalContribution[]; demands: LogicalDemand[]; settings: QuantitySettings;
  quantities?: ComputedQuantities; unknown?: ReturnType<typeof unmodelledQuantities> }
type MaterialProposal = Proposal & (
  | { kind: 'SumPhysicalContributions'; target: 'quantities'; value: ComputedQuantities }
  | { kind: 'PreserveUnknownQuantities'; target: 'unknown'; value: ReturnType<typeof unmodelledQuantities> }
)
export const MATERIAL_STEPS: RuleStep<MaterialFacts, MaterialProposal>[] = [
  { id: 'O01.quantities', ruleId: 'O01', phase: 9, after: [], reads: ['contributions', 'demands', 'settings'], kinds: ['SumPhysicalContributions'], targets: ['quantities'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'SumPhysicalContributions', target: 'quantities', expectedRevision: revision,
      value: summarizeContributions(facts.contributions as PhysicalContribution[], facts.demands!, facts.settings!) }] }) },
  { id: 'C03.unknown', ruleId: 'C03', phase: 9, after: [], reads: [], kinds: ['PreserveUnknownQuantities'], targets: ['unknown'],
    evaluate: (_, revision) => ({ status: 'proposed', proposals: [{ kind: 'PreserveUnknownQuantities', target: 'unknown', expectedRevision: revision, value: unmodelledQuantities() }] }) },
]
const run = compilePipeline<MaterialFacts, MaterialProposal>(RULES, MATERIAL_STEPS, (facts, proposals) => {
  let result = { ...facts } as MaterialFacts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'SumPhysicalContributions': result = { ...result, quantities: proposal.value }; break
    case 'PreserveUnknownQuantities': result = { ...result, unknown: proposal.value }; break
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS,
  // Every field below is newly allocated by this module's sole entry point.
  // Transfer ownership of this private snapshot instead of copying it twice.
  snapshot: facts => facts,
})
export function calculateMaterials(members: ScaffoldMember[], pipeSegments: PipeSegment[], decks: DeckPanel[], connectors: ScaffoldConnector[],
  baseChannels: BaseChannel[], parameters: ScaffoldParameters, assemblyPlans: PipeAssemblyPlan[], postHeights: MaterialResult['postHeights']): MaterialResult {
  const contributions = physicalContributions({ members, pipeSegments, decks, connectors, baseChannels })
  const demands = members.map(({ id, type, length }) => ({ id, type, length }))
  const { facts } = run({ contributions, demands, settings: { width: parameters.width, guardrailRailCount: parameters.guardrailRailCount } })
  const quantities = facts.quantities as ComputedQuantities, unknown = facts.unknown as ReturnType<typeof unmodelledQuantities>
  return { ...quantities, connectorSummary: { ...quantities.connectorSummary, swivel: unknown.swivel },
    pendingMaterials: unknown.pending, postHeights, assemblyPlans }
}
