import { describe, it, expect } from 'vitest'
import { MEMBER_USES, makeUse, memberUses, clipUses } from './memberUses'
import { mergeSharedRuns } from '../policies/sharedMembers'
import { buildEntityGraph } from './entityGraph'
import { buildMaterialLedger } from './materialLedger'
import { calculateSite } from '../../site'
import { SITE_DEMOS } from '../../siteDemos'
import type { ScaffoldMember } from '../../scaffold'
const rail = (id: string, x: number, end: number, segment: number, purpose: 'end-guard' | 'side-guard'): ScaffoldMember => ({
  id, type: 'guardrail', start: [x, 2, 0], end: [end, 2, 0], length: end - x, layer: 1, pathSegment: segment,
  connectionPoints: [[x, 2, 0], [end, 2, 0]], [MEMBER_USES]: [makeUse(segment, purpose, [x, 2, 0], [end, 2, 0], 'P02')],
})
describe('member provenance and final physical material ledger', () => {
  it('merges separate purposes without mutating the bridge validation snapshot', () => {
    const bridge = rail('bridge', 0, 1, 0, 'end-guard'), neighbour = rail('neighbour', 1, 5, 1, 'side-guard')
    const original = JSON.stringify([bridge, neighbour])
    const merged = mergeSharedRuns([bridge, neighbour])
    expect(merged).toHaveLength(1)
    expect(merged[0].end).toEqual([5, 2, 0])
    expect(JSON.stringify([bridge, neighbour])).toBe(original)
    expect(memberUses(merged[0]).map(use => [use.pathSegment, use.purpose, use.start[0], use.end[0]]))
      .toEqual([[0, 'end-guard', 0, 1], [1, 'side-guard', 1, 5]])
    const remaining = clipUses(merged[0], [1, 2, 0], [5, 2, 0], 'P06')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]).toMatchObject({ pathSegment: 1, purpose: 'side-guard', rules: ['P02', 'M08', 'P06'] })
  })
  it.each(['roof', 'corridor', 'adjacent-houses', 'legacy'])('%s: every physical contribution is unique and matches the computed BOM', id => {
    const demo = SITE_DEMOS.find(d => d.id === id)!
    const layout = calculateSite(demo.site, demo.parameters), ledger = buildMaterialLedger(layout)
    const graph = buildEntityGraph(demo.site, layout)
    expect(graph.members).toHaveLength(layout.members.length)
    expect(graph.nodes.filter(node => node.kind === 'footing')).toHaveLength(layout.members.filter(member => member.type === 'post').length)
    expect(graph.nodes.flatMap(node => node.connectorIds)).toHaveLength(layout.connectors.length)
    expect(layout.members.every(member => memberUses(member).length)).toBe(true)
    const stock: Record<string, number> = {}
    for (const entry of ledger.entries.filter(entry => entry.category === 'stock')) {
      expect(entry.uses.length).toBeGreaterThan(0)
      const key = `${entry.specification}m`; stock[key] = (stock[key] ?? 0) + 1
    }
    expect(stock).toEqual(layout.materials.stockSummary)
    expect(ledger.entries.filter(e => e.category === 'cross')).toHaveLength(layout.materials.connectorSummary.cross)
    expect(ledger.entries.filter(e => e.category === 'butt')).toHaveLength(layout.materials.connectorSummary.butt)
    expect(ledger.entries.filter(e => e.category === 'deck')).toHaveLength(layout.materials.deckCount)
    expect(ledger.entries.filter(e => e.category === 'channel')).toHaveLength(layout.materials.channelSteel.count)
    expect(ledger.unknown.swivel).toBeNull()
    // Legacy exports intentionally carry no calculation-only symbol metadata.
    expect(JSON.stringify(layout)).not.toContain('scaffold.memberUses')
  })
  it('detects dangling references and duplicate contributions instead of silently counting', () => {
    const demo = SITE_DEMOS.find(d => d.id === 'roof')!, layout = calculateSite(demo.site, demo.parameters)
    expect(() => buildMaterialLedger({ ...layout, pipeSegments: [...layout.pipeSegments, layout.pipeSegments[0]] })).toThrow('Duplicate material')
    expect(() => buildMaterialLedger({ ...layout, pipeSegments: [{ ...layout.pipeSegments[0], memberId: 'missing' }] })).toThrow('Dangling')
  })
})

it.each([1, 2])('S1 upper guards retain support-span origins after merging, clipping and rotating (%s courses)', guardrailRailCount => {
  const demo = SITE_DEMOS.find(d => d.id === 'adjacent-houses')!
  for (const rotate of [false, true]) {
    const transform = (p: { x: number; z: number }) => rotate ? { x: -p.z + 13, z: p.x - 7 } : { ...p }
    const site = { ...demo.site, blocks: demo.site.blocks.map(block => {
      const corners = [{ x: block.x, z: block.z }, { x: block.x + block.width, z: block.z + block.depth }].map(transform)
      return { ...block, x: Math.min(...corners.map(p => p.x)), z: Math.min(...corners.map(p => p.z)),
        width: rotate ? block.depth : block.width, depth: rotate ? block.width : block.depth, outline: block.outline?.map(transform) }
    }), sections: demo.site.sections.map(section => ({ ...section, start: transform(section.start), end: transform(section.end) })) }
    const layout = calculateSite(site, { ...demo.parameters, guardrailRailCount }), graph = buildEntityGraph(site, layout)
    expect(layout.issues).toEqual([])
    const bridges = graph.members.filter(member => member.uses.some(use => use.purpose === 'bridge-guard'))
    expect(bridges.length).toBeGreaterThan(0)
    for (const bridge of bridges) {
      const useSpans = new Set(bridge.uses.filter(use => use.purpose === 'bridge-guard').map(use => use.spanId))
      expect(useSpans.size).toBeGreaterThanOrEqual(2)
      expect(bridge.nodeIds.length).toBeGreaterThan(0)
      expect(graph.ledger.entries.some(entry => entry.category === 'stock' && entry.memberIds.includes(bridge.id))).toBe(true)
    }
  }
})
