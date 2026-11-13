import type { ScaffoldParameters, Vector3Tuple } from '../scaffold.ts'
import type { AlignedStations, CornerTopology, PlanPoint } from './policies/topology.ts'
import { postRowsAt, extendFrameRows, type FrameRows } from './policies/frameRows.ts'
import { endBoundaries, outwardRanges, inwardRanges, type EndBoundary, type GuardRange } from './policies/protectionRanges.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'

type Facts = { physical: PlanPoint[]; stations: AlignedStations; corners: CornerTopology; counts: number[]; closed: boolean;
  width: number; supportCount: number; outerRow: number; posts?: Vector3Tuple[][][]; rows?: FrameRows[]; ends?: EndBoundary[]; guards?: GuardRange[][] }
type Change = Proposal & (
  | { kind: 'PostRowGeometry'; target: 'posts'; value: Vector3Tuple[][][] }
  | { kind: 'WorkingRowGeometry'; target: 'rows'; value: FrameRows[] }
  | { kind: 'OpenBoundaries'; target: 'ends'; value: EndBoundary[] }
  | { kind: 'GuardRanges'; target: 'guards'; value: GuardRange[][] }
)
export const FRAME_ROW_STEPS: RuleStep<Facts, Change>[] = [
  { id: 'M01.rows', ruleId: 'M01', phase: 3, after: [], reads: ['physical', 'stations', 'width'], kinds: ['PostRowGeometry'], targets: ['posts'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'PostRowGeometry', target: 'posts', expectedRevision: revision,
      value: facts.stations!.map((station, index) => postRowsAt(facts.physical![index] as PlanPoint, station as AlignedStations[number], facts.width!)) }] }) },
  { id: 'M03.rows', ruleId: 'M03', phase: 3, after: ['M01.rows'], reads: ['posts', 'supportCount', 'corners'], kinds: ['WorkingRowGeometry'], targets: ['rows'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'WorkingRowGeometry', target: 'rows', expectedRevision: revision,
      value: facts.posts!.map((posts, index) => extendFrameRows(posts as Vector3Tuple[][], facts.supportCount!, facts.corners!.offsetRowExtensions[index] as CornerTopology['offsetRowExtensions'][number])) }] }) },
  { id: 'P02.boundaries', ruleId: 'P02', phase: 3, after: [], reads: ['counts', 'stations', 'closed'], kinds: ['OpenBoundaries'], targets: ['ends'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'OpenBoundaries', target: 'ends', expectedRevision: revision,
      value: endBoundaries(facts.counts!, facts.stations as AlignedStations, facts.closed!) }] }) },
  { id: 'P02.ranges', ruleId: 'P02', phase: 5, after: ['M03.rows', 'P02.boundaries'], reads: ['rows', 'ends', 'counts', 'outerRow'], kinds: ['GuardRanges'], targets: ['guards'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'GuardRanges', target: 'guards', expectedRevision: revision,
      value: facts.rows!.map((rows, index) => outwardRanges(rows as FrameRows, facts.ends![index] as EndBoundary, facts.counts![index], facts.outerRow!)) }] }) },
  { id: 'P03.inwardRanges', ruleId: 'P03', phase: 5, after: ['P02.ranges'], reads: ['physical', 'stations', 'corners', 'ends', 'guards', 'outerRow', 'width'], kinds: ['GuardRanges'], targets: ['guards'],
    refines: [{ step: 'P02.ranges', targets: ['guards'], reason: 'Only common-lift inward side guards end at the shared post; working members and unmatched lifts retain their ranges.',
      caseId: 'P03-common-lift-inward', when: (next, previous, facts) => next.kind === 'GuardRanges' && previous.kind === 'GuardRanges'
        && next.value.length === previous.value.length
        && next.value.every((ranges, index) => JSON.stringify(ranges) === JSON.stringify(inwardRanges(previous.value[index],
          facts.ends![index] as EndBoundary, facts.physical![index] as PlanPoint, facts.stations![index] as AlignedStations[number],
          facts.corners!.offsetPostLimits[index], facts.outerRow!, facts.width!))) }],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'GuardRanges', target: 'guards', expectedRevision: revision,
      value: facts.guards!.map((ranges, index) => inwardRanges(ranges as GuardRange[], facts.ends![index] as EndBoundary, facts.physical![index] as PlanPoint,
        facts.stations![index] as AlignedStations[number], facts.corners!.offsetPostLimits[index], facts.outerRow!, facts.width!)) }] }) },
]
const run = compilePipeline<Facts, Change>(RULES, FRAME_ROW_STEPS, (facts, proposals) => {
  let result = { ...facts } as Facts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'PostRowGeometry': result = { ...result, posts: proposal.value }; break
    case 'WorkingRowGeometry': result = { ...result, rows: proposal.value }; break
    case 'OpenBoundaries': result = { ...result, ends: proposal.value }; break
    case 'GuardRanges': result = { ...result, guards: proposal.value }; break
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS,
  // These pure policies read calculation-owned facts and allocate their changes.
  // Development still clones/freezes the full snapshot to verify that contract.
  snapshot: VERIFY_RULE_INPUTS ? undefined : facts => facts,
})
export function startFrameRows(physical: PlanPoint[], stations: AlignedStations, corners: CornerTopology, counts: number[], closed: boolean, parameters: ScaffoldParameters) {
  const stage = run.start({ physical, stations, corners, counts, closed, width: parameters.width,
    supportCount: Math.max(2, Math.round(parameters.deckSupportRailCount)), outerRow: parameters.swapInnerOuter ? 1 : 0 })
  return { advance: (phase: import('./contracts.ts').Phase) => {
    const { facts } = stage.advance(phase)
    return { rows: facts.rows as FrameRows[], ends: facts.ends as EndBoundary[], guards: facts.guards as GuardRange[][] }
  } }
}
export function resolveFrameRows(physical: PlanPoint[], stations: AlignedStations, corners: CornerTopology, counts: number[], closed: boolean, parameters: ScaffoldParameters) {
  return startFrameRows(physical, stations, corners, counts, closed, parameters).advance(5)
}
