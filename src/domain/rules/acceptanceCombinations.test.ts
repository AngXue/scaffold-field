import { expect, it } from 'vitest'
import { reconcileComponents } from './components'
import { positionStock } from './placement'
import { prepareFittingPlan, finishFittings } from './connections'
import { contactOf } from './facts/connections'
import { calculateSite, GROUND, type Site } from '../site'
import { SITE_DEMOS } from '../siteDemos'
import { DEFAULT_PARAMETERS, MATERIAL_KEYS, materialQuantity, stockMaterialRows, type DeckPanel, type ScaffoldMember, type Vector3Tuple, type ScaffoldLayout } from '../scaffold'
import { CALCULATION_META } from './diagnostics/session'
import { exportSceneProject, readProject } from './boundaries/projects'
import { addHistoryRecord, parseHistory, serialiseHistory } from '../history'
import { legacySnapshot, siteFromSnapshot } from '../site'

it('K05 M06 + P08: cut panel seams remain inside the walkway and do not change the chosen whole-pipe position', () => {
  const panel = (id: string, low: number, high: number): DeckPanel => ({ id, layer: 1, pathSegment: 0,
    area: 1.3 * (high - low), corners: [[3.7, 1.935, low], [5, 1.935, low], [5, 1.935, high], [3.7, 1.935, high]] })
  const member: ScaffoldMember = { id: 'rail', type: 'guardrail', layer: 1, start: [0, 2.82, 0], end: [3.7, 2.82, 0], length: 3.7,
    connectionPoints: [[0, 2.82, 0], [3.7, 2.82, 0]] }
  const run = (source: DeckPanel[]) => {
    // M06 actually clips the overlap: the two purchased panels survive, but the
    // second coverage starts at the first one's edge on the rail centre line.
    const { decks } = reconcileComponents([], source, [], {})
    const pipes = [1, 2].map(sequence => ({ id: `p${sequence}`, memberId: 'rail', type: 'guardrail' as const, stockLength: 2,
      sequence, overlapWithPrevious: 0, start: [-0.15 + 2 * (sequence - 1), 2.82, 0] as Vector3Tuple, end: [-0.15 + 2 * sequence, 2.82, 0] as Vector3Tuple }))
    const plan = prepareFittingPlan([member], {}, DEFAULT_PARAMETERS, pipes)
    positionStock({ members: [member], decks, pipeSegments: pipes, connectors: [] }, { transitions: [], cells: [], obstacles: [], radius: 0.024, walkway: true })
    return { decks, pipes, fittings: finishFittings([member], pipes, [plan]) }
  }
  const cut = run([panel('left', -1, 0), panel('right', -0.1, 1)]), whole = run([panel('whole', -1, 1)])
  expect(cut.decks).toHaveLength(2)
  expect(cut.decks.reduce((sum, deck) => sum + deck.area, 0)).toBe(2.6)
  expect(cut.decks[1].coverage![0].map(p => mm(p[2])).sort()).toEqual([0, 0, 1000, 1000])
  expect(cut.pipes).toEqual(whole.pipes)
  expect(cut.pipes[0].start[0]).toBeCloseTo(-0.3, 8)
  expect(cut.pipes[1].end[0]).toBeCloseTo(3.7, 8)
  expect(cut.pipes.map(pipe => pipe.stockLength)).toEqual([2, 2])
  expect(cut.fittings[0].position[0]).toBeCloseTo(1.7, 8)
})

it('K07 O02 + O03 + O01: manual deltas survive project and history round trips without becoming geometry or calculation input', () => {
  const demo = SITE_DEMOS.find(d => d.id === 'roof')!, original = calculateSite(demo.site, demo.parameters)
  const adjustments = { [MATERIAL_KEYS.stock('5m')]: 2, [MATERIAL_KEYS.connector('cross')]: 30 }
  const exported = exportSceneProject(demo.site, demo.parameters, adjustments, original)
  const restored = readProject(JSON.stringify(exported))!
  const history = parseHistory(serialiseHistory(addHistoryRecord([], { ...legacySnapshot(restored.scene), ...restored }, { now: 1, id: 'H1' })))
  expect(history[0].adjustments).toEqual(adjustments)
  expect(siteFromSnapshot(history[0])).toEqual(demo.site)
  const result = calculateSite(restored.scene, restored.parameters)
  expect(JSON.stringify(result)).toBe(JSON.stringify(original))
  expect(result[CALCULATION_META]).toEqual(original[CALCULATION_META])
  expect(result.materials.stockSummary['5m']).toBeUndefined()
  expect(stockMaterialRows(result.materials.stockSummary, restored.adjustments)[0]).toEqual({ length: '5m', calculated: 0, quantity: 2 })
  expect(materialQuantity(result.materials.connectorSummary.cross, restored.adjustments, MATERIAL_KEYS.connector('cross'))).toBe(58)
  expect(result.materials.connectorSummary.cross).toBe(28)
  expect(result.materials.connectorSummary.swivel).toBeNull()
})

