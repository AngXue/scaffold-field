/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CALCULATION_TRACE } from '../diagnostics/session'
import { calculateSite, EMPTY_SITE, type Site, type SiteLayout } from '../../site'
import { DEFAULT_PARAMETERS, type ScaffoldMember, type ScaffoldConnector, type PipeSegment } from '../../scaffold'
import { SITE_DEMOS } from '../../siteDemos'
import { buildEntityGraph } from './entityGraph'
import { SemanticIdentities } from './identity'
import { MEMBER_USES, makeUse } from './memberUses'
import { CONNECTOR_CONTACT } from './connections'

it('checks semantic-key collisions and rejects non-finite identity geometry', () => {
  const ids = new SemanticIdentities(() => 'same')
  expect(ids.of('post', ['S1', 0])).toBe(ids.of('post', ['S1', 0]))
  expect(ids.of('pipe', ['S1', 1])).toBe('pipe:same')
  expect(() => ids.of('post', ['S2', 0])).toThrow('collision')
  expect(() => new SemanticIdentities().of('post', [Infinity])).toThrow('Non-finite')
})

it('keeps internal identities and references when display aliases and output traversal order change', () => {
  const demo = SITE_DEMOS.find(demo => demo.id === 'adjacent-houses')!
  const layout = calculateSite(demo.site, demo.parameters), before = JSON.stringify(layout)
  const alias = (id: string) => `display-renamed/${id}`
  const renamed: SiteLayout = { ...layout,
    members: layout.members.map(member => ({ ...member, id: alias(member.id), connectionPoints: [...member.connectionPoints].reverse(), [MEMBER_USES]: [...member[MEMBER_USES]!].reverse() })).reverse(),
    pipeSegments: layout.pipeSegments.map(pipe => ({ ...pipe, id: alias(pipe.id), memberId: alias(pipe.memberId) })).reverse(),
    connectors: layout.connectors.map(connector => ({ ...connector, id: alias(connector.id), memberId: alias(connector.memberId),
      connectedMemberId: connector.connectedMemberId && alias(connector.connectedMemberId) })).reverse(),
    decks: layout.decks.map(deck => ({ ...deck, id: alias(deck.id) })).reverse(),
    baseChannels: layout.baseChannels.map(base => ({ ...base, id: alias(base.id) })).reverse(),
  }
  const a = buildEntityGraph(demo.site, layout), b = buildEntityGraph(demo.site, renamed)
  for (const key of ['members', 'pipes', 'connectors', 'decks', 'bases'] as const) expect(b[key].map(item => item.id)).toEqual(a[key].map(item => item.id))
  expect(b.nodes).toEqual(a.nodes)
  expect(b.ledger.entries.map(entry => [entry.id, entry.entityId, entry.memberIds, entry.sourceIds]))
    .toEqual(a.ledger.entries.map(entry => [entry.id, entry.entityId, entry.memberIds, entry.sourceIds]))
  expect(JSON.stringify(layout)).toBe(before)
})

