import { INTERNAL_ID } from './displayIdentity.ts'
import type { StationPlan, StationVersion } from './stations.ts'
import { PART_HISTORY, removedParts, partShapeChanged, type PartHistory } from './partHistory.ts'
import { STOCK_HISTORY, type StockHistory, type StockSelection } from './stockHistory.ts'
import { MEMBER_HISTORY, type MemberHistory } from './memberHistory.ts'
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
  type StationRecord = Omit<StationVersion,'origins'> & { sourceIds:string[]; spanIds:string[] }
  const stationVersions = new Map<string,StationRecord>(), stationPlans = new WeakSet<StationPlan>()
  const registerStations = (plan: StationPlan) => {
    if (stationPlans.has(plan)) return
    const local = new Map(plan.versions.map(node => [node.id,node])), localIds = new Set(local.keys())
    if (localIds.size !== plan.versions.length) throw new Error(`Duplicate station version: ${plan.id}`)
    const active = new Set<string>(), done = new Set<string>()
    const visit = (id:string) => {
      if (active.has(id)) throw new Error(`Cyclic station history: ${id}`)
      if (done.has(id)) return
      const node=local.get(id)
      if (!node) throw new Error(`Dangling station ancestor: ${id}`)
      active.add(id); node.parentIds.forEach(visit); active.delete(id); done.add(id)
    }
    plan.versions.forEach(node=>visit(node.id))
    for (const node of plan.versions) {
      if (node.parentIds.some(id => !localIds.has(id))) throw new Error(`Dangling station ancestor: ${node.id}`)
      const spanIds = node.origins.map(origin => {
        const span = origin.spanId ? spanByLegacy.get(origin.spanId) : spans[origin.pathSegment]
        if (!span || (origin.sectionId && sourceIds.get(origin.sectionId) !== span.sourceId)) throw new Error(`Dangling station origin: ${node.id}`)
        return span.id
      })
      const {origins, ...data} = node
      const record = {...data,spanIds:[...new Set(spanIds)].sort(),sourceIds:[...new Set(origins.map(origin =>
        (origin.spanId ? spanByLegacy.get(origin.spanId) : spans[origin.pathSegment])!.sourceId))].sort()}
      const previous = stationVersions.get(node.id)
      if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw new Error(`Conflicting station version: ${node.id}`)
      if (!previous) stationVersions.set(node.id,publish(record))
    }
    for (const id of [...plan.heads.flat(2),...plan.cornerIds]) if (!localIds.has(id)) throw new Error(`Dangling station head: ${id}`)
    stationPlans.add(plan)
  }
  type ConstructionRecord = Pick<MemberHistory, 'id' | 'operation' | 'rules' | 'type' | 'roles' | 'start' | 'end'> & { parentIds: string[]; useIds: string[]; stationIds:string[] }
  const construction = new Map<string, ConstructionRecord>(), visitedHistory = new WeakMap<MemberHistory, string>(), activeHistory = new Set<string>()
  const registerHistory = (node: MemberHistory): string => {
    const visited = visitedHistory.get(node)
    if (visited) return visited
    if (activeHistory.has(node.id)) throw new Error(`Cyclic construction history: ${node.id}`)
    activeHistory.add(node.id)
    const parentIds = [...new Set(node.parents.map(registerHistory))].sort()
    if (node.station) registerStations(node.station.plan)
    const stationIds = [...new Set(node.station?.ids ?? [])].sort()
    for (const id of stationIds) {
      const station = stationVersions.get(id)
      if (!station || !['keep','corner'].includes(station.operation)) throw new Error(`Invalid post station: ${id}`)
      if (station.point.some((value,axis) => value !== node.start[axis])) throw new Error(`Post differs from its station: ${id}`)
    }
    const useIds = [...new Set(node.uses.map(use => registerUse(use, node.id).useId))].sort()
    const data: ConstructionRecord = { id: node.id, operation: node.operation, rules: [...node.rules].sort(), type: node.type,
      roles: [...node.roles].sort(), start: [...node.start], end: [...node.end], parentIds, useIds, stationIds }
    const previous = construction.get(node.id)
    if (previous && JSON.stringify(previous) !== JSON.stringify(data)) throw new Error(`Conflicting construction history: ${node.id}`)
    if (!previous) construction.set(node.id, publish(data))
    activeHistory.delete(node.id); visitedHistory.set(node, node.id)
    return node.id
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
      legacyId: member.id, nativeId: member[INTERNAL_ID], constructionId: member[MEMBER_HISTORY] && registerHistory(member[MEMBER_HISTORY]), type: member.type, frameIds: frameReferences(member), uses, useIds: [...new Set(useIds)].sort(), nodeIds: [] as string[], sourceIds: [...new Set(origins.map(origin => origin[0]))].sort(),
      spanIds: [...new Set(origins.map(origin => origin[1]))].sort() })
  })
  const retired = [...new Map((layout[RETIRED_USES] ?? []).map(record => {
    const { useId } = registerUse(record.use, `${record.rule}.${record.reason}`)
    const id = ids.of('removed-use', [useId, record.rule, record.reason])
    return [id, { id, useId, rule: record.rule, reason: record.reason, constructionId: record.history && registerHistory(record.history) }] as const
  })).values()]
  const byMember = new Map(members.map(member => [member.legacyId, member]))
  const memberId = (legacyId: string) => {
    const member = byMember.get(legacyId)
    if (!member) throw new Error(`Dangling connection member: ${legacyId}`)
    return member.id
  }
  const selections = new Map<string, StockSelection>()
  type StockVersion = Omit<StockHistory, 'parent' | 'selection'> & { selectionId: string; parentId?: string }
  const stockVersions = new Map<string, StockVersion>(), activeStock = new Set<string>(), visitedStock = new WeakMap<StockHistory, string>()
  const registerStock = (node: StockHistory): string => {
    const cached = visitedStock.get(node)
    if (cached) return cached
    if (activeStock.has(node.id)) throw new Error(`Cyclic stock history: ${node.id}`)
    activeStock.add(node.id)
    const { selection, parent, ...values } = node
    if (selection.stockLengths[node.sequence - 1] !== node.stockLength
      || (parent && (parent.selection.id !== selection.id || parent.sequence !== node.sequence || parent.stockLength !== node.stockLength)))
      throw new Error(`Stock history changed a purchased piece: ${node.id}`)
    const priorSelection = selections.get(selection.id)
    if (priorSelection && JSON.stringify(priorSelection) !== JSON.stringify(selection)) throw new Error(`Conflicting stock selection: ${selection.id}`)
    if (!priorSelection) selections.set(selection.id, publish(selection))
    const data: StockVersion = { ...values, selectionId: selection.id, parentId: parent && registerStock(parent) }
    const previous = stockVersions.get(node.id)
    if (previous && JSON.stringify(previous) !== JSON.stringify(data)) throw new Error(`Conflicting stock history: ${node.id}`)
    if (!previous) stockVersions.set(node.id, publish(data))
    activeStock.delete(node.id); visitedStock.set(node, node.id)
    return node.id
  }
  const physicalByAlias = uniqueLegacy(layout.pipeSegments, 'physical pipe')
  const pipes = layout.pipeSegments.map(pipe => publish({ id: ids.of('pipe', [memberId(pipe.memberId), pipe.sequence, pipe.stockLength]),
    legacyId: pipe.id, nativeId: pipe[INTERNAL_ID], constructionId: pipe[STOCK_HISTORY] && registerStock(pipe[STOCK_HISTORY]), memberId: memberId(pipe.memberId), stockLength: pipe.stockLength, sequence: pipe.sequence,
    start: [...pipe.start], end: [...pipe.end] }))
  const hasAncestor = (head: string, target: string): boolean => {
    const pending = [head], seen = new Set<string>()
    while (pending.length) {
      const id = pending.pop()!
      if (id === target) return true
      if (seen.has(id)) continue
      seen.add(id); pending.push(...(construction.get(id)?.parentIds ?? []))
    }
    return false
  }
  for (const pipe of pipes) if (pipe.constructionId) {
    const version = stockVersions.get(pipe.constructionId)!, selection = selections.get(version.selectionId)!
    if (version.sequence !== pipe.sequence || version.stockLength !== pipe.stockLength
      || version.start.some((value, axis) => value !== pipe.start[axis]) || version.end.some((value, axis) => value !== pipe.end[axis]))
      throw new Error(`Final pipe differs from its construction: ${pipe.legacyId}`)
    const member = byMember.get(physicalByAlias.get(pipe.legacyId)!.memberId)!
    if (member.constructionId && !hasAncestor(member.constructionId, selection.memberConstructionId))
      throw new Error(`Stock selection has no matching member ancestor: ${pipe.legacyId}`)
  }
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
      legacyId: connector.id, nativeId: connector[INTERNAL_ID], type: connector.type, memberIds, pipeIds: pipeReferences, contact: [...contact] as Vector3Tuple })
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
  type PartVersion = Omit<PartHistory, 'parents' | 'inputs' | 'origins'> & { parentIds: string[]; inputIds: string[]; sourceIds: string[]; spanIds: string[] }
  const partVersions = new Map<string,PartVersion>(), visitedParts = new WeakMap<PartHistory,string>(), activeParts = new Set<string>()
  const registerPart = (node: PartHistory): string => {
    const cached = visitedParts.get(node)
    if (cached) return cached
    if (activeParts.has(node.id)) throw new Error(`Cyclic part history: ${node.id}`)
    activeParts.add(node.id)
    const { parents, inputs, origins, ...values } = node
    const parentIds = [...new Set(parents.map(registerPart))].sort(), inputIds = [...new Set(inputs.map(registerPart))].sort()
    const originSpans = origins.map(origin => {
      const span = origin.spanId ? spanByLegacy.get(origin.spanId) : spanFor(origin.pathSegment)
      if (!span || (origin.sectionId && sourceIds.get(origin.sectionId) !== span.sourceId)) throw new Error(`Dangling part origin: ${node.id}`)
      return span
    })
    if (node.supportIds.some(id => !construction.has(id))) throw new Error(`Dangling part support: ${node.id}`)
    const record: PartVersion = { ...values, parentIds, inputIds, spanIds: [...new Set(originSpans.map(span => span.id))].sort(),
      sourceIds: [...new Set(originSpans.map(span => span.sourceId))].sort() }
    const previous = partVersions.get(node.id)
    if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw new Error(`Conflicting part history: ${node.id}`)
    if (!previous) partVersions.set(node.id,publish(record))
    activeParts.delete(node.id); visitedParts.set(node,node.id)
    return node.id
  }
  const partSources = (history: PartHistory | undefined, segment: number) => {
    const constructionId = history && registerPart(history), record = constructionId && partVersions.get(constructionId)
    return { constructionId, spanIds: record ? record.spanIds : [spanFor(segment).id], sourceIds: record ? record.sourceIds : [spanFor(segment).sourceId] }
  }
  const decks = layout.decks.map(deck => publish({ id: ids.of('deck', [spanFor(deck.pathSegment).id, deck.layer, canonicalPoints(deck.corners)]),
    legacyId: deck.id, nativeId: deck[INTERNAL_ID], frameIds: frameReferences(deck), ...partSources(deck[PART_HISTORY],deck.pathSegment) }))
  const bases = layout.baseChannels.map(base => publish({ id: ids.of('base', [spanFor(base.pathSegment).id, canonicalPoints([base.start, base.end])]),
    legacyId: base.id, nativeId: base[INTERNAL_ID], ...partSources(base[PART_HISTORY],base.pathSegment) }))
  for (const part of [...layout.decks,...layout.baseChannels]) if (part[PART_HISTORY]) {
    if (part[PART_HISTORY]!.operation === 'remove' || partShapeChanged(part,part[PART_HISTORY]!))
      throw new Error(`Final part differs from its construction: ${part.id}`)
  }
  const removedPartIds = [...new Set([...removedParts(layout.decks), ...removedParts(layout.baseChannels)].map(registerPart))].sort()
  const partEntities = new Map([...decks,...bases].map(part => [part.id,part]))
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
        ...(partEntities.get(entityId)?.sourceIds ?? []),
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
  stationVersions.forEach(record => derive(record.id, `station-${record.operation}`, [...record.parentIds,...record.spanIds]))
  stationVersions.forEach(record => record.parentIds.forEach(id => lineage.get(id)!.replacedBy.push(record.id)))
  construction.forEach(record => derive(record.id, `member-${record.operation}`, [...record.parentIds, ...record.useIds,...record.stationIds]))
  for (const record of construction.values()) if (['merge', 'clip', 'purpose-removal'].includes(record.operation)) {
    for (const parent of record.parentIds) lineage.get(parent)!.replacedBy.push(record.id)
  }
  retired.forEach(record => {
    derive(record.id, 'removed-use', [record.useId, ...(record.constructionId ? [record.constructionId] : [])])
    lineage.get(record.useId)!.replacedBy.push(record.id)
  })
  members.forEach(member => derive(member.id, 'member', [...member.useIds, ...member.frameIds, ...(member.constructionId ? [member.constructionId] : [])]))
  selections.forEach(selection => derive(selection.id, 'stock-selection', [selection.memberConstructionId]))
  stockVersions.forEach(version => derive(version.id, `stock-${version.operation}`, [version.selectionId, ...(version.parentId ? [version.parentId] : [])]))
  stockVersions.forEach(version => { if (version.parentId) lineage.get(version.parentId)!.replacedBy.push(version.id) })
  pipes.forEach(pipe => derive(pipe.id, 'pipe', [pipe.memberId, ...(pipe.constructionId ? [pipe.constructionId] : [])]))
  nodes.forEach(node => derive(node.id, 'node', node.memberIds))
  const connectorNodes = new Map(nodes.flatMap(node => node.connectorIds.map(id => [id, node.id] as const)))
  connectors.forEach(connector => derive(connector.id, 'connector', [...connector.pipeIds, connectorNodes.get(connector.id)!]))
  partVersions.forEach(part => derive(part.id, `${part.kind}-${part.operation}`, [...part.parentIds,...part.inputIds,...part.supportIds,...part.spanIds]))
  partVersions.forEach(part => { for (const parent of part.parentIds) lineage.get(parent)!.replacedBy.push(part.id) })
  decks.forEach(deck => derive(deck.id, 'deck', [...deck.spanIds,...(deck.constructionId ? [deck.constructionId] : [])]))
  bases.forEach(base => derive(base.id, 'base', [...base.spanIds,...(base.constructionId ? [base.constructionId] : [])]))
  entries.forEach(entry => derive(entry.id, 'contribution', [entry.entityId]))
  for (const record of lineage.values()) {
    record.derivedFrom = [...new Set(record.derivedFrom)].sort()
    record.replacedBy = [...new Set(record.replacedBy)].sort()
  }
  validateLineage([...lineage.values()])
  const ordered = <T extends { id: string }>(values: T[]) => values.sort((a, b) => a.id.localeCompare(b.id))
  return { identityVersion: 1, lineageScope: 'actual member demand, merge, connection, clip and removal history; actual stock selection, assembly and position history; actual deck/base creation, coverage, support, deduplication and retirement history; actual station grid, alignment and retention decisions',
    construction: ordered([...construction.values()]), stockSelections: ordered([...selections.values()]), stockConstruction: ordered([...stockVersions.values()]),
    partConstruction: ordered([...partVersions.values()]), removedPartIds, stationConstruction:ordered([...stationVersions.values()]),
    frames: ordered(frames), retired: ordered(retired),
    ranges: ordered([...ranges.values()]), replacements: [...replacements.values()].sort((a, b) => a.before.localeCompare(b.before) || a.after.localeCompare(b.after)),
    lineage: ordered([...lineage.values()]), sources: ordered(sources), spans: ordered(spans), nodes: ordered(nodes), members: ordered(members),
    pipes: ordered(pipes), connectors: ordered(connectors), decks: ordered(decks), bases: ordered(bases), ledger: { ...ledger, entries: ordered(entries) } }
}
export type EntityGraph = ReturnType<typeof buildEntityGraph>
