import { MEMBER_HISTORY } from './facts/memberHistory'
import { expect, it } from 'vitest'
import { DEFAULT_PARAMETERS } from '../scaffold'
import { resolveTopology } from './topology'
import { resolveFrameRows } from './frameRows'
import { resolvePosts } from './posts'
import { heightProfile } from './policies/heights'
import type { PlanPoint } from './policies/topology'

function fixture() {
  const parameters = { ...DEFAULT_PARAMETERS, swapInnerOuter: true }, counts = [2, 4]
  const points: PlanPoint[] = [[0, 0], [3.6, 0], [3.6, 3.6]]
  const topology = resolveTopology(points, parameters, false, 3, [])
  const frame = resolveFrameRows(points, topology.stations, topology.corners, counts, false, parameters)
  const input = { rows: frame.rows.map(rows => rows.postRows), heights: counts.map(count => heightProfile(count, parameters)),
    ends: frame.ends, grid: topology.grid, stations: topology.stations, mitres: topology.corners.mitrePosts, retained: topology.retained }
  return { input, parameters }
}
it('a shared post retains both height demands, takes the taller open-end height and never uses 5 m stock', () => {
  const { input, parameters } = fixture()
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

it('initial shared-post history retains each real height before reconciliation and cannot rewrite the shorter demand', () => {
  const { input, parameters } = fixture()
  const result = resolvePosts({ ...input, identityScope: 'two-faces' }, parameters)
  const corner = result.posts.find(post => post.key === '3.6:0:0')!, history = corner[MEMBER_HISTORY]!
  expect(history.operation).toBe('merge'); expect(history.rules).toEqual(['G08'])
  expect(history.start).toEqual([3.6,0,0]); expect(history.end).toEqual([3.6,10,0])
  expect(history.parents.map(parent => parent.end[1]).sort((a,b) => a-b)).toEqual([4.06,10])
  expect(history.parents.map(parent => parent.uses[0].pathSegment).sort()).toEqual([0,1])
  const short = history.parents.find(parent => parent.end[1] === 4.06)!
  expect(short.operation).toBe('demand')
  expect(() => { short.end[1] = 10 }).toThrow()
  expect(corner.pathSegment).toBe(0)
  expect(result.sequences[corner.key]).not.toContain(5)
})
it('initial post demand identities isolate source frames while remaining deterministic for the same frame', () => {
  const { input, parameters } = fixture()
  const ids = (scope: string) => resolvePosts({...input, identityScope: scope},parameters).posts.map(post => post[MEMBER_HISTORY]!.id)
  const a = ids('face-A'), b = ids('face-B')
  expect(ids('face-A')).toEqual(a)
  expect(a.every(id => !b.includes(id))).toBe(true)
})
it('mitre demand history retains the two adjacent faces before publishing their common post', () => {
  const { input, parameters } = fixture(), result = resolvePosts({...input, identityScope: 'mitre'}, parameters)
  expect(input.mitres.length).toBeGreaterThan(0)
  for (const post of result.posts.filter(post => post.cornerJunctions?.length)) {
    const node = post[MEMBER_HISTORY]!
    const roots = (history: typeof node): typeof node[] => history.parents.length ? history.parents.flatMap(roots) : [history]
    const origins = roots(node)
    expect(new Set(origins.flatMap(root => root.uses.map(use => use.pathSegment)))).toEqual(new Set([0,1]))
    expect(new Set(origins.map(root => root.end[1])).size).toBe(2)
    expect(node.end[1]).toBe(Math.max(...origins.map(root => root.end[1])))
  }
})
