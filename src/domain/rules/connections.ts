import type { ScaffoldMember, ScaffoldConnector, ScaffoldParameters, PipeSegment } from '../scaffold.ts'
import { CONNECTOR_CONTACT, stockContainsContact } from './facts/connections.ts'
import { prepareCrossContacts } from './policies/connections.ts'
import type { CrossContactIntent, FittingPlan } from './facts/fittings.ts'
import { Vector } from './facts/vector.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { Proposal, RuleStep } from './contracts.ts'

type ContactFacts = { members: ScaffoldMember[]; tops: Record<string, number>; diameter: number; contacts?: CrossContactIntent[] }
type ContactProposal = Proposal & { kind: 'PlanContacts'; target: 'contacts'; value: CrossContactIntent[] }
export const CONTACT_STEPS: RuleStep<ContactFacts, ContactProposal>[] = [
  { id: 'C01.contacts', ruleId: 'C01', phase: 6, after: [], reads: ['members', 'tops', 'diameter'], kinds: ['PlanContacts'], targets: ['contacts'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'PlanContacts', target: 'contacts', expectedRevision: revision,
      value: prepareCrossContacts(facts.members as ScaffoldMember[], facts.tops as Record<string, number>, { pipeDiameter: facts.diameter! }) }] }) },
]
const planContacts = compilePipeline<ContactFacts, ContactProposal>(RULES, CONTACT_STEPS, (facts, proposals) => {
  const members = new Set(facts.members.map(member => member.id)), pairs = new Set<string>()
  if (members.size !== facts.members.length) throw new Error('Duplicate member input')
  const contacts = proposals.flatMap(proposal => proposal.value)
  for (const contact of contacts) {
    if (!members.has(contact.memberId) || !members.has(contact.connectedMemberId)) throw new Error('Dangling contact proposal')
    const pair = [contact.memberId, contact.connectedMemberId].sort().join(':')
    if (pairs.has(pair) || contact.memberId === contact.connectedMemberId) throw new Error('Duplicate or self connection')
    if (!contact.contact.every(Number.isFinite)) throw new Error('Missing physical contact')
    pairs.add(pair)
  }
  return { ...facts, contacts } as ContactFacts
}, { verifyImmutability: VERIFY_RULE_INPUTS, snapshot: VERIFY_RULE_INPUTS ? undefined : facts => facts })

export function prepareFittingPlan(members: ScaffoldMember[], tops: Record<string, number>, parameters: Pick<ScaffoldParameters, 'pipeDiameter'>, pipes: readonly PipeSegment[]): FittingPlan {
  const { facts } = planContacts({ members, tops, diameter: parameters.pipeDiameter })
  // Only members with an actual stock seam need a sleeve intent. The compact
  // membership list still proves full stock ownership, including one-piece runs.
  const joined = new Set(pipes.filter(pipe => pipe.sequence > 1).map(pipe => pipe.memberId))
  const contacts = facts.contacts as CrossContactIntent[]
  return { memberIds: members.map(member => member.id),
    contacts: VERIFY_RULE_INPUTS ? contacts.map(contact => ({ ...contact, contact: [...contact.contact], displayPosition: [...contact.displayPosition],
      axis: [...contact.axis], secondaryAxis: [...contact.secondaryAxis] })) : contacts,
    splices: members.filter(member => joined.has(member.id)).map(member => ({ memberId: member.id, displayPrefix: `C-${member.id}-splice-`,
      axis: new Vector(member.end).subtract(new Vector(member.start)).normalize().toTuple() })) }
}

