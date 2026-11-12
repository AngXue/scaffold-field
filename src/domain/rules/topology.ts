import type { ScaffoldParameters } from '../scaffold.ts'
import { planStationGrid, solveCornerTopology, alignStationGrid, retainedOffsetStations, type PlanPoint, type TopologyParameters,
  type StationGrid, type CornerTopology, type AlignedStations } from './policies/topology.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'

type TopologyFacts = { physical: PlanPoint[]; parameters: TopologyParameters; closed: boolean; supportRows: number; required: readonly (readonly [boolean, boolean])[];
  grid?: StationGrid; corners?: CornerTopology; stations?: AlignedStations; retained?: boolean[][] }
type TopologyProposal = Proposal & (
  | { kind: 'PlanStationGrid'; target: 'grid'; value: StationGrid }
  | { kind: 'ResolveCornerTopology'; target: 'corners'; value: CornerTopology }
  | { kind: 'AlignCornerStations'; target: 'stations'; value: AlignedStations }
  | { kind: 'RetainRequiredStations'; target: 'retained'; value: boolean[][] }
)
export const TOPOLOGY_STEPS: RuleStep<TopologyFacts, TopologyProposal>[] = [
  { id: 'G03.grid', ruleId: 'G03', phase: 2, after: [], reads: ['physical', 'parameters', 'closed'], kinds: ['PlanStationGrid'], targets: ['grid'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'PlanStationGrid', target: 'grid', expectedRevision: revision,
      value: planStationGrid(facts.physical as PlanPoint[], facts.parameters!, facts.closed!) }] }) },
  { id: 'G08.corners', ruleId: 'G08', phase: 2, after: ['G03.grid'], reads: ['physical', 'parameters', 'closed', 'supportRows', 'grid'], kinds: ['ResolveCornerTopology'], targets: ['corners'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'ResolveCornerTopology', target: 'corners', expectedRevision: revision,
      value: solveCornerTopology(facts.physical as PlanPoint[], facts.parameters!, facts.closed!, facts.supportRows!, facts.grid as StationGrid) }] }) },
  { id: 'G03.align', ruleId: 'G03', phase: 2, after: ['G08.corners'], reads: ['physical', 'parameters', 'corners'], kinds: ['AlignCornerStations'], targets: ['stations'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'AlignCornerStations', target: 'stations', expectedRevision: revision,
      value: alignStationGrid(facts.physical as PlanPoint[], facts.parameters!, facts.corners!.cornerStations as number[][]) }] }) },
  { id: 'G09.retain', ruleId: 'G09', phase: 2, after: ['G03.align'], reads: ['stations', 'corners', 'parameters', 'required'], kinds: ['RetainRequiredStations'], targets: ['retained'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'RetainRequiredStations', target: 'retained', expectedRevision: revision,
      value: retainedOffsetStations(facts.stations as AlignedStations, facts.corners as CornerTopology, facts.required!, facts.parameters!) }] }) },
]
const run = compilePipeline<TopologyFacts, TopologyProposal>(RULES, TOPOLOGY_STEPS, (facts, proposals) => {
  let result = { ...facts } as TopologyFacts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'PlanStationGrid': result = { ...result, grid: proposal.value }; break
    case 'ResolveCornerTopology': result = { ...result, corners: proposal.value }; break
    case 'AlignCornerStations': result = { ...result, stations: proposal.value }; break
    case 'RetainRequiredStations': result = { ...result, retained: proposal.value }; break
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS })
export function resolveTopology(physical: PlanPoint[], parameters: ScaffoldParameters, closed: boolean, supportRows: number, required: readonly (readonly [boolean, boolean])[]) {
  const { facts } = run({ physical, parameters: { width: parameters.width, postSpacing: parameters.postSpacing }, closed, supportRows, required })
  return { grid: facts.grid as StationGrid, corners: facts.corners as CornerTopology, stations: facts.stations as AlignedStations, retained: facts.retained as boolean[][] }
}
