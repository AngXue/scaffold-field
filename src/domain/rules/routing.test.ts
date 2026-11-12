import { describe, it, expect } from 'vitest'
import { SITE_DEMOS } from '../siteDemos'
import { prepareScene } from './scene'
import { explainRouting, routeSiteSections } from './routing'
import { balanceRoofStations, anchorRoofEntries, type RouteDraft } from './policies/routing'

describe('native scene and station stages', () => {
  it.each(['corridor', 'adjacent-houses', 'roof', 'narrow'])('%s: immutable products, deterministic output, opt-in trace', id => {
    const demo = SITE_DEMOS.find(demo => demo.id === id)!
    const saved = JSON.stringify(demo)
    const prepared = prepareScene(demo.site, demo.parameters)
    const result = explainRouting(prepared.site.sections, prepared.blocks, demo.parameters)
    expect(result.facts.routed).toEqual(routeSiteSections(prepared.site.sections, prepared.blocks, demo.parameters))
    expect(result.trace.map(entry => entry.step)).toEqual(['G01.walls', 'G06.clearance', 'G02.support', 'G04.balance', 'G05.anchor', 'G02.publish'])
    expect(Object.isFrozen(result.facts.supported)).toBe(true)
    expect(Object.isFrozen(result.facts.routed?.spans)).toBe(true)
    expect(JSON.stringify(demo)).toBe(saved)
  })
  it('keeps both-side balancing and terminal anchoring as separate immutable proposals', () => {
    const demo = SITE_DEMOS.find(demo => demo.id === 'corridor')!
    const prepared = prepareScene(demo.site, demo.parameters)
    const { facts } = explainRouting(prepared.site.sections, prepared.blocks, demo.parameters)
    const original = JSON.stringify(facts.supported)
    const balanced = balanceRoofStations(structuredClone(facts.supported!) as RouteDraft[], demo.parameters)
    const beforeAnchor = JSON.stringify(balanced)
    anchorRoofEntries(balanced, demo.parameters)
    expect(JSON.stringify(balanced)).toBe(beforeAnchor)
    expect(JSON.stringify(facts.supported)).toBe(original)
    expect(facts.supported).not.toEqual(facts.balanced)
    const roof = facts.routed!.spans.find(span => span.line.surfaceId !== 'ground')!
    expect([roof.line.start.z, roof.line.end.z].sort()).toEqual([4.1, 5.9])
  })
})
