import { expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, SWEEP_BAR_LAYER } from '../scaffold'
import { resolveTopology } from './topology'
import { resolveFrameRows } from './frameRows'
import { resolveBands } from './bands'
import type { PlanPoint } from './policies/topology'

it('builds two sweep longitudinals, three decked longitudinals and no transverse end extension', () => {
  const parameters = { ...DEFAULT_PARAMETERS, layerCount: 2, deckLiftInterval: 2 }
  const points: PlanPoint[] = [[0, 0], [1.8, 0]]
  const topology = resolveTopology(points, parameters, false, 3, [])
  const frame = resolveFrameRows(points, topology.stations, topology.corners, [2], false, parameters)
  const bands = resolveBands([{ rows: frame.rows[0], bayCount: 1, joinedStart: false, joinedEnd: false, lifts: [0.26, 2.14] }], parameters, 0)[0]
  expect(bands.map(band => [band.layer, band.elevation, band.withDeck])).toEqual([[SWEEP_BAR_LAYER, 0.2, false], [1, 0.26, false], [2, 2.14, true]])
  expect(bands.map(band => band.members.filter(member => member.type === 'longitudinal').length)).toEqual([2, 2, 3])
  for (const band of bands) for (const transverse of band.members.filter(member => member.type === 'transverse')) {
    expect(transverse.startExtension).toBe(0)
    expect(transverse.endExtension).toBe(0)
    expect(Math.hypot(transverse.start[0] - transverse.end[0], transverse.start[2] - transverse.end[2])).toBe(0.75)
  }
})
it('working rows remain flush through an outside corner and skip its internal transverse tie', () => {
  const parameters = { ...DEFAULT_PARAMETERS, layerCount: 1, width: 1.1 }
  const points: PlanPoint[] = [[0, 0], [7.1, 0], [7.1, -4.3]]
  const topology = resolveTopology(points, parameters, false, 3, [])
  const frame = resolveFrameRows(points, topology.stations, topology.corners, [1, 1], false, parameters)
  const bands = resolveBands(frame.rows.map((rows, index) => ({ rows, bayCount: topology.stations[index].bayCount,
    joinedStart: index === 1, joinedEnd: index === 0, lifts: [1.88] })), parameters, 0)
  for (const [index, expected] of [8.2, 5.4].entries()) {
    const work = bands[index].find(band => band.layer === 1)!
    const lengths = work.members.filter(member => member.type === 'longitudinal').map(member =>
      Math.hypot(member.end[0] - member.start[0], member.end[2] - member.start[2]))
    expect(lengths).toHaveLength(3)
    lengths.forEach(length => expect(length).toBeCloseTo(expected, 9))
    expect(work.members.filter(member => member.type === 'transverse')).toHaveLength(topology.stations[index].bayCount)
  }
})
