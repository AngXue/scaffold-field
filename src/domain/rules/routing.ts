import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { ResolvedBlock, SiteSection } from '../site.ts'
import type { ScaffoldParameters } from '../scaffold.ts'
import { resolveWallFacts, resolveNarrowClearance, splitSupport, balanceRoofStations, anchorRoofEntries, publishSupportSpans,
  type WallFacts, type NarrowClearance, type RouteDraft } from './policies/routing.ts'
import { compilePipeline } from './pipeline.ts'
import { RULES } from './catalog.ts'
import type { Proposal, RuleStep } from './contracts.ts'

type RoutingFacts = {
  sections: SiteSection[]; blocks: ResolvedBlock[]; settings: ScaffoldParameters
  walls?: WallFacts; clearance?: NarrowClearance; supported?: RouteDraft[]; balanced?: RouteDraft[]; anchored?: RouteDraft[]
  routed?: ReturnType<typeof publishSupportSpans>
}
type RoutingProposal = Proposal & (
  | { kind: 'ResolveWallFaces'; target: 'walls'; value: WallFacts }
  | { kind: 'ResolveNarrowClearance'; target: 'clearance'; value: NarrowClearance }
  | { kind: 'SplitSupport'; target: 'supported'; value: RouteDraft[] }
  | { kind: 'BalanceRoofStations'; target: 'balanced'; value: RouteDraft[] }
  | { kind: 'AnchorRoofEntry'; target: 'anchored'; value: RouteDraft[] }
  | { kind: 'PublishSupportSpans'; target: 'routed'; value: ReturnType<typeof publishSupportSpans> }
)
export const ROUTING_STEPS: RuleStep<RoutingFacts, RoutingProposal>[] = [
  { id: 'G01.walls', ruleId: 'G01', phase: 1, after: [], reads: ['sections', 'blocks'], kinds: ['ResolveWallFaces'], targets: ['walls'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'ResolveWallFaces', target: 'walls', expectedRevision: revision,
      value: resolveWallFacts(facts.sections as SiteSection[], facts.blocks as ResolvedBlock[]) }] }) },
  { id: 'G06.clearance', ruleId: 'G06', phase: 1, after: ['G01.walls'], reads: ['sections', 'settings', 'walls'], kinds: ['ResolveNarrowClearance'], targets: ['clearance'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'ResolveNarrowClearance', target: 'clearance', expectedRevision: revision,
      value: resolveNarrowClearance(facts.sections as SiteSection[], facts.walls as WallFacts, facts.settings as ScaffoldParameters) }] }) },
  { id: 'G02.support', ruleId: 'G02', phase: 1, after: ['G06.clearance'], reads: ['sections', 'blocks', 'settings', 'walls', 'clearance'], kinds: ['SplitSupport'], targets: ['supported'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'SplitSupport', target: 'supported', expectedRevision: revision,
      value: splitSupport(facts.sections as SiteSection[], facts.blocks as ResolvedBlock[], facts.walls as WallFacts, facts.clearance as NarrowClearance, facts.settings as ScaffoldParameters) }] }) },
  { id: 'G04.balance', ruleId: 'G04', phase: 2, after: ['G02.support'], reads: ['supported', 'settings'], kinds: ['BalanceRoofStations'], targets: ['balanced'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'BalanceRoofStations', target: 'balanced', expectedRevision: revision,
      value: balanceRoofStations(facts.supported as RouteDraft[], facts.settings as ScaffoldParameters) }] }) },
  { id: 'G05.anchor', ruleId: 'G05', phase: 2, after: ['G04.balance'], reads: ['balanced', 'settings'], kinds: ['AnchorRoofEntry'], targets: ['anchored'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'AnchorRoofEntry', target: 'anchored', expectedRevision: revision,
      value: anchorRoofEntries(facts.balanced as RouteDraft[], facts.settings as ScaffoldParameters) }] }) },
  { id: 'G02.publish', ruleId: 'G02', phase: 2, after: ['G05.anchor'], reads: ['anchored', 'sections', 'clearance', 'settings'], kinds: ['PublishSupportSpans'], targets: ['routed'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'PublishSupportSpans', target: 'routed', expectedRevision: revision,
      value: publishSupportSpans(facts.anchored as RouteDraft[], facts.sections as SiteSection[], facts.clearance as NarrowClearance, facts.settings as ScaffoldParameters) }] }) },
]
const run = compilePipeline<RoutingFacts, RoutingProposal>(RULES, ROUTING_STEPS, (facts, proposals) => {
  let result = { ...facts } as RoutingFacts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'ResolveWallFaces': result = { ...result, walls: proposal.value }; break
    case 'ResolveNarrowClearance': result = { ...result, clearance: proposal.value }; break
    case 'SplitSupport': result = { ...result, supported: proposal.value }; break
    case 'BalanceRoofStations': result = { ...result, balanced: proposal.value }; break
    case 'AnchorRoofEntry': result = { ...result, anchored: proposal.value }; break
    case 'PublishSupportSpans': result = { ...result, routed: proposal.value }; break
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS })
export function routeSiteSections(sections: SiteSection[], blocks: ResolvedBlock[], settings: ScaffoldParameters) {
  return run({ sections, blocks, settings }).facts.routed as ReturnType<typeof publishSupportSpans>
}
/** Diagnostic stage products are opt-in; production does not retain this graph. */
export function explainRouting(sections: SiteSection[], blocks: ResolvedBlock[], settings: ScaffoldParameters) {
  return run({ sections, blocks, settings }, { trace: true })
}
