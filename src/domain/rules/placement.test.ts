import { expect, it } from 'vitest'
import { positionStock } from './placement'
import type { PlacementEnvironment, PlacementLayout } from './facts/placement'
import { solvePositions } from './policies/positioner'
import { walkwayObjectives } from './policies/placementConstraints'
import { MEMBER_USES, makeUse } from './facts/memberUses'

const environment = (): PlacementEnvironment => ({ transitions: [], cells: [], obstacles: [], radius: 0.024, walkway: true })
const fixture = (): PlacementLayout => ({
  members: [{ id: 'rail', pathSegment: 0, type: 'guardrail', layer: 1, start: [0, 2.82, 0], end: [3.7, 2.82, 0], length: 3.7,
    connectionPoints: [[0, 2.82, 0], [3.7, 2.82, 0]], [MEMBER_USES]: [makeUse(0, 'side-guard', [0, 2.82, 0], [3.7, 2.82, 0], 'P02')] }],
  pipeSegments: [
    { id: 'p1', memberId: 'rail', type: 'guardrail', start: [-0.15, 2.82, 0], end: [1.85, 2.82, 0], stockLength: 2, sequence: 1, overlapWithPrevious: 0 },
    { id: 'p2', memberId: 'rail', type: 'guardrail', start: [1.85, 2.82, 0], end: [3.85, 2.82, 0], stockLength: 2, sequence: 2, overlapWithPrevious: 0 },
  ], connectors: [{ id: 'sleeve', memberId: 'rail', type: 'butt', position: [1.85, 2.82, 0], axis: [1, 0, 0] },
    { id: 'fixed', memberId: 'rail', connectedMemberId: 'post', type: 'cross', position: [0, 2.82, 0], axis: [1, 0, 0] }],
  decks: [{ id: 'right', layer: 1, pathSegment: 0, area: 2.6, corners: [[3.7, 1.935, -1], [5, 1.935, -1], [5, 1.935, 1], [3.7, 1.935, 1]] }],
})
it('the walkway objective cannot undo the transition clearance; surplus remains when the hard constraint needs it', () => {
  const layout = fixture(), env = environment()
  env.transitions = [[0, [{ axis: 0, boundary: -0.05, roof: 3.5, station: 0, towardRoof: -1, wall: true }]]]
  const decisions = positionStock(layout, env)
  expect(layout.pipeSegments[0].start[0]).toBeCloseTo(-0.024, 8)
  expect(layout.pipeSegments[1].end[0]).toBeCloseTo(3.976, 8)
  expect(layout.connectors[0].position[0]).toBeCloseTo(1.976, 8)
  expect(layout.connectors[1].position).toEqual([0, 2.82, 0])
  expect(decisions[0].feasible).toBe(true)
  expect(decisions[0].moves.map(move => move.reason)).toEqual(['transition'])
  expect(decisions[0].intrusion!.after).toBeCloseTo(0.276, 8)
})
it('no common legal position is explicit, keeps whole stock and never fabricates a new short specification', () => {
  const layout = fixture(), env = environment(), before = JSON.stringify(layout)
  env.transitions = [[0, [
    { axis: 0, boundary: -0.05, roof: 3.5, station: 0, towardRoof: -1, wall: true },
    { axis: 0, boundary: 3.75, roof: 3.5, station: 3.7, towardRoof: 1, wall: true },
  ]]]
  const decisions = positionStock(layout, env)
  expect(decisions[0].feasible).toBe(false)
  expect(decisions[0].moves).toEqual([])
  expect(JSON.stringify(layout)).toBe(before)
})
it('does not treat the guard search margin as a new mandatory axial wall clearance', () => {
  const layout = fixture(), env = environment()
  // The flat pipe end is already outside the wall by 2 mm. P08's additional
  // radius in its search envelope must not silently move an existing legal pose.
  layout.pipeSegments[0].start[0] = -0.198
  layout.pipeSegments[0].end[0] = 1.802
  layout.pipeSegments[1].start[0] = 1.802
  layout.pipeSegments[1].end[0] = 3.802
  layout.connectors[0].position[0] = 1.802
  env.cells = [{ x: -2, z: -1, width: 1.8, depth: 2, base: 0, top: 5 }]
  env.obstacles = [{ base: 0, top: 5, polygon: [[-2, -1], [-0.2, -1], [-0.2, 1], [-2, 1]] }]
  const before = JSON.stringify(layout), decisions = positionStock(layout, env)
  expect(JSON.stringify(layout)).toBe(before)
  expect(decisions[0].feasible).toBe(true)
  expect(decisions[0].moves).toEqual([])
})
it('the solver leaves all input entities unchanged and translating the scene preserves its selected displacement', () => {
  const layout = fixture(), env = environment(), before = JSON.stringify(layout)
  const objectives = walkwayObjectives(layout.members, layout.decks!)
  const result = solvePositions(layout.members, layout.pipeSegments, layout.connectors, env, objectives)
  expect(JSON.stringify(layout)).toBe(before)
  expect(result.decisions[0].moves[0].delta[0]).toBeCloseTo(-0.15, 8)
  expect(result.pipes.map(pipe => pipe.stockLength)).toEqual([2, 2])
  const shifted = fixture()
  for (const member of shifted.members) {
    member.start = member.start.map((value, axis) => value + (axis === 0 ? 20 : 0)) as typeof member.start
    member.end = member.end.map((value, axis) => value + (axis === 0 ? 20 : 0)) as typeof member.end
    member.connectionPoints = member.connectionPoints.map(point => point.map((value, axis) => value + (axis === 0 ? 20 : 0)) as typeof point)
  }
  for (const pipe of shifted.pipeSegments) { pipe.start[0] += 20; pipe.end[0] += 20 }
  for (const connector of shifted.connectors) connector.position[0] += 20
  for (const deck of shifted.decks!) for (const point of deck.corners) point[0] += 20
  const moved = positionStock(shifted, env)
  expect(moved[0].moves[0].delta[0]).toBeCloseTo(result.decisions[0].moves[0].delta[0], 8)
})
