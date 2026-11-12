import type { ScaffoldLayout } from '../../scaffold.ts'
import { memberUses, type MemberUse } from './memberUses.ts'

export type MaterialContribution = {
  id: string
  entityId: string
  category: 'stock' | 'cross' | 'butt' | 'deck' | 'channel'
  specification?: number
  quantity: 1
  length?: number
  area?: number
  memberIds: string[]
  sourceSegments: number[]
  uses: readonly MemberUse[]
  rule: 'O01' | 'C01' | 'C02' | 'M05' | 'M07'
}
/** Computed quantities only. Manual deltas never enter the physical ledger. */
export function buildMaterialLedger(layout: ScaffoldLayout) {
  const members = new Map(layout.members.map(member => [member.id, member]))
  if (members.size !== layout.members.length) throw new Error('Duplicate logical member ID')
  const entries: MaterialContribution[] = []
  const seen = new Set<string>()
  const add = (entry: Omit<MaterialContribution, 'uses' | 'sourceSegments'>, fallback: number[] = []) => {
    if (seen.has(entry.id)) throw new Error(`Duplicate material contribution: ${entry.id}`)
    seen.add(entry.id)
    const uses = entry.memberIds.flatMap(id => {
      const member = members.get(id)
      if (!member) throw new Error(`Dangling material reference: ${entry.entityId} -> ${id}`)
      return [...memberUses(member)]
    })
    entries.push({ ...entry, uses, sourceSegments: [...new Set([...fallback, ...uses.map(use => use.pathSegment)])] })
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
  return { entries, unknown: { swivel: null, pending: layout.materials.pendingMaterials.map(item => ({ ...item, quantity: null })) } }
}
