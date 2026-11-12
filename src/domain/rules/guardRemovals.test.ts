import { expect, it } from 'vitest'
import type { ScaffoldMember } from '../scaffold'
import type { ResolvedBlock } from '../site'
import { resolveGuardRemovals } from './guardRemovals'

const wall: ResolvedBlock = { id: 'B1', parentId: 'ground', x: 0, z: 0, width: 4, depth: 2, height: 3.5, base: 0, top: 3.5 }
const guard = (id: string, y: number, layer = 1): ScaffoldMember => ({ id, type: 'guardrail', pathSegment: 0, layer,
  start: [1, y, -0.3], end: [2, y, -0.3], connectionPoints: [[1, y, -0.3], [2, y, -0.3]], length: 1 })
it('omits only guards against a real wall at their height, preserving the roof boundary and higher guards', () => {
  const members = [guard('low', 3.49), guard('roof', 3.5), guard('higher', 4.7), { ...guard('working', 3.49), type: 'longitudinal' as const }]
  const before = structuredClone(members)
  expect(resolveGuardRemovals({ members, blocks: [wall], ends: [], followsWall: true, clearance: 0.75, stations: [] })).toEqual(['low'])
  expect(resolveGuardRemovals({ members, blocks: [wall], ends: [], followsWall: false, clearance: 0.75, stations: [] })).toEqual([])
  expect(members).toEqual(before)
})
it('opens a shared-footing cap only on common layers and never removes an ordinary working member', () => {
  const cap: ScaffoldMember = { id: 'cap', type: 'guardrail', layer: 2, pathSegment: 0, start: [1, 2.82, 0], end: [1, 2.82, 0.75],
    connectionPoints: [[1, 2.82, 0], [1, 2.82, 0.75]], length: 0.75 }
  const members = [cap, { ...cap, id: 'high', layer: 3 }, { ...cap, id: 'working', type: 'transverse' as const }]
  expect(resolveGuardRemovals({ members, blocks: [], ends: [], followsWall: true, clearance: 0.75,
    stations: [{ points: [{ x: 1, z: 0 }, { x: 1, z: 0.75 }], layers: 2 }] })).toEqual(['cap'])
})
