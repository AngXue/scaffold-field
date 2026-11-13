import { displayId, publicIdentity, type DisplayIdentity } from '../facts/displayIdentity.ts'
import { mapParts } from '../facts/partHistory.ts'
import type { ScaffoldLayout } from '../../scaffold.ts'

/** One-way S9 compatibility projection, after the native contribution ledger. */
export function publishEntityAliases<T extends ScaffoldLayout>(layout: T): T {
  const aliases = (entities: readonly ({ id: string } & DisplayIdentity)[]) => {
    const pairs = entities.map(entity => [entity.id, displayId(entity)] as const), ids = new Map(pairs)
    if (ids.size !== entities.length || new Set(ids.values()).size !== entities.length)
      throw new Error('Duplicate native identity or compatibility label')
    return ids
  }
  const memberIds = aliases(layout.members), pipeIds = aliases(layout.pipeSegments)
  aliases(layout.decks); aliases(layout.baseChannels); aliases(layout.connectors)
  const reference = (ids: ReadonlyMap<string, string>, id: string) => {
    const label = ids.get(id)
    if (label === undefined) throw new Error(`Dangling compatibility reference: ${id}`)
    return label
  }
  return { ...layout,
    members: layout.members.map(publicIdentity),
    pipeSegments: layout.pipeSegments.map(pipe => ({ ...publicIdentity(pipe), memberId: reference(memberIds, pipe.memberId) })),
    connectors: layout.connectors.map(connector => ({ ...publicIdentity(connector), memberId: reference(memberIds, connector.memberId),
      ...(connector.connectedMemberId !== undefined && { connectedMemberId: reference(memberIds, connector.connectedMemberId) }) })),
    decks: mapParts(layout.decks, publicIdentity), baseChannels: mapParts(layout.baseChannels, publicIdentity),
    materials: { ...layout.materials, assemblyPlans: layout.materials.assemblyPlans.map(plan => ({ ...plan,
      memberId: reference(memberIds, plan.memberId), segmentIds: plan.segmentIds.map(id => reference(pipeIds, id)) })) },
  }
}
