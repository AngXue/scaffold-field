import type { ScaffoldParameters } from '../scaffold.ts'
import { sweepBands, workingBands, type BandGeometry, type Band } from './policies/bands.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'
type Facts = { geometry: BandGeometry[]; parameters: ScaffoldParameters; deckLayerOffset: number; sweep?: Band[][]; working?: Band[][] }
type Change = Proposal & ({ kind: 'SweepBands'; target: 'sweep'; value: Band[][] } | { kind: 'WorkingBands'; target: 'working'; value: Band[][] })
export const BAND_STEPS: RuleStep<Facts, Change>[] = [
  { id: 'M04.sweep', ruleId: 'M04', phase: 3, after: [], reads: ['geometry', 'parameters'], kinds: ['SweepBands'], targets: ['sweep'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'SweepBands', target: 'sweep', expectedRevision: revision,
      value: sweepBands(facts.geometry as BandGeometry[], facts.parameters as ScaffoldParameters) }] }) },
  { id: 'M03.workingBands', ruleId: 'M03', phase: 3, after: [], reads: ['geometry', 'parameters', 'deckLayerOffset'], kinds: ['WorkingBands'], targets: ['working'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'WorkingBands', target: 'working', expectedRevision: revision,
      value: workingBands(facts.geometry as BandGeometry[], facts.parameters as ScaffoldParameters, facts.deckLayerOffset!) }] }) },
]
const run = compilePipeline<Facts, Change>(RULES, BAND_STEPS, (facts, proposals) => {
  let result = { ...facts } as Facts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'SweepBands': result = { ...result, sweep: proposal.value }; break
    case 'WorkingBands': result = { ...result, working: proposal.value }; break
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS,
  // These pure policies read calculation-owned facts and allocate their changes.
  // Development still clones/freezes the full snapshot to verify that contract.
  snapshot: VERIFY_RULE_INPUTS ? undefined : facts => facts,
})
export function resolveBands(geometry: BandGeometry[], parameters: ScaffoldParameters, deckLayerOffset: number): Band[][] {
  const { facts } = run({ geometry, parameters, deckLayerOffset })
  return geometry.map((_, index) => [...facts.sweep![index], ...facts.working![index]]) as Band[][]
}
