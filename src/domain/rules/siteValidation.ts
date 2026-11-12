import type { ScaffoldAssembly } from './facts/draft.ts'
import type { ResolvedBlock, SiteIssue } from '../site.ts'
import type { RoutedSpan } from '../siteRouting.ts'
import type { JoinedLift, Bridge } from './facts/transitions.ts'
import { supportFindings, penetrationFindings, independentOverlapIssues, type PhysicalCheck, type ValidationContext, type CheckFinding, type PhysicalGroup } from './policies/siteValidation.ts'
import { bridgeIssues } from './policies/bridgeValidation.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'
type BridgeInput = { layout: ScaffoldAssembly; blocks: ResolvedBlock[]; spans: RoutedSpan[]; bridges: Bridge[]; joined: JoinedLift[]; radius: number; labels: [string, number][]; previous: SiteIssue[] }
type Facts = { checks?: PhysicalCheck[]; context?: ValidationContext; groups?: PhysicalGroup[]; order?: string[]; labels?: Record<string, string>; bridge?: BridgeInput;
  support?: CheckFinding[]; penetrations?: CheckFinding[]; collisions?: SiteIssue[]; bridgeIssues?: SiteIssue[] }
type Change = Proposal & (
  | { kind: 'SupportFindings'; target: 'support'; value: CheckFinding[] }
  | { kind: 'PenetrationFindings'; target: 'penetrations'; value: CheckFinding[] }
  | { kind: 'IndependentCollisions'; target: 'collisions'; value: SiteIssue[] }
  | { kind: 'BridgeCollisions'; target: 'bridgeIssues'; value: SiteIssue[] }
)
export const SITE_VALIDATION_STEPS: RuleStep<Facts, Change>[] = [
  { id: 'V01.physicalSupport', ruleId: 'V01', phase: 9, after: [], reads: ['checks', 'context'], kinds: ['SupportFindings'], targets: ['support'],
    evaluate: (facts, revision) => facts.checks ? ({ status: 'proposed', proposals: [{ kind: 'SupportFindings', target: 'support', expectedRevision: revision,
      value: supportFindings(facts.checks as PhysicalCheck[], facts.context as ValidationContext) }] }) : ({ status: 'not-applicable', reason: 'No local support scope' }) },
  { id: 'V03.penetrations', ruleId: 'V03', phase: 9, after: [], reads: ['checks', 'context'], kinds: ['PenetrationFindings'], targets: ['penetrations'],
    evaluate: (facts, revision) => facts.checks ? ({ status: 'proposed', proposals: [{ kind: 'PenetrationFindings', target: 'penetrations', expectedRevision: revision,
      value: penetrationFindings(facts.checks as PhysicalCheck[], facts.context as ValidationContext) }] }) : ({ status: 'not-applicable', reason: 'No local entity scope' }) },
  { id: 'V03.independentCollisions', ruleId: 'V03', phase: 9, after: [], reads: ['groups', 'order', 'labels'], kinds: ['IndependentCollisions'], targets: ['collisions'],
    evaluate: (facts, revision) => facts.groups ? ({ status: 'proposed', proposals: [{ kind: 'IndependentCollisions', target: 'collisions', expectedRevision: revision,
      value: independentOverlapIssues(facts.groups as PhysicalGroup[], facts.order!, facts.labels as Record<string, string>) }] }) : ({ status: 'not-applicable', reason: 'No component collision scope' }) },
  { id: 'V03.bridgeCollisions', ruleId: 'V03', phase: 9, after: [], reads: ['bridge'], kinds: ['BridgeCollisions'], targets: ['bridgeIssues'],
    evaluate: (facts, revision) => facts.bridge ? ({ status: 'proposed', proposals: [{ kind: 'BridgeCollisions', target: 'bridgeIssues', expectedRevision: revision,
      value: bridgeIssues(facts.bridge.layout as ScaffoldAssembly, facts.bridge.blocks as ResolvedBlock[], facts.bridge.spans as RoutedSpan[], facts.bridge.bridges as Bridge[],
        facts.bridge.joined as JoinedLift[], facts.bridge.radius, facts.bridge.labels as [string, number][], facts.bridge.previous as SiteIssue[]) }] }) : ({ status: 'not-applicable', reason: 'No connected bridge scope' }) },
]
const run = compilePipeline<Facts, Change>(RULES, SITE_VALIDATION_STEPS, (facts, proposals) => {
  let result = { ...facts } as Facts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'SupportFindings': result = { ...result, support: proposal.value }; break
    case 'PenetrationFindings': result = { ...result, penetrations: proposal.value }; break
    case 'IndependentCollisions': result = { ...result, collisions: proposal.value }; break
    case 'BridgeCollisions': result = { ...result, bridgeIssues: proposal.value }; break
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS,
  // Production borrows calculation-owned readonly geometry. Policies allocate
  // their changed entities privately; copying the entire scene here is redundant.
  // Development still clones/freezes every nested input to enforce that contract.
  snapshot: VERIFY_RULE_INPUTS ? undefined : facts => facts,
})
export function validatePhysicalChecks(checks: PhysicalCheck[], context: ValidationContext): SiteIssue[] {
  const { facts } = run({ checks, context })
  return [...facts.support!, ...facts.penetrations!].sort((a, b) => a.order - b.order).map(finding => ({ ...finding.issue })) as SiteIssue[]
}
export function validateIndependentGroups(groups: PhysicalGroup[], order: string[], labels: Record<string, string>): SiteIssue[] {
  return run({ groups, order, labels }).facts.collisions!.map(issue => ({ ...issue })) as SiteIssue[]
}
export function validateBridges(bridge: BridgeInput): SiteIssue[] {
  return run({ bridge }).facts.bridgeIssues!.map(issue => ({ ...issue })) as SiteIssue[]
}
