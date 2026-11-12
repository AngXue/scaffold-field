import type { ScaffoldMember, ScaffoldConnector, ScaffoldParameters } from '../scaffold.ts'
import { CONNECTOR_CONTACT } from './facts/connections.ts'
import { buildCrossConnectors } from './policies/connections.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'

type ConnectionFacts = { members: ScaffoldMember[]; tops: Record<string, number>; parameters: Pick<ScaffoldParameters, 'pipeDiameter'>; connectors?: ScaffoldConnector[] }
type ConnectionProposal = Proposal & { kind: 'ConnectActualMembers'; target: 'connectors'; value: ScaffoldConnector[] }
export const CONNECTION_STEPS: RuleStep<ConnectionFacts, ConnectionProposal>[] = [
  { id: 'C01.actual', ruleId: 'C01', phase: 8, after: [], reads: ['members', 'tops', 'parameters'], kinds: ['ConnectActualMembers'], targets: ['connectors'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'ConnectActualMembers', target: 'connectors', expectedRevision: revision,
      value: buildCrossConnectors(facts.members as ScaffoldMember[], facts.tops as Record<string, number>, facts.parameters!) }] }) },
]
const run = compilePipeline<ConnectionFacts, ConnectionProposal>(RULES, CONNECTION_STEPS, (facts, proposals) => {
  const members = new Set(facts.members.map(member => member.id)), pairs = new Set<string>()
  if (members.size !== facts.members.length) throw new Error('Duplicate member input')
  const connectors = proposals.flatMap(proposal => proposal.value)
  for (const connector of connectors) {
    if (!members.has(connector.memberId) || !connector.connectedMemberId || !members.has(connector.connectedMemberId)) throw new Error('Dangling connector proposal')
    const pair = [connector.memberId, connector.connectedMemberId].sort().join(':')
    if (pairs.has(pair) || connector.memberId === connector.connectedMemberId) throw new Error('Duplicate or self connection')
    if (!connector[CONNECTOR_CONTACT]?.every(Number.isFinite)) throw new Error('Missing physical contact')
    pairs.add(pair)
  }
  return { ...facts, connectors } as ConnectionFacts
}, { verifyImmutability: VERIFY_RULE_INPUTS,
  snapshot: input => ({ ...input, tops: { ...input.tops }, parameters: { ...input.parameters },
    members: input.members.map(({ id, type, start, end, length, layer, roles, connectionPoints }) => ({ id, type, start: [...start], end: [...end], length, layer,
      roles: roles && [...roles], connectionPoints: connectionPoints.map(point => [...point]) })) }),
})
export function calculateConnections(members: ScaffoldMember[], tops: Record<string, number>, parameters: ScaffoldParameters): ScaffoldConnector[] {
  if (!members.length) return []
  const result = run({ members, tops, parameters: { pipeDiameter: parameters.pipeDiameter } })
  // The existing scene adapter prefixes IDs and transforms coordinates on its own records.
  return result.facts.connectors!.map(connector => ({ ...connector, position: [...connector.position], axis: [...connector.axis],
    secondaryAxis: connector.secondaryAxis && [...connector.secondaryAxis], [CONNECTOR_CONTACT]: [...connector[CONNECTOR_CONTACT]!] }))
}
