import type { Site, SiteLayout } from '../../site.ts'
import type { PipeSegment, Vector3Tuple } from '../../scaffold.ts'
import { contactOf, stockContainsContact } from './connections.ts'
import { memberUses, RETIRED_USES, type MemberUse } from './memberUses.ts'
import { validateLineage, type LineageRecord, type RangeReplacement } from './lineage.ts'
import { buildMaterialLedger } from './materialLedger.ts'
import { CONSTRUCTION_FRAMES, FRAME_SCOPES } from './scopes.ts'
import { canonicalPoints, SemanticIdentities } from './identity.ts'

export type ConnectionNode = {
  id: string
  kind: 'footing' | 'tie' | 'splice'
  position: Vector3Tuple
  memberIds: string[]
  connectorIds: string[]
  pipeIds: string[]
}
const pointKey = (point: readonly number[]) => point.map(value => Math.round(value * 1000)).join(':')
function uniqueLegacy<T extends { id: string }>(values: readonly T[], kind: string): Map<string, T> {
  const map = new Map(values.map(value => [value.id, value]))
  if (map.size !== values.length) throw new Error(`Duplicate ${kind} ID`)
  return map
}

/** Optional explanation graph. All links use semantic IDs; legacy IDs are aliases only. */
export function buildEntityGraph(site: Site, layout: SiteLayout) {
  const ids = new SemanticIdentities(), published = new Set<string>()
  const publish = <T extends { id: string }>(entity: T): T => {
    if (published.has(entity.id)) throw new Error(`Ambiguous duplicate entity identity: ${entity.id}`)
    published.add(entity.id)
    return entity
  }
  const sources = site.sections.map(section => publish({ id: ids.of('source', [section.id]), legacyId: section.id,
    surfaceId: section.surfaceId, start: { ...section.start }, end: { ...section.end } }))
  const sourceIds = new Map(sources.map(source => [source.legacyId, source.id]))
  const routed = layout.spans ?? site.sections.map(line => ({ sourceId: line.id, line, wall: false }))
  const spans = routed.map(span => {
    const sourceId = sourceIds.get(span.sourceId)
    if (!sourceId) throw new Error(`Dangling span source: ${span.line.id}`)
    const { start, end, surfaceId } = span.line
    return publish({ id: ids.of('span', [sourceId, surfaceId, [start.x, start.z], [end.x, end.z]]),
      legacyId: span.line.id, sourceId, surfaceId, start: { ...start }, end: { ...end } })
  })
  const spanByLegacy = new Map(spans.map(span => [span.legacyId, span]))
  if (sourceIds.size !== sources.length || spanByLegacy.size !== spans.length) throw new Error('Duplicate source or support span ID')
  const frames = (layout[CONSTRUCTION_FRAMES] ?? []).map(frame => publish({ id: frame.id, spanIds: frame.spanIds.map(id => {
    const span = spanByLegacy.get(id)
    if (!span) throw new Error(`Dangling construction frame span: ${id}`)
    return span.id
  }).sort() }))
  const frameIds = new Set(frames.map(frame => frame.id))
  const frameReferences = (entity: { [FRAME_SCOPES]?: readonly string[] }) => {
    const result = [...(entity[FRAME_SCOPES] ?? [])].sort()
    if (result.some(id => !frameIds.has(id))) throw new Error('Dangling construction frame reference')
    return result
  }
  uniqueLegacy(layout.members, 'logical member')
  const ranges = new Map<string, { id: string; spanId: string; sourceId: string; purpose: MemberUse['purpose']; start: Vector3Tuple; end: Vector3Tuple; rules: string[] }>()
  const replacements = new Map<string, RangeReplacement>()
  const registerRange = (use: MemberUse, sourceId: string, spanId: string, endpoints: readonly Vector3Tuple[]) => {
    const [start, end] = canonicalPoints(endpoints) as [Vector3Tuple, Vector3Tuple]
    const id = ids.of('use', [sourceId, spanId, use.purpose, [start, end]])
    const previous = ranges.get(id)
    ranges.set(id, { id, spanId, sourceId, purpose: use.purpose, start, end, rules: [...new Set([...(previous?.rules ?? []), ...use.rules])].sort() })
    return id
  }
  const registerUse = (use: MemberUse, owner: string) => {
    const sourceId = use.sectionId && sourceIds.get(use.sectionId), span = use.spanId && spanByLegacy.get(use.spanId)
    if (!sourceId || !span || span.sourceId !== sourceId) throw new Error(`Dangling member origin: ${owner}`)
    const useId = registerRange(use, sourceId, span.id, [use.start, use.end])
    for (const change of use.changes ?? []) {
      const before = registerRange(use, sourceId, span.id, change.before), after = registerRange(use, sourceId, span.id, change.after)
      if (before !== after) replacements.set(`${before}|${after}|${change.rule}`, { rule: change.rule, before, after })
    }
    return { sourceId, spanId: span.id, useId }
  }
  const members = layout.members.map(member => {
    const uses = memberUses(member)
    if (!uses.length) throw new Error(`Missing member origin: ${member.id}`)
    const useIds: string[] = []
    const origins = uses.map(use => {
      const { sourceId, spanId, useId } = registerUse(use, member.id)
      useIds.push(useId)
      return [sourceId, spanId, use.purpose, canonicalPoints([use.start, use.end])] as const
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    return publish({ id: ids.of('member', [[...new Set(member.roles ?? [member.type])].sort(), member.layer ?? null,
      canonicalPoints([member.start, member.end]), canonicalPoints(member.connectionPoints), origins]),
      legacyId: member.id, type: member.type, frameIds: frameReferences(member), uses, useIds: [...new Set(useIds)].sort(), nodeIds: [] as string[], sourceIds: [...new Set(origins.map(origin => origin[0]))].sort(),
      spanIds: [...new Set(origins.map(origin => origin[1]))].sort() })
  })
  const retired = [...new Map((layout[RETIRED_USES] ?? []).map(record => {
    const { useId } = registerUse(record.use, `${record.rule}.${record.reason}`)
    const id = ids.of('removed-use', [useId, record.rule, record.reason])
    return [id, { id, useId, rule: record.rule, reason: record.reason }] as const
  })).values()]
  const byMember = new Map(members.map(member => [member.legacyId, member]))
  const memberId = (legacyId: string) => {
    const member = byMember.get(legacyId)
    if (!member) throw new Error(`Dangling connection member: ${legacyId}`)
    return member.id
  }
  uniqueLegacy(layout.pipeSegments, 'physical pipe')
  const pipes = layout.pipeSegments.map(pipe => publish({ id: ids.of('pipe', [memberId(pipe.memberId), pipe.sequence, pipe.stockLength]),
    legacyId: pipe.id, memberId: memberId(pipe.memberId), stockLength: pipe.stockLength, sequence: pipe.sequence,
    start: [...pipe.start], end: [...pipe.end] }))
  const pipeIds = new Map(pipes.map(pipe => [pipe.legacyId, pipe.id]))
  const pipesByMember = new Map<string, PipeSegment[]>()
  for (const pipe of layout.pipeSegments) {
    const group = pipesByMember.get(pipe.memberId) ?? []
    group.push(pipe); pipesByMember.set(pipe.memberId, group)
  }
  for (const group of pipesByMember.values()) group.sort((a, b) => a.sequence - b.sequence)
  uniqueLegacy(layout.connectors, 'connector')
  const connectors = layout.connectors.map(connector => {
    const memberIds = [connector.memberId, ...(connector.connectedMemberId ? [connector.connectedMemberId] : [])].map(memberId).sort()
    const contact = contactOf(connector)
    const owned = pipesByMember.get(connector.memberId) ?? []
    let linked: PipeSegment[]
    if (connector.type === 'butt') {
      const index = owned.findIndex((pipe, i) => i > 0 && pipe.start.every((value, axis) => Math.abs(value - contact[axis]) <= 0.00101))
      if (index < 1) throw new Error(`Splice has no adjacent stock: ${connector.id}`)
      linked = [owned[index - 1], owned[index]]
    } else {
      linked = [connector.memberId, ...(connector.connectedMemberId ? [connector.connectedMemberId] : [])].flatMap(id => {
        const attached = (pipesByMember.get(id) ?? []).filter(pipe => stockContainsContact(pipe, contact))
        if (!attached.length) throw new Error(`Tie has no physical stock at contact: ${connector.id} -> ${id}`)
        return attached
      })
    }
    const pipeReferences = linked.map(pipe => pipeIds.get(pipe.id)!).sort()
    return publish({ id: ids.of('connector', [connector.type, memberIds, pointKey(contact), ...(connector.type === 'butt' ? [pipeReferences] : [])]),
      legacyId: connector.id, type: connector.type, memberIds, pipeIds: pipeReferences, contact: [...contact] as Vector3Tuple })
  })
  const nodes: ConnectionNode[] = []
  const addNode = (kind: ConnectionNode['kind'], position: Vector3Tuple, memberIds: string[], fittingIds: string[], stockIds: string[]) => {
    const uniqueMembers = [...new Set(memberIds)].sort(), uniqueStock = [...new Set(stockIds)].sort()
    const node = publish({ id: ids.of('node', [kind, pointKey(position), uniqueMembers, ...(kind === 'splice' ? [uniqueStock] : [])]),
      kind, position: [...position] as Vector3Tuple, memberIds: uniqueMembers, connectorIds: [...fittingIds].sort(), pipeIds: uniqueStock })
    nodes.push(node)
    return node.id
  }
  for (const member of layout.members) if (member.type === 'post') {
    const stock = pipesByMember.get(member.id) ?? []
    addNode('footing', member.start, [memberId(member.id)], [], stock.length ? [pipeIds.get(stock[0].id)!] : [])
  }
  const ties = new Map<string, typeof connectors>()
  for (const connector of connectors) {
    if (connector.type === 'butt') addNode('splice', connector.contact, connector.memberIds, [connector.id], connector.pipeIds)
    else {
      const key = pointKey(connector.contact), group = ties.get(key) ?? []
      group.push(connector); ties.set(key, group)
    }
  }
  // Equal coordinates are a bucket, never evidence that disjoint fittings connect.
  for (const group of ties.values()) {
    const parent = new Map<string, string>()
    const root = (id: string): string => {
      const next = parent.get(id)
      if (!next) { parent.set(id, id); return id }
      if (next === id) return id
      const result = root(next); parent.set(id, result); return result
    }
    for (const connector of group) {
      const first = root(connector.memberIds[0])
      for (const member of connector.memberIds.slice(1)) parent.set(root(member), first)
    }
    const components = new Map<string, typeof connectors>()
    for (const connector of group) {
      const key = root(connector.memberIds[0]), component = components.get(key) ?? []
      component.push(connector); components.set(key, component)
    }
    for (const component of components.values()) {
      const position = canonicalPoints(component.map(connector => connector.contact))[0] as Vector3Tuple
      addNode('tie', position, component.flatMap(connector => connector.memberIds), component.map(connector => connector.id), component.flatMap(connector => connector.pipeIds))
    }
  }
  const byInternalMember = new Map(members.map(member => [member.id, member]))
  for (const node of nodes) for (const id of node.memberIds) byInternalMember.get(id)!.nodeIds.push(node.id)
  members.forEach(member => member.nodeIds.sort())
  const spanFor = (segment: number) => {
    const span = spans[segment]
    if (!span) throw new Error(`Dangling component support span: ${segment}`)
    return span
  }
  const decks = layout.decks.map(deck => publish({ id: ids.of('deck', [spanFor(deck.pathSegment).id, deck.layer, canonicalPoints(deck.corners)]),
    legacyId: deck.id, frameIds: frameReferences(deck), spanIds: [spanFor(deck.pathSegment).id], sourceIds: [spanFor(deck.pathSegment).sourceId] }))
  const bases = layout.baseChannels.map(base => publish({ id: ids.of('base', [spanFor(base.pathSegment).id, canonicalPoints([base.start, base.end])]),
    legacyId: base.id, spanIds: [spanFor(base.pathSegment).id], sourceIds: [spanFor(base.pathSegment).sourceId] }))
  const ledger = buildMaterialLedger(layout)
  const aliases = new Map<string, string>([
    ...pipes.map(pipe => [`stock:${pipe.legacyId}`, pipe.id] as const),
    ...connectors.map(connector => [`connector:${connector.legacyId}`, connector.id] as const),
    ...decks.map(deck => [`deck:${deck.legacyId}`, deck.id] as const), ...bases.map(base => [`channel:${base.legacyId}`, base.id] as const),
  ])
  const entries = ledger.entries.map(entry => {
    const entityId = aliases.get(entry.id)
    if (!entityId) throw new Error(`Dangling contribution entity: ${entry.id}`)
    return publish({ ...entry, id: ids.of('contribution', [entry.category, entityId]), legacyId: entry.id, entityId,
      memberIds: entry.memberIds.map(memberId), sourceIds: [...new Set([
        ...entry.uses.map(use => sourceIds.get(use.sectionId!)!), ...entry.sourceSegments.map(segment => spanFor(segment).sourceId),
      ])].sort() })
  })
  const lineage = new Map<string, LineageRecord>()
  const derive = (id: string, kind: string, parents: readonly string[] = []) => {
    if (lineage.has(id)) throw new Error(`Duplicate lineage identity: ${id}`)
    lineage.set(id, { id, kind, derivedFrom: [...new Set(parents)].sort(), replacedBy: [] })
  }
  sources.forEach(source => derive(source.id, 'source'))
  spans.forEach(span => derive(span.id, 'span', [span.sourceId]))
  frames.forEach(frame => derive(frame.id, 'frame', frame.spanIds))
  ranges.forEach(range => derive(range.id, 'use', [range.spanId]))
  for (const replacement of replacements.values()) {
    lineage.get(replacement.after)!.derivedFrom.push(replacement.before)
    lineage.get(replacement.before)!.replacedBy.push(replacement.after)
  }
  retired.forEach(record => {
    derive(record.id, 'removed-use', [record.useId])
    lineage.get(record.useId)!.replacedBy.push(record.id)
  })
  members.forEach(member => derive(member.id, 'member', [...member.useIds, ...member.frameIds]))
  pipes.forEach(pipe => derive(pipe.id, 'pipe', [pipe.memberId]))
  nodes.forEach(node => derive(node.id, 'node', node.memberIds))
  const connectorNodes = new Map(nodes.flatMap(node => node.connectorIds.map(id => [id, node.id] as const)))
  connectors.forEach(connector => derive(connector.id, 'connector', [...connector.pipeIds, connectorNodes.get(connector.id)!]))
  decks.forEach(deck => derive(deck.id, 'deck', deck.spanIds))
  bases.forEach(base => derive(base.id, 'base', base.spanIds))
  entries.forEach(entry => derive(entry.id, 'contribution', [entry.entityId]))
  for (const record of lineage.values()) {
    record.derivedFrom = [...new Set(record.derivedFrom)].sort()
    record.replacedBy = [...new Set(record.replacedBy)].sort()
  }
  validateLineage([...lineage.values()])
  const ordered = <T extends { id: string }>(values: T[]) => values.sort((a, b) => a.id.localeCompare(b.id))
  return { identityVersion: 1, lineageScope: 'final entities, retained interval replacements and removed guard purposes; intermediate merged entity identities pending',
    frames: ordered(frames), retired: ordered(retired),
    ranges: ordered([...ranges.values()]), replacements: [...replacements.values()].sort((a, b) => a.before.localeCompare(b.before) || a.after.localeCompare(b.after)),
    lineage: ordered([...lineage.values()]), sources: ordered(sources), spans: ordered(spans), nodes: ordered(nodes), members: ordered(members),
    pipes: ordered(pipes), connectors: ordered(connectors), decks: ordered(decks), bases: ordered(bases), ledger: { ...ledger, entries: ordered(entries) } }
}
export type EntityGraph = ReturnType<typeof buildEntityGraph>
