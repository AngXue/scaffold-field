import type { DeckPanel, ScaffoldMember, PipeSegment, ScaffoldConnector } from '../scaffold.ts'
import type { PlacementEnvironment, PlacementLayout, Walkway } from './facts/placement.ts'
import { walkwayObjectives } from './policies/placementConstraints.ts'
import { solvePositions } from './policies/positioner.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'
type Facts = { members: ScaffoldMember[]; pipes: PipeSegment[]; connectors: ScaffoldConnector[]; decks: DeckPanel[]; environment: PlacementEnvironment;
  objectives?: Walkway[]; placed?: ReturnType<typeof solvePositions> }
type Change = Proposal & ({ kind: 'WalkwayObjectives'; target: 'objectives'; value: Walkway[] } | { kind: 'PositionWholeStock'; target: 'placed'; value: ReturnType<typeof solvePositions> })
export const PLACEMENT_STEPS: RuleStep<Facts, Change>[] = [
  { id: 'P08.walkwayObjective', ruleId: 'P08', phase: 7, after: [], reads: ['members', 'decks', 'environment'], kinds: ['WalkwayObjectives'], targets: ['objectives'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'WalkwayObjectives', target: 'objectives', expectedRevision: revision,
      value: facts.environment!.walkway ? walkwayObjectives(facts.members as ScaffoldMember[], facts.decks as DeckPanel[]) : [] }] }) },
  { id: 'S04.positionStock', ruleId: 'S04', phase: 7, after: ['P08.walkwayObjective'], reads: ['members', 'pipes', 'connectors', 'environment', 'objectives'], kinds: ['PositionWholeStock'], targets: ['placed'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'PositionWholeStock', target: 'placed', expectedRevision: revision,
      value: solvePositions(facts.members as ScaffoldMember[], facts.pipes as PipeSegment[], facts.connectors as ScaffoldConnector[], facts.environment as PlacementEnvironment, facts.objectives as Walkway[]) }] }) },
]
const run = compilePipeline<Facts, Change>(RULES, PLACEMENT_STEPS, (facts, proposals) => {
  let result = { ...facts } as Facts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'WalkwayObjectives': result = { ...result, objectives: proposal.value }; break
    case 'PositionWholeStock': {
      if (proposal.value.pipes.length !== facts.pipes.length || proposal.value.connectors.length !== facts.connectors.length) throw new Error('Positioning cannot add or remove parts')
      for (let i = 0; i < facts.pipes.length; i++) {
        const before = facts.pipes[i], after = proposal.value.pipes[i]
        if (before.id !== after.id || before.stockLength !== after.stockLength || before.memberId !== after.memberId) throw new Error('Positioning changed stock identity')
        const length = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((value, axis) => value - b[axis]))
        if (Math.abs(length(before.start, before.end) - length(after.start, after.end)) > 1e-6) throw new Error('Positioning shortened a pipe')
      }
      const pipeDelta = new Map(proposal.value.pipes.map((pipe, index) => [pipe.memberId, pipe.start.map((value, axis) => value - facts.pipes[index].start[axis])]))
      for (let i = 0; i < facts.connectors.length; i++) {
        const before = facts.connectors[i], after = proposal.value.connectors[i]
        if (before.id !== after.id || before.memberId !== after.memberId || before.type !== after.type) throw new Error('Positioning changed connector identity')
        const expected = before.type === 'butt' ? pipeDelta.get(before.memberId) ?? [0, 0, 0] : [0, 0, 0]
        if (after.position.some((value, axis) => Math.abs(value - before.position[axis] - expected[axis]) > 1e-6)) throw new Error('Sleeve did not follow its stock or a post fitting moved')
      }
      result = { ...result, placed: proposal.value }; break
    }
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS })
export function positionStock(layout: PlacementLayout, environment: PlacementEnvironment) {
  if (!layout.pipeSegments.length) return []
  const { facts } = run({ members: layout.members, pipes: layout.pipeSegments, connectors: layout.connectors, decks: layout.decks ?? [], environment })
  // One atomic compatibility commit. No policy mutates the incoming layout.
  facts.placed!.pipes.forEach((pipe, index) => { layout.pipeSegments[index].start = [...pipe.start]; layout.pipeSegments[index].end = [...pipe.end] })
  facts.placed!.connectors.forEach((connector, index) => { layout.connectors[index].position = [...connector.position] })
  return facts.placed!.decisions
}
