import { it, expect } from 'vitest'
import { calculateMaterials } from './materials'
import { calculateSite } from '../site'
import { SITE_DEMOS } from '../siteDemos'
import { MATERIAL_KEYS, materialQuantity } from '../scaffold'

it('production quantities are derived from a unique physical ledger and reject invalid references', () => {
  const demo = SITE_DEMOS.find(demo => demo.id === 'roof')!, layout = calculateSite(demo.site, demo.parameters)
  const before = JSON.stringify(layout)
  const result = calculateMaterials(layout.members, layout.pipeSegments, layout.decks, layout.connectors, layout.baseChannels,
    demo.parameters, layout.materials.assemblyPlans, layout.materials.postHeights)
  expect(result).toEqual(layout.materials)
  expect(() => calculateMaterials(layout.members, [...layout.pipeSegments, layout.pipeSegments[0]], layout.decks, layout.connectors, layout.baseChannels,
    demo.parameters, layout.materials.assemblyPlans, layout.materials.postHeights)).toThrow('Duplicate material contribution')
  expect(() => calculateMaterials(layout.members, [{ ...layout.pipeSegments[0], memberId: 'removed' }], layout.decks, layout.connectors, layout.baseChannels,
    demo.parameters, layout.materials.assemblyPlans, layout.materials.postHeights)).toThrow('Dangling material reference')
  expect(JSON.stringify(layout)).toBe(before)
})
it('manual corrections change only displayed quantities while swivel stays unknown', () => {
  const demo = SITE_DEMOS.find(demo => demo.id === 'roof')!, layout = calculateSite(demo.site, demo.parameters)
  const before = JSON.stringify(layout), key = MATERIAL_KEYS.stock('3m')
  expect(layout.materials.stockSummary['3m']).toBe(4)
  expect(materialQuantity(4, { [key]: 2 }, key)).toBe(6)
  expect(layout.materials.connectorSummary.swivel).toBeNull()
  expect(JSON.stringify(layout)).toBe(before)
})