function coincident() {
  const site: Site = { ...EMPTY_SITE, sections: ['A', 'B'].map(id => ({ id, start: { x: 0, z: 0 }, end: { x: 2, z: 0 }, surfaceId: 'ground', layers: 1 })) }
  const members: ScaffoldMember[] = []
  const connectors: ScaffoldConnector[] = [], pipes: PipeSegment[] = []
  for (const [index, section] of site.sections.entries()) {
    for (const type of ['post', 'longitudinal'] as const) {
      const id = `${section.id}-${type}`, start: [number, number, number] = type === 'post' ? [0, 0, 0] : [-1, 1, 0]
      const end: [number, number, number] = type === 'post' ? [0, 2, 0] : [1, 1, 0]
      members.push({ id, type, start, end, length: 2, connectionPoints: [[0, 1, 0]], pathSegment: index,
        [MEMBER_USES]: [{ ...makeUse(index, type, start, end, 'M01'), sectionId: section.id, spanId: section.id }] })
      pipes.push({ id: `pipe-${id}`, memberId: id, type, start, end, stockLength: 2, sequence: 1, overlapWithPrevious: 0 })
    }
    connectors.push({ id: `tie-${section.id}`, type: 'cross', position: [0, 1.03, 0], [CONNECTOR_CONTACT]: [0, 1, 0],
      memberId: `${section.id}-longitudinal`, connectedMemberId: `${section.id}-post`, axis: [1, 0, 0], secondaryAxis: [0, 1, 0] })
  }
  const layout: SiteLayout = { ...calculateSite(EMPTY_SITE, DEFAULT_PARAMETERS), members, connectors, pipeSegments: pipes }
  return { site, layout }
}
it('does not connect independent members just because their contacts and footings coincide', () => {
  const { site, layout } = coincident(), graph = buildEntityGraph(site, layout)
  expect(graph.nodes.filter(node => node.kind === 'footing')).toHaveLength(2)
  const ties = graph.nodes.filter(node => node.kind === 'tie')
  expect(ties).toHaveLength(2)
  expect(ties.map(node => node.connectorIds.length)).toEqual([1, 1])
  expect(ties[0].memberIds.every(id => !ties[1].memberIds.includes(id))).toBe(true)
  // A third real fitting joins these components; this is connectivity evidence.
  layout.connectors.push({ ...layout.connectors[0], id: 'tie-between', connectedMemberId: 'B-post' })
  const connected = buildEntityGraph(site, layout).nodes.filter(node => node.kind === 'tie')
  expect(connected).toHaveLength(1)
  expect(connected[0].memberIds).toHaveLength(4)
  expect(connected[0].connectorIds).toHaveLength(3)
})
it('rejects a fitting with no actual stock at its contact and dangling support sources', () => {
  const { site, layout } = coincident()
  const wrong = { ...layout, connectors: [{ ...layout.connectors[0], [CONNECTOR_CONTACT]: [0, 4, 0] as [number, number, number] }] }
  expect(() => buildEntityGraph(site, wrong)).toThrow('no physical stock')
  const member = layout.members[0]
  const lost = { ...layout, members: [{ ...member, [MEMBER_USES]: member[MEMBER_USES]!.map(use => ({ ...use, sectionId: 'missing' })) }, ...layout.members.slice(1)] }
  expect(() => buildEntityGraph(site, lost)).toThrow('Dangling member origin')
})
it('keeps separate splice nodes for independent stacks at the same coordinates', () => {
  const { site, layout } = coincident()
  layout.members = layout.members.filter(member => member.type === 'post')
  layout.pipeSegments = layout.members.flatMap(member => [1, 2].map(sequence => ({ id: `pipe-${member.id}-${sequence}`, memberId: member.id,
    type: member.type, start: [0, sequence - 1, 0] as [number, number, number], end: [0, sequence, 0] as [number, number, number], stockLength: 1, sequence, overlapWithPrevious: 0 })))
  layout.connectors = layout.members.map(member => ({ id: `splice-${member.id}`, type: 'butt', position: [0, 1, 0], memberId: member.id, axis: [0, 1, 0] }))
  const graph = buildEntityGraph(site, layout), nodes = graph.nodes.filter(node => node.kind === 'splice')
  expect(nodes).toHaveLength(2)
  expect(nodes.every(node => node.pipeIds.length === 2 && node.memberIds.length === 1)).toBe(true)
})

const root = resolve(import.meta.dirname, '../../../..')
const ordinary = JSON.parse(readFileSync(resolve(root, 'fixtures/rules/manifest.json'), 'utf8')).cases as string[]
const large = JSON.parse(readFileSync(resolve(root, 'fixtures/rules/performance/manifest.json'), 'utf8')).cases as string[]
describe('fixed projects: complete physical graph references', () => {
  it.each([...ordinary, ...large])('%s retains every final material entity including blocked drafts', id => {
    const input = JSON.parse(readFileSync(resolve(root, `fixtures/rules/${large.includes(id) ? 'performance/' : ''}${id}.json`), 'utf8'))
    const layout = calculateSite(input.scene, input.parameters, { trace: true }), graph = buildEntityGraph(input.scene, layout)
    const events = layout[CALCULATION_TRACE]!, lastPlacement = events.findLastIndex(event => event.step === 'S04.positionStock')
    for (const [index, event] of events.entries()) if (['C01.actual', 'C02.splices'].includes(event.step)) expect(index).toBeGreaterThan(lastPlacement)
    expect(graph.ledger.entries).toHaveLength(layout.pipeSegments.length + layout.connectors.length + layout.decks.length + layout.baseChannels.length)
    expect(new Set(graph.ledger.entries.map(entry => entry.entityId)).size).toBe(graph.ledger.entries.length)
    const construction = new Map(graph.construction.map(node => [node.id, node]))
    expect(graph.members.every(member => member.constructionId && construction.has(member.constructionId)), id).toBe(true)
    for (const node of construction.values()) {
      expect(node.parentIds.every(parent => construction.has(parent)), id).toBe(true)
      if (node.operation === 'demand') expect(node.useIds.length, id).toBeGreaterThan(0)
      if (node.operation === 'merge') expect(node.parentIds.length, id).toBeGreaterThanOrEqual(2)
    }
    const ancestry = (key: string): string[] => [key, ...construction.get(key)!.parentIds.flatMap(ancestry)]
    for (const post of graph.members.filter(member => member.type === 'post')) {
      const ancestors = ancestry(post.constructionId!).map(key => construction.get(key)!)
      expect(ancestors.some(node => node.operation === 'emit'), id).toBe(true)
      expect(ancestors.some(node => node.id.startsWith('post-demand:')), id).toBe(true)
    }
    const stockVersions = new Map(graph.stockConstruction.map(node => [node.id, node]))
    const selections = new Map(graph.stockSelections.map(choice => [choice.id, choice]))
    for (const pipe of graph.pipes) {
      expect(pipe.constructionId, id).toBeDefined()
      const version = stockVersions.get(pipe.constructionId!)!
      expect(version.start, id).toEqual(pipe.start); expect(version.end, id).toEqual(pipe.end)
      expect(version.stockLength, id).toBe(pipe.stockLength)
      const choice = selections.get(version.selectionId)!
      expect(construction.has(choice.memberConstructionId), id).toBe(true)
      expect(choice.stockLengths[pipe.sequence - 1], id).toBe(pipe.stockLength)
    }
    const entities = new Set([...graph.pipes, ...graph.connectors, ...graph.decks, ...graph.bases].map(entity => entity.id))
    expect(graph.ledger.entries.every(entry => entities.has(entry.entityId) && entry.sourceIds.length > 0)).toBe(true)
    const members = new Set(graph.members.map(member => member.id)), pipes = new Set(graph.pipes.map(pipe => pipe.id))
    expect(graph.nodes.every(node => node.memberIds.every(id => members.has(id)) && node.pipeIds.every(id => pipes.has(id)))).toBe(true)
  // This includes development input freezing, complete ancestry and per-entity assertions.
  // Production latency and RSS have their separate paired threefold gate.
  }, 30000)
})

