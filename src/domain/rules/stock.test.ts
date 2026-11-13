import { describe, it, expect } from 'vitest'
import { calculateSite } from '../site'
import { SITE_DEMOS } from '../siteDemos'
import { DEFAULT_PARAMETERS, type ScaffoldMember } from '../scaffold'
import { prepareFittingPlan, finishFittings } from './connections'
import { assembleStockStage } from './stock'
import { repairPostSplices, assembleHorizontalRuns } from './policies/stock'

describe('stock proposals and real splice contributions', () => {
  it('reassembles fixed posts without changing prior committed sequences or geometry', () => {
    const demo = SITE_DEMOS.find(demo => demo.id === 'roof')!
    const layout = calculateSite({ ...demo.site, sections: demo.site.sections.map(section => ({ ...section, layers: 3 })) }, demo.parameters)
    const sequences = Object.fromEntries(layout.materials.assemblyPlans.map(plan => [plan.memberId, [...plan.stockLengths]]))
    const original = JSON.stringify({ layout, sequences, parameters: demo.parameters })
    const result = assembleStockStage(layout.members, sequences, demo.parameters, true)
    expect(result.assemblies.flatMap(assembly => assembly.segments).map(pipe => ({ ...pipe, id: '' })))
      .toEqual(layout.pipeSegments.map(pipe => ({ ...pipe, id: '' })))
    expect(finishFittings(layout.members, result.assemblies.flatMap(assembly => assembly.segments), [{ ...prepareFittingPlan(layout.members, {}, demo.parameters, result.assemblies.flatMap(assembly => assembly.segments)), contacts: [] }]).map(connector => ({ ...connector, id: '' })))
      .toEqual(layout.connectors.filter(connector => connector.type === 'butt').map(connector => ({ ...connector, id: '' })))
    expect(JSON.stringify({ layout, sequences, parameters: demo.parameters })).toBe(original)
  })
  it('rejects an illegal inherited post sequence, even when fixed geometry bypasses repair', () => {
    const post: ScaffoldMember = { id: 'post', type: 'post', start: [0, 0, 0], end: [0, 4, 0], length: 4, connectionPoints: [] }
    expect(() => assembleStockStage([post], { post: [5] }, DEFAULT_PARAMETERS, true)).toThrow('Forbidden post stock assembly')
  })
  it('repairs sequences privately and counts one sleeve per actual stock seam', () => {
    const posts: ScaffoldMember[] = [0, 1].map(x => ({ id: `post-${x}`, type: 'post', start: [x, 0, 0], end: [x, 10, 0], length: 10, connectionPoints: [] }))
    const rail: ScaffoldMember = { id: 'rail', type: 'longitudinal', start: [0, 1.88, 0], end: [1, 1.88, 0], layer: 1, length: 1, connectionPoints: [[0, 1.88, 0], [1, 1.88, 0]] }
    const sequences = { 'post-0': [6, 4], 'post-1': [6, 4] }, original = structuredClone(sequences)
    const repaired = repairPostSplices([...posts, rail], sequences, DEFAULT_PARAMETERS)
    expect(sequences).toEqual(original)
    expect(repaired.sequences['post-1']).not.toEqual(original['post-1'])
    const result = assembleStockStage([...posts, rail], sequences, DEFAULT_PARAMETERS)
    const plan = { ...prepareFittingPlan([...posts, rail], {}, DEFAULT_PARAMETERS, result.assemblies.flatMap(assembly => assembly.segments)), contacts: [] }
    const fittings = finishFittings([...posts, rail], result.assemblies.flatMap(assembly => assembly.segments), [plan])
    for (const assembly of result.assemblies) {
      expect(assembly).not.toHaveProperty('connectors')
      const connectors = fittings.filter(connector => connector.memberId === assembly.plan.memberId)
      expect(connectors).toHaveLength(assembly.segments.length - 1)
      expect(connectors.map(connector => connector.position)).toEqual(assembly.segments.slice(1).map(pipe => pipe.start))
    }
  })
})

it('request-local stock memoization equals uncached selection and cannot leak across inventories or overlaps', () => {
  const members: ScaffoldMember[] = [0.75, 1.8, 1.8, 3.7, 6.2, 6.2, 8.2].map((length, index) => ({
    id: `M${index}`, type: 'longitudinal', start: [0, index, 0], end: [length, index, 0], length, connectionPoints: [],
  }))
  for (const stockLengths of [[...DEFAULT_PARAMETERS.stockLengths], [6, 2.4, 1.2], [4, 2]]) for (const spliceOverlap of [0, 0.3, 1]) {
    const parameters = { ...DEFAULT_PARAMETERS, stockLengths, spliceOverlap }
    expect(assembleHorizontalRuns(members, parameters, {}, true)).toEqual(assembleHorizontalRuns(members, parameters, {}, false))
  }
})
