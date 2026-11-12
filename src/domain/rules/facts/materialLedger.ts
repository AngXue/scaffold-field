import type { ScaffoldLayout } from '../../scaffold.ts'
import { memberUses, type MemberUse } from './memberUses.ts'

export type PhysicalContribution = {
  id: string
  entityId: string
  category: 'stock' | 'cross' | 'butt' | 'deck' | 'channel'
  specification?: number
  quantity: 1
  length?: number
  area?: number
  memberIds: string[]
  sourceSegments: number[]
  rule: 'O01' | 'C01' | 'C02' | 'M05' | 'M07'
}
export type MaterialContribution = PhysicalContribution & { uses: readonly MemberUse[] }
type PhysicalLayout = Pick<ScaffoldLayout, 'members' | 'pipeSegments' | 'connectors' | 'decks' | 'baseChannels'>
/** One physical entity, one contribution. Shared by production totals and explanation. */
export function physicalContributions(layout: PhysicalLayout): PhysicalContribution[] {
  const members = new Set(layout.members.map(member => member.id))
  if (members.size !== layout.members.length) throw new Error('Duplicate logical member ID')
  const entries: PhysicalContribution[] = [], seen = new Set<string>()
  const add = (entry: Omit<PhysicalContribution, 'sourceSegments'>, sourceSegments: number[] = []) => {
    if (seen.has(entry.id)) throw new Error(`Duplicate material contribution: ${entry.id}`)
    seen.add(entry.id)
    for (const id of entry.memberIds) if (!members.has(id)) throw new Error(`Dangling material reference: ${entry.entityId} -> ${id}`)
    entries.push({ ...entry, sourceSegments })
  }
  for (const pipe of layout.pipeSegments) add({ id: `stock:${pipe.id}`, entityId: pipe.id, category: 'stock', specification: pipe.stockLength,
    quantity: 1, length: pipe.stockLength, memberIds: [pipe.memberId], rule: 'O01' })
  for (const connector of layout.connectors) {
    if (connector.type === 'swivel') throw new Error('Swivel quantity has no modelled contribution rule')
    add({ id: `connector:${connector.id}`, entityId: connector.id, category: connector.type, quantity: 1,
      memberIds: [connector.memberId, ...(connector.connectedMemberId ? [connector.connectedMemberId] : [])], rule: connector.type === 'butt' ? 'C02' : 'C01' })
  }
  for (const deck of layout.decks) add({ id: `deck:${deck.id}`, entityId: deck.id, category: 'deck', quantity: 1,
    area: deck.area, memberIds: [], rule: 'M05' }, [deck.pathSegment])
  for (const channel of layout.baseChannels) add({ id: `channel:${channel.id}`, entityId: channel.id, category: 'channel', quantity: 1,
    length: channel.length, memberIds: [], rule: 'M07' }, [channel.pathSegment])
  return entries
}
/** Detailed uses are opt-in. Manual deltas never enter the physical ledger. */
export function buildMaterialLedger(layout: ScaffoldLayout) {
  const members = new Map(layout.members.map(member => [member.id, member]))
  const entries: MaterialContribution[] = physicalContributions(layout).map(entry => {
    const uses = entry.memberIds.flatMap(id => [...memberUses(members.get(id)!)])
    return { ...entry, uses, sourceSegments: [...new Set([...entry.sourceSegments, ...uses.map(use => use.pathSegment)])] }
  })
  return { entries, unknown: { swivel: null, pending: layout.materials.pendingMaterials.map(item => ({ ...item, quantity: null })) } }
}