it.each([1, 2])('explains S1 upper bridges and the removed B2 caps without losing neighbouring protection (%s courses)', guardrailRailCount => {
  const demo = SITE_DEMOS.find(demo => demo.id === 'adjacent-houses')!
  const graph = buildEntityGraph(demo.site, calculateSite(demo.site, { ...demo.parameters, guardrailRailCount }))
  const ranges = new Map(graph.ranges.map(range => [range.id, range]))
  const lineage = new Map(graph.lineage.map(record => [record.id, record]))
  // Fixed historical courses: one mid-rail, or 0.60 / 1.176 m above each lift.
  const elevations = guardrailRailCount === 1 ? [6.58, 8.46, 9.7] : [6.24, 6.816, 8.12, 8.696, 9.7]
  for (const y of elevations) {
    const bridge = graph.members.find(member => member.uses.some(use => use.purpose === 'bridge-guard'
      && Math.abs(use.start[1] - y) < 0.001 && Math.abs(use.start[2] + 3.25) < 0.001
      && Math.abs(Math.min(use.start[0], use.end[0]) - 5.05) < 0.001 && Math.abs(Math.max(use.start[0], use.end[0]) - 6.85) < 0.001))!
    expect(bridge).toBeDefined()
    expect(bridge.spanIds.length).toBeGreaterThanOrEqual(2)
    const physical = graph.pipes.filter(pipe => pipe.memberId === bridge.id)
    expect(physical.length).toBeGreaterThan(0)
    expect(graph.ledger.entries.filter(entry => entry.category === 'stock' && entry.memberIds.includes(bridge.id)))
      .toHaveLength(physical.length)
    const cap = graph.retired.find(record => {
      const range = ranges.get(record.useId)!
      return record.rule === 'P06' && range.purpose === 'end-guard'
        && Math.abs(range.start[0] - 6.85) < 0.001 && Math.abs(range.start[1] - y) < 0.001
    })!
    expect(cap).toBeDefined()
    expect(lineage.get(cap.useId)!.replacedBy).toContain(cap.id)
    expect(graph.ledger.entries.some(entry => entry.entityId === cap.id)).toBe(false)
    // The neighbouring outside rail is shortened, not deleted with that cap.
    const replacement = graph.replacements.find(change => {
      const after = ranges.get(change.after)!
      return change.rule === 'P06' && Math.abs(after.start[0] - 5.05) < 0.001 && Math.abs(after.start[1] - y) < 0.001
        && Math.abs(after.end[2] + 3.25) < 0.001
    })!
    expect(replacement).toBeDefined()
    expect(lineage.get(replacement.before)!.replacedBy).toContain(replacement.after)
    expect(graph.members.some(member => member.useIds.includes(replacement.after))).toBe(true)
  }
  const sourceIds = new Set(graph.sources.map(source => source.id))
  const leaves = (id: string): string[] => {
    const record = lineage.get(id)!
    return record.derivedFrom.length ? record.derivedFrom.flatMap(leaves) : [id]
  }
  expect(graph.ledger.entries.every(entry => leaves(entry.id).every(id => sourceIds.has(id)))).toBe(true)
})
