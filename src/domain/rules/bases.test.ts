import { expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, type BaseChannel, type ScaffoldMember } from '../scaffold'
import { resolveSupportingBases, resolveBaseCandidates } from './bases'
import { resolveTopology } from './topology'
import { resolveFrameRows } from './frameRows'
import type { PlanPoint } from './policies/topology'
it('one base per ordinary post pair uses the transverse stock length and stays centred', () => {
  const points: PlanPoint[] = [[0, 0], [1.8, 0]], parameters = DEFAULT_PARAMETERS
  const topology = resolveTopology(points, parameters, false, 3, [])
  const frame = resolveFrameRows(points, topology.stations, topology.corners, [1], false, parameters)
  const bases = resolveBaseCandidates({ rows: frame.rows.map(rows => rows.postRows), stations: topology.stations,
    corners: topology.corners, order: [0], transverseTubeLength: 1.2 })
  expect(bases.map(base => base.length)).toEqual([1.2, 1.2])
  expect(bases.map(base => [base.start, base.end])).toEqual([
    [[0, 0, -0.225], [0, 0, 0.975]], [[1.8, 0, -0.225], [1.8, 0, 0.975]],
  ])
})
it('removes an empty beam or a strict support subset, never a sole remaining support', () => {
  const posts: ScaffoldMember[] = [0, 1].map((x, index) => ({ id: `P${index}`, type: 'post', start: [x, 0, 0], end: [x, 3, 0],
    connectionPoints: [[x, 0, 0], [x, 3, 0]], length: 3 }))
  const bases: BaseChannel[] = [
    { id: 'A', start: [0, 0, 0], end: [1, 0, 0], length: 1, pathSegment: 0 },
    { id: 'B', start: [0, 0, 0], end: [0.5, 0, 0], length: 0.5, pathSegment: 0 },
    { id: 'empty', start: [3, 0, 0], end: [4, 0, 0], length: 1, pathSegment: 0 },
  ]
  const before = structuredClone(bases)
  expect(resolveSupportingBases(bases, posts).map(base => base.id)).toEqual(['A'])
  expect(resolveSupportingBases([bases[1]], [posts[0]]).map(base => base.id)).toEqual(['B'])
  expect(bases).toEqual(before)
})
