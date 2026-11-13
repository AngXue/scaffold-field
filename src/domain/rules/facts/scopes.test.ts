import { expect, it } from 'vitest'
import type { SiteSection } from '../../site'
import type { ScaffoldMember } from '../../scaffold'
import { FRAME_SCOPES, frameScope, requiredScopes } from './scopes'
import { SemanticIdentities } from './identity'
import { mergeSharedRuns } from '../policies/sharedMembers'
import { sharedComponentPosts } from '../policies/components'

it('uses source geometry and footing conditions instead of traversal or editing groups for frame identity', () => {
  const sections: SiteSection[] = [{ id: 'A', start: { x: 0, z: 0 }, end: { x: 2, z: 0 }, surfaceId: 'ground', layers: 3 },
    { id: 'B', start: { x: 2, z: 0 }, end: { x: 2, z: 2 }, surfaceId: 'ground', layers: 3 }]
  const ids = new SemanticIdentities(), original = frameScope(ids, sections)
  expect(frameScope(ids, [...sections].reverse())).toBe(original)
  expect(frameScope(ids, sections.map(section => ({ ...section, groupId: 'edited-group' })))).toBe(original)
  expect(frameScope(ids, sections.map(section => ({ ...section, layers: 4 })))).not.toBe(original)
  expect(frameScope(ids, sections.map(section => ({ ...section, surfaceId: 'roof' })))).not.toBe(original)
})
it('preserves every physical scope through shared runs and shared posts without changing input ownership', () => {
  const first: ScaffoldMember = { id: 'A', [FRAME_SCOPES]: Object.freeze(['frame-a']), type: 'guardrail',
    start: [0, 2, 0], end: [1, 2, 0], length: 1, connectionPoints: [[0, 2, 0], [1, 2, 0]], layer: 1 }
  const second: ScaffoldMember = { ...first, id: 'B', [FRAME_SCOPES]: Object.freeze(['frame-b']), start: [1, 2, 0], end: [2, 2, 0] }
  const merged = mergeSharedRuns([first, second])
  expect(merged).toHaveLength(1)
  expect(requiredScopes(merged[0])).toEqual(['frame-a', 'frame-b'])
  const posts = [first, second].map(member => ({ ...member, type: 'post' as const, start: [0, 0, 0] as [number, number, number], end: [0, 2, 0] as [number, number, number], length: 2 }))
  expect(requiredScopes(sharedComponentPosts(posts, { A: [2], B: [2] }).members[0])).toEqual(['frame-a', 'frame-b'])
  expect(first[FRAME_SCOPES]).toEqual(['frame-a'])
  expect(second[FRAME_SCOPES]).toEqual(['frame-b'])
})
