import { expect, it } from 'vitest'
import { DEFAULT_PARAMETERS } from '../scaffold'
import { resolveTopology } from './topology'
import { resolveFrameRows } from './frameRows'
import { resolvePosts } from './posts'
import { heightProfile } from './policies/heights'
import type { PlanPoint } from './policies/topology'

it('a shared post retains both height demands, takes the taller open-end height and never uses 5 m stock', () => {
  const parameters = { ...DEFAULT_PARAMETERS, swapInnerOuter: true }, counts = [2, 4]
  const points: PlanPoint[] = [[0, 0], [3.6, 0], [3.6, 3.6]]
  const topology = resolveTopology(points, parameters, false, 3, [])
  const frame = resolveFrameRows(points, topology.stations, topology.corners, counts, false, parameters)
  const input = { rows: frame.rows.map(rows => rows.postRows), heights: counts.map(count => heightProfile(count, parameters)),
    ends: frame.ends, grid: topology.grid, stations: topology.stations, mitres: topology.corners.mitrePosts, retained: topology.retained }
  const before = JSON.stringify(input), result = resolvePosts(input, parameters)
  expect(JSON.stringify(input)).toBe(before)
  const corner = result.posts.find(post => post.key === '3.6:0:0')!
  expect(corner.top).toBe(10)
  expect(corner.pathSegment).toBe(0)
  expect(corner.uses.map(use => [use.pathSegment, use.end[1]])).toEqual([[0, 4.06], [1, 10]])
  expect(new Set(result.posts.map(post => post.key)).size).toBe(result.posts.length)
  expect(Object.values(result.sequences).flat()).not.toContain(5)
  expect(Object.isFrozen(corner.uses)).toBe(true)
})
