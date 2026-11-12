import { expect, it } from 'vitest'
import { DEFAULT_PARAMETERS } from '../scaffold'
import { resolveTopology } from './topology'
import { resolveFrameRows, FRAME_ROW_STEPS } from './frameRows'
import { outwardRanges } from './policies/protectionRanges'
import type { PlanPoint } from './policies/topology'

const build = (points: PlanPoint[], counts: number[], supportCount = 3) => {
  const parameters = { ...DEFAULT_PARAMETERS, swapInnerOuter: true, deckSupportRailCount: supportCount }
  const topology = resolveTopology(points, parameters, false, supportCount, [])
  return resolveFrameRows(points, topology.stations, topology.corners, counts, false, parameters)
}
it('more deck support rails do not create additional post rows or change post coordinates', () => {
  const points: PlanPoint[] = [[0, 0], [3.6, 0], [3.6, 3.6]]
  const three = build(points, [5, 5]), five = build(points, [5, 5], 5)
  expect(three.rows.map(rows => rows.postRows)).toEqual(five.rows.map(rows => rows.postRows))
  expect(five.rows.every(rows => rows.postRows.length === 2 && rows.supportRows.length === 5)).toBe(true)
  expect(Object.isFrozen(five.rows[0].postRows[0][0])).toBe(true)
})
it('inward common lifts stop at the shared post; taller unmatched lifts retain the full guard and open return', () => {
  const frame = build([[0, 0], [3.6, 0], [3.6, 3.6]], [5, 3])
  expect(frame.guards[0].map(range => range.clipEnd)).toEqual([true, true, true, false, false])
  expect(frame.guards[0][0].points.at(-1)).toEqual([2.85, 0, 0.75])
  expect(frame.guards[0][4].points.at(-1)).toEqual([3.6, 0, 0.75])
  expect(frame.guards[0][0].endStations).toEqual([0])
  expect(frame.guards[0][4].endStations).toEqual([0, 2])
  // Working rows are never shortened by the guard-only refinement.
  expect(frame.rows[0].memberRows.at(-1)!.at(-1)).toEqual([3.6, 0, 0.75])
})
it('outward crossings keep the extended guard corner and do not invent open ends on common lifts', () => {
  const frame = build([[0, 0], [3.6, 0], [3.6, -3.6]], [3, 3])
  expect(frame.guards.flat().every(range => !range.clipStart && !range.clipEnd)).toBe(true)
  expect(frame.guards[0][0].points.at(-1)).toEqual([4.35, 0, 0.75])
  expect(frame.guards[1][0].points[0]).toEqual([4.35, 0, 0.75])
  expect(frame.guards[0][0].endStations).toEqual([0])
  expect(frame.guards[1][0].endStations).toEqual([2])
})

it('the inward refinement contract rejects arbitrary geometry, unmatched-lift clipping and changed end protection', () => {
  const parameters = { ...DEFAULT_PARAMETERS, swapInnerOuter: true }, physical: PlanPoint[] = [[0, 0], [3.6, 0], [3.6, 3.6]]
  const topology = resolveTopology(physical, parameters, false, 3, [])
  const frame = resolveFrameRows(physical, topology.stations, topology.corners, [5, 3], false, parameters)
  const previous = { kind: 'GuardRanges' as const, target: 'guards' as const, expectedRevision: 0,
    value: frame.rows.map((rows, index) => outwardRanges(rows, frame.ends[index], [5, 3][index], 1)) }
  const next = { ...previous, value: frame.guards }, facts = { physical, stations: topology.stations, corners: topology.corners,
    ends: frame.ends, outerRow: 1, width: parameters.width }
  const contract = FRAME_ROW_STEPS.find(step => step.id === 'P03.inwardRanges')!.refines![0]
  expect(contract.when(next, previous, facts)).toBe(true)
  const moved = structuredClone(next)
  moved.value[0][0].points[0][0] = 100
  expect(contract.when(moved, previous, facts)).toBe(false)
  const high = structuredClone(next)
  high.value[0][4].clipEnd = true
  expect(contract.when(high, previous, facts)).toBe(false)
  const opened = structuredClone(next)
  opened.value[0][4].endStations = []
  expect(contract.when(opened, previous, facts)).toBe(false)
})
