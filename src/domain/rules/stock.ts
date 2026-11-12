import { VERIFY_RULE_INPUTS } from './runtime.ts'
import type { ScaffoldMember, ScaffoldParameters, LayoutWarning, ScaffoldConnector } from '../scaffold.ts'
import { postStocks, repairPostSplices, createPipeAssembly, spliceConnectorsFor, assembleHorizontalRuns } from './policies/stock.ts'
import { RULES } from './catalog.ts'
import { compilePipeline } from './pipeline.ts'
import type { RuleStep, Proposal } from './contracts.ts'

type Assembly = ReturnType<typeof createPipeAssembly>
type StockFacts = {
  members: ScaffoldMember[]; sequences: Record<string, number[]>; parameters: ScaffoldParameters; fixed: boolean
  inventory?: number[]; repaired?: { sequences: Record<string, number[]>; warnings: LayoutWarning[] }
  posts?: Assembly[]; horizontals?: Assembly[]; splices?: Record<string, ScaffoldConnector[]>
}
type StockProposal = Proposal & (
  | { kind: 'SelectPostInventory'; target: 'inventory'; value: number[] }
  | { kind: 'RepairPostSplices'; target: 'repaired'; value: NonNullable<StockFacts['repaired']> }
  | { kind: 'AssemblePosts'; target: 'posts'; value: Assembly[] }
  | { kind: 'AssembleHorizontals'; target: 'horizontals'; value: Assembly[] }
  | { kind: 'ConnectStockJoints'; target: 'splices'; value: Record<string, ScaffoldConnector[]> }
)
export const STOCK_STEPS: RuleStep<StockFacts, StockProposal>[] = [
  { id: 'S02.inventory', ruleId: 'S02', phase: 4, after: [], reads: ['parameters'], kinds: ['SelectPostInventory'], targets: ['inventory'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'SelectPostInventory', target: 'inventory', expectedRevision: revision,
      value: postStocks(facts.parameters as ScaffoldParameters) }] }) },
  { id: 'S03.repair', ruleId: 'S03', phase: 4, after: ['S02.inventory'], reads: ['members', 'parameters', 'sequences', 'fixed'], kinds: ['RepairPostSplices'], targets: ['repaired'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'RepairPostSplices', target: 'repaired', expectedRevision: revision,
      value: facts.fixed ? { sequences: facts.sequences as Record<string, number[]>, warnings: [] }
        : repairPostSplices(facts.members as ScaffoldMember[], facts.sequences as Record<string, number[]>, facts.parameters as ScaffoldParameters) }] }) },
  { id: 'S01.posts', ruleId: 'S01', phase: 4, after: ['S03.repair'], reads: ['members', 'parameters', 'inventory', 'repaired'], kinds: ['AssemblePosts'], targets: ['posts'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'AssemblePosts', target: 'posts', expectedRevision: revision,
      value: (facts.members as ScaffoldMember[]).filter(member => member.type === 'post').map(member => createPipeAssembly(member,
        facts.inventory as number[], facts.parameters!.spliceOverlap!, facts.repaired!.sequences[member.id] as number[] | undefined)) }] }) },
  { id: 'S01.horizontals', ruleId: 'S01', phase: 6, after: ['S01.posts'], reads: ['members', 'parameters', 'repaired'], kinds: ['AssembleHorizontals'], targets: ['horizontals'],
    evaluate: (facts, revision) => ({ status: 'proposed', proposals: [{ kind: 'AssembleHorizontals', target: 'horizontals', expectedRevision: revision,
      value: assembleHorizontalRuns(facts.members as ScaffoldMember[], facts.parameters as ScaffoldParameters, facts.repaired!.sequences as Record<string, number[]>) }] }) },
  { id: 'C02.splices', ruleId: 'C02', phase: 8, after: ['S01.horizontals'], reads: ['members', 'posts', 'horizontals'], kinds: ['ConnectStockJoints'], targets: ['splices'],
    evaluate: (facts, revision) => {
      const members = new Map((facts.members as ScaffoldMember[]).map(member => [member.id, member]))
      const value = Object.fromEntries([...(facts.posts as Assembly[]), ...(facts.horizontals as Assembly[])].map(assembly =>
        [assembly.plan.memberId, spliceConnectorsFor(members.get(assembly.plan.memberId)!, assembly.segments)]))
      return { status: 'proposed', proposals: [{ kind: 'ConnectStockJoints', target: 'splices', expectedRevision: revision, value }] }
    },
  },
]
const run = compilePipeline<StockFacts, StockProposal>(RULES, STOCK_STEPS, (facts, proposals) => {
  let result = { ...facts } as StockFacts
  for (const proposal of proposals) switch (proposal.kind) {
    case 'SelectPostInventory':
      if (proposal.value.some(length => Math.abs(length - 5) <= 0.001)) throw new Error('Forbidden post stock proposal')
      result = { ...result, inventory: proposal.value }; break
    case 'ConnectStockJoints': result = { ...result, splices: proposal.value }; break
    case 'RepairPostSplices': result = { ...result, repaired: proposal.value }; break
    case 'AssemblePosts':
    case 'AssembleHorizontals': {
      const ids = new Set(facts.members.map(member => member.id))
      if (proposal.kind === 'AssemblePosts' && proposal.value.some(assembly => assembly.segments.some(pipe => Math.abs(pipe.stockLength - 5) <= 0.001)))
        throw new Error('Forbidden post stock assembly')
      if (proposal.value.some(assembly => !ids.has(assembly.plan.memberId))) throw new Error('Dangling assembly proposal')
      result = proposal.kind === 'AssemblePosts' ? { ...result, posts: proposal.value } : { ...result, horizontals: proposal.value }
      break
    }
  }
  return result
}, { verifyImmutability: VERIFY_RULE_INPUTS,
  snapshot: input => ({ ...input, parameters: { ...input.parameters, stockLengths: [...input.parameters.stockLengths] },
    sequences: Object.fromEntries(Object.entries(input.sequences).map(([id, sequence]) => [id, [...sequence]])),
    members: input.members.map(member => ({ ...member, start: [...member.start], end: [...member.end], connectionPoints: member.connectionPoints.map(point => [...point]) })) }),
})
export function assembleStockStage(members: ScaffoldMember[], sequences: Record<string, number[]>, parameters: ScaffoldParameters, fixed = false) {
  if (!members.length) return { assemblies: [], warnings: [] }
  // Stock consumes geometry and ties, not a second copy of the provenance graph.
  const demands = members.map(({ id, type, start, end, length, layer, connectionPoints }) => ({ id, type, start, end, length, layer, connectionPoints }))
  const { facts } = run({ members: demands, sequences, parameters, fixed })
  const byId = new Map([...facts.posts!, ...facts.horizontals!].map(assembly => [assembly.plan.memberId, assembly]))
  // Until S7 is migrated, its legacy positioning adapter owns these detached
  // mutable pipe records. The committed stock stage remains immutable.
  const assemblies = members.map(member => {
    const assembly = byId.get(member.id)!
    return { segments: assembly.segments.map(pipe => ({ ...pipe, start: [...pipe.start], end: [...pipe.end] })),
      connectors: facts.splices![member.id].map(connector => ({ ...connector, position: [...connector.position], axis: connector.axis && [...connector.axis] })),
      plan: { ...assembly.plan, stockLengths: [...assembly.plan.stockLengths], segmentIds: [...assembly.plan.segmentIds] } } as Assembly & { connectors: ScaffoldConnector[] }
  })
  return { assemblies, warnings: facts.repaired!.warnings as LayoutWarning[] }
}