const mm = (value: number) => Math.round(value * 1000) || 0
const sorted = (values: unknown[]) => values.map(value => JSON.stringify(value)).sort()
function physicalSignature(layout: ScaffoldLayout, inverse: (p: Vector3Tuple) => Vector3Tuple = p => p) {
  const point = (p: Vector3Tuple) => inverse(p).map(mm)
  const line = (start: Vector3Tuple, end: Vector3Tuple) => sorted([point(start), point(end)])
  return {
    members: sorted(layout.members.map(member => [member.type, line(member.start, member.end), sorted(member.connectionPoints.map(point))])),
    pipes: sorted(layout.pipeSegments.map(pipe => [pipe.type, pipe.stockLength, line(pipe.start, pipe.end)])),
    bases: sorted(layout.baseChannels.map(base => [base.length, line(base.start, base.end)])),
    decks: sorted(layout.decks.map(deck => [deck.area, sorted(deck.corners.map(point)), sorted((deck.coverage ?? [deck.corners]).map(face => sorted(face.map(point))))])),
    // Display offsets are deliberately visual. Compare the real contact, and
    // physical sleeves, independently of compatibility numbering or traversal.
    fittings: sorted(layout.connectors.map(fitting => [fitting.type, point(contactOf(fitting))])),
  }
}
it.each(['corridor', 'adjacent-houses'])('K08 %s: translating and rotating preserves all physical entities at millimetre precision', id => {
  const demo = SITE_DEMOS.find(d => d.id === id)!
  const original = calculateSite(demo.site, demo.parameters)
  const transform = ({ x, z }: { x: number; z: number }) => ({ x: 13 - z, z: x - 7 })
  const scene: Site = { ...demo.site, blocks: demo.site.blocks.map(block => {
    const a = transform(block), b = transform({ x: block.x + block.width, z: block.z + block.depth })
    return { ...block, x: Math.min(a.x, b.x), z: Math.min(a.z, b.z), width: block.depth, depth: block.width, outline: block.outline?.map(transform) }
  }), sections: demo.site.sections.map(section => ({ ...section, start: transform(section.start), end: transform(section.end) })) }
  const changed = calculateSite(scene, demo.parameters)
  expect(changed.canExportMaterials).toBe(true)
  expect(physicalSignature(changed, ([x, y, z]) => [z + 7, y, 13 - x])).toEqual(physicalSignature(original))
  expect(changed.materials.stockSummary).toEqual(original.materials.stockSummary)
  expect(changed.materials.connectorSummary).toEqual(original.materials.connectorSummary)
})
it('K08 exchangeable independent strokes preserve physical geometry and materials when their drawing order changes', () => {
  const scene: Site = { blocks: [], guides: [], sections: [
    { id: 'A', surfaceId: GROUND, start: { x: 0, z: 0 }, end: { x: 3.6, z: 0 }, layers: 3 },
    { id: 'B', surfaceId: GROUND, start: { x: 10, z: 10 }, end: { x: 10, z: 15.4 }, layers: 2 },
  ] }
  const first = calculateSite(scene, DEFAULT_PARAMETERS), second = calculateSite({ ...scene, sections: [...scene.sections].reverse() }, DEFAULT_PARAMETERS)
  expect(first.canExportMaterials && second.canExportMaterials).toBe(true)
  expect(physicalSignature(second)).toEqual(physicalSignature(first))
  expect(second.materials.stockSummary).toEqual(first.materials.stockSummary)
  expect(second.materials.connectorSummary).toEqual(first.materials.connectorSummary)
})

it('K03 I05 + P02/P03/P05: a three-lift front keeps the five-lift side and its roof connections protected', () => {
  const demo = SITE_DEMOS.find(d => d.id === 'corridor')!
  const scene = { ...demo.site, sections: demo.site.sections.map((section, index) => index === 0 ? { ...section, layers: 3, followGlobal: false } : section) }
  const result = calculateSite(scene, demo.parameters)
  expect(result.issues).toEqual([])
  expect(result.sections.map(section => section.top)).toEqual([5.64, 9.4, 9.4, 9.4])
  expect(result.joinedLifts!.map(join => join.levels)).toEqual([[3.76, 5.64, 7.52, 9.4], [3.76, 5.64, 7.52, 9.4]])
  // The left side must still close across its two rows above the lower front.
  // 4H + H/2, 5H + H/2 and the existing top course are independent fixed values.
  for (const elevation of [8.46, 10.34, 11.58]) {
    expect(result.members.some(member => member.type === 'guardrail' && member.start[1] === elevation
      && member.connectionPoints.some(p => mm(p[0]) === -300 && mm(p[2]) === -300)
      && member.connectionPoints.some(p => mm(p[0]) === -1050 && mm(p[2]) === -300))).toBe(true)
  }
})
it('K06 S02 + S03 + C02: repaired upright stock excludes 5m and its real sleeves remain staggered and exactly counted', () => {
  const scene: Site = { blocks: [], guides: [], sections: [{ id: 'A', surfaceId: GROUND, layers: 5, start: { x: 0, z: 0 }, end: { x: 3.6, z: 0 } }] }
  const layout = calculateSite(scene, DEFAULT_PARAMETERS)
  const posts = layout.members.filter(member => member.type === 'post')
  expect(posts).toHaveLength(6)
  expect(layout.pipeSegments.filter(pipe => pipe.type === 'post').every(pipe => pipe.stockLength !== 5)).toBe(true)
  const joints = (id: string) => layout.connectors.filter(fitting => fitting.type === 'butt' && fitting.memberId === id).map(fitting => fitting.position[1])
  for (const row of [0, 0.75]) {
    const members = posts.filter(post => post.start[2] === row).sort((a, b) => a.start[0] - b.start[0])
    expect(members).toHaveLength(3)
    for (let i = 1; i < members.length; i++) for (const a of joints(members[i - 1].id)) for (const b of joints(members[i].id)) expect(Math.abs(a - b)).toBeGreaterThanOrEqual(0.499)
  }
  let seamCount = 0
  for (const member of layout.members) {
    const pipes = layout.pipeSegments.filter(pipe => pipe.memberId === member.id).sort((a, b) => a.sequence - b.sequence)
    const sleeves = layout.connectors.filter(fitting => fitting.type === 'butt' && fitting.memberId === member.id)
    expect(sleeves.map(fitting => fitting.position)).toEqual(pipes.slice(1).map(pipe => pipe.start))
    seamCount += pipes.length - 1
  }
  expect(layout.materials.connectorSummary.butt).toBe(seamCount)
})
