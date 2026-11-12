import { it, expect } from 'vitest'
import { resolveTopology } from './topology'
import { DEFAULT_PARAMETERS } from '../scaffold'
import { SHAPES } from '../../../scripts/geometry-audit/fixtures'
import type { PlanPoint } from './policies/topology'
it.each(['l-inside', 'l-outside', 'user-short-returns'])('%s: station and corner products remain immutable and keep the maximum bay', id => {
  const shape = SHAPES.find(shape => shape.id === id)!, physical = structuredClone(shape.points) as PlanPoint[]
  const before = JSON.stringify(physical), closed = id === 'user-short-returns'
  const result = resolveTopology(physical, DEFAULT_PARAMETERS, closed, 3, [])
  expect(JSON.stringify(physical)).toBe(before)
  expect(Object.isFrozen(physical)).toBe(false)
  expect(Object.isFrozen(result.corners.cornerStations)).toBe(true)
  for (const segment of result.stations) {
    expect(segment.stations[0]).toBe(0)
    expect(segment.stations.at(-1)).toBeCloseTo(segment.segmentLength, 8)
    for (let i = 1; i < segment.stations.length; i++) expect(segment.stations[i] - segment.stations[i - 1]).toBeLessThanOrEqual(DEFAULT_PARAMETERS.postSpacing + 0.001)
  }
})
it('protects required transition pairs against the inside-corner omission', () => {
  const physical: PlanPoint[] = [[0, 0], [3.6, 0], [3.6, 3.6]]
  const normal = resolveTopology(physical, DEFAULT_PARAMETERS, false, 3, [])
  const required = resolveTopology(physical, DEFAULT_PARAMETERS, false, 3, [[false, true], [true, false]])
  expect(normal.retained[0].at(-1)).toBe(false)
  expect(normal.retained[1][0]).toBe(false)
  expect(required.retained[0].at(-1)).toBe(true)
  expect(required.retained[1][0]).toBe(true)
  expect(required.stations).toEqual(normal.stations)
})
