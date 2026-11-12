import type { Site, SiteLayout } from '../../site.ts'
import type { Vector3Tuple } from '../../scaffold.ts'
import { memberUses } from './memberUses.ts'
import { buildMaterialLedger } from './materialLedger.ts'

export type ConnectionNode = {
  id: string
  kind: 'footing' | 'tie' | 'splice'
  position: Vector3Tuple
  memberIds: string[]
  connectorIds: string[]
}
/** Optional explanation graph, built from the final entities, never from display labels. */
export function buildEntityGraph(site: Site, layout: SiteLayout) {
  const sources = site.sections.map(section => ({ id: section.id, surfaceId: section.surfaceId, start: { ...section.start }, end: { ...section.end } }))
  const spans = (layout.spans ?? site.sections.map(line => ({ sourceId: line.id, line, wall: false })))
    .map(span => ({ id: span.line.id, sourceId: span.sourceId, surfaceId: span.line.surfaceId, start: { ...span.line.start }, end: { ...span.line.end } }))
  const sourceIds = new Set(sources.map(source => source.id)), spanIds = new Set(spans.map(span => span.id))
  if (sourceIds.size !== sources.length || spanIds.size !== spans.length) throw new Error('Duplicate source or support span ID')
  for (const span of spans) if (!sourceIds.has(span.sourceId)) throw new Error(`Dangling span source: ${span.id}`)
  const memberIds = new Set(layout.members.map(member => member.id))
  const nodes = new Map<string, ConnectionNode>()
  const node = (kind: ConnectionNode['kind'], position: Vector3Tuple, ids: string[], connectorId?: string) => {
    for (const id of ids) if (!memberIds.has(id)) throw new Error(`Dangling connection member: ${id}`)
    const key = `${kind}:${position.map(value => Math.round(value * 1000)).join(':')}`
    const existing = nodes.get(key) ?? { id: key, kind, position: [...position] as Vector3Tuple, memberIds: [], connectorIds: [] }
    existing.memberIds = [...new Set([...existing.memberIds, ...ids])]
    if (connectorId) existing.connectorIds.push(connectorId)
    nodes.set(key, existing)
    return key
  }
  const references = new Map<string, string[]>()
  const reference = (id: string, nodeId: string) => references.set(id, [...(references.get(id) ?? []), nodeId])
  for (const member of layout.members) if (member.type === 'post') reference(member.id, node('footing', member.start, [member.id]))
  for (const connector of layout.connectors) {
    const ids = [connector.memberId, ...(connector.connectedMemberId ? [connector.connectedMemberId] : [])]
    const id = node(connector.type === 'butt' ? 'splice' : 'tie', connector.position, ids, connector.id)
    ids.forEach(memberId => reference(memberId, id))
  }
  const members = layout.members.map(member => {
    const uses = memberUses(member)
    if (!uses.length) throw new Error(`Missing member origin: ${member.id}`)
    for (const use of uses) if (!use.sectionId || !sourceIds.has(use.sectionId) || !use.spanId || !spanIds.has(use.spanId))
      throw new Error(`Dangling member origin: ${member.id}`)
    return { id: member.id, type: member.type, uses, nodeIds: [...new Set(references.get(member.id) ?? [])] }
  })
  const pipes = layout.pipeSegments.map(pipe => ({ id: pipe.id, memberId: pipe.memberId, stockLength: pipe.stockLength,
    start: [...pipe.start], end: [...pipe.end] }))
  const ledger = buildMaterialLedger(layout)
  return { sources, spans, nodes: [...nodes.values()], members, pipes, ledger }
}
export type EntityGraph = ReturnType<typeof buildEntityGraph>