type FittingFacts = { members: ScaffoldMember[]; pipes: PipeSegment[]; plans: FittingPlan[]; stock: Record<string, PipeSegment[]>; cross?: ScaffoldConnector[][]; butt?: ScaffoldConnector[][] }
type FittingProposal = Proposal & (
  | { kind: 'ConnectActualMembers'; target: 'cross'; value: ScaffoldConnector[][] }
  | { kind: 'ConnectStockJoints'; target: 'butt'; value: ScaffoldConnector[][] }
)
function stockByMember(pipes: readonly PipeSegment[]) {
  const groups: Record<string, PipeSegment[]> = Object.create(null)
  for (const pipe of pipes) (groups[pipe.memberId] ??= []).push(pipe)
  for (const group of Object.values(groups)) if (group.length > 1) group.sort((a, b) => a.sequence - b.sequence)
  return groups
}
export const CONNECTION_STEPS: RuleStep<FittingFacts, FittingProposal>[] = [
  { id: 'C01.actual', ruleId: 'C01', phase: 8, after: [], reads: ['stock', 'plans'], kinds: ['ConnectActualMembers'], targets: ['cross'],
    evaluate: (facts, revision) => {
      const stock = facts.stock!
      const value = facts.plans!.map(plan => plan.contacts.map(contact => {
        if (!stock[contact.memberId]?.some(pipe => stockContainsContact(pipe, contact.contact))
          || !stock[contact.connectedMemberId]?.some(pipe => stockContainsContact(pipe, contact.contact)))
          throw new Error('Contact is not supported by final stock geometry')
        return { id: contact.displayId, type: 'cross' as const, [CONNECTOR_CONTACT]: [...contact.contact], position: [...contact.displayPosition],
          memberId: contact.memberId, connectedMemberId: contact.connectedMemberId, axis: [...contact.axis], secondaryAxis: [...contact.secondaryAxis] } as ScaffoldConnector
      }))
      return { status: 'proposed', proposals: [{ kind: 'ConnectActualMembers', target: 'cross', expectedRevision: revision, value }] }
    } },
  { id: 'C02.splices', ruleId: 'C02', phase: 8, after: [], reads: ['stock', 'plans'], kinds: ['ConnectStockJoints'], targets: ['butt'],
    evaluate: (facts, revision) => {
      const stock = facts.stock!
      const value = facts.plans!.map(plan => plan.splices.flatMap(intent => {
        const pipes = stock[intent.memberId]
        if (!pipes?.length) throw new Error('Splice plan references unbuilt stock')
        return pipes.slice(1).map((pipe, index) => ({ id: `${intent.displayPrefix}${index + 1}`, type: 'butt' as const,
          position: [...pipe.start], memberId: intent.memberId, axis: [...intent.axis] } as ScaffoldConnector))
      }))
      return { status: 'proposed', proposals: [{ kind: 'ConnectStockJoints', target: 'butt', expectedRevision: revision, value }] }
    } },
]
const finish = compilePipeline<FittingFacts, FittingProposal>(RULES, CONNECTION_STEPS, (facts, proposals) => {
  let result = { ...facts } as FittingFacts
  const seenIds = new Set<string>(), pairs = new Set<string>()
  for (const proposal of proposals) {
    for (const connector of proposal.value.flat()) {
      if (!Object.hasOwn(facts.stock, connector.memberId) || connector.connectedMemberId && !Object.hasOwn(facts.stock, connector.connectedMemberId))
        throw new Error('Dangling final connector proposal')
      if (seenIds.has(connector.id)) throw new Error('Duplicate final fitting')
      seenIds.add(connector.id)
      if (connector.type === 'cross') {
        const pair = [connector.memberId, connector.connectedMemberId!].sort().join(':')
        if (pairs.has(pair) || connector.memberId === connector.connectedMemberId) throw new Error('Duplicate or self final connection')
        pairs.add(pair)
      }
    }
    result = proposal.kind === 'ConnectActualMembers' ? { ...result, cross: proposal.value } : { ...result, butt: proposal.value }
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS, snapshot: VERIFY_RULE_INPUTS ? undefined : facts => facts })
/** S8 owns fittings only after the caller commits the final stock positions. */
export function finishFittings(members: ScaffoldMember[], pipes: PipeSegment[], plans: FittingPlan[]): ScaffoldConnector[] {
  if (!plans.length) {
    if (pipes.length) throw new Error('Final stock has no fitting plan')
    return []
  }
  const stock = validatedStock(members, pipes, plans)
  const { facts } = finish({ members, pipes, plans, stock })
  const connectors = plans.flatMap((_, index) => [...facts.cross![index], ...facts.butt![index]]) as ScaffoldConnector[]
  // Compatibility callers own their returned records. Development freeze checks
  // must not turn that public output into a different mutability contract.
  return VERIFY_RULE_INPUTS ? connectors.map(connector => ({ ...connector, position: [...connector.position], axis: [...connector.axis],
    ...(connector.secondaryAxis && { secondaryAxis: [...connector.secondaryAxis] }),
    ...(connector[CONNECTOR_CONTACT] && { [CONNECTOR_CONTACT]: [...connector[CONNECTOR_CONTACT]] }),
  })) : connectors
}

/** Validation scratch sets die before S8 allocates the full fitting population. */
function validatedStock(members: ScaffoldMember[], pipes: PipeSegment[], plans: FittingPlan[]) {
  const memberIds = new Set(members.map(member => member.id)), planned = plans.flatMap(plan => plan.memberIds)
  const plannedIds = new Set(planned), pipeIds = new Set(pipes.map(pipe => pipe.id))
  if (memberIds.size !== members.length || pipeIds.size !== pipes.length || plannedIds.size !== planned.length) throw new Error('Duplicate final assembly input')
  if (plannedIds.size !== memberIds.size || planned.some(id => !memberIds.has(id)) || pipes.some(pipe => !plannedIds.has(pipe.memberId))) throw new Error('Unplanned or dangling final stock')
  const intents = plans.flatMap(plan => plan.splices.map(intent => intent.memberId)), seams = new Set(intents)
  if (seams.size !== intents.length || intents.some(id => !plannedIds.has(id))
    || pipes.some(pipe => pipe.sequence > 1 && !seams.has(pipe.memberId))) throw new Error('Missing or duplicate stock seam plan')
  const stock = stockByMember(pipes)
  if (Object.keys(stock).length !== plannedIds.size) throw new Error('Planned member has no physical stock')
  return stock

}
