import { it, expect } from 'vitest'
import { componentGroups } from './groups'
import type { SiteSection } from '../site'
const section = (id: string, x: number, layers: number, automatic = false): SiteSection => ({ id, surfaceId: 'ground', start: { x, z: 0 }, end: { x: x + 2, z: 0 }, layers, automatic })
it('uses support and real adjacency, never editing group membership', () => {
  const sections = [{ ...section('S1', 0, 5), groupId: 'a' }, { ...section('S2', 2, 5), groupId: 'b' }, { ...section('S3', 8, 5), groupId: 'a' }]
  expect(componentGroups(sections).map(group => group.map(section => section.id))).toEqual([['S1', 'S2'], ['S3']])
  expect(componentGroups([section('S1', 0, 5), section('S2', 2, 4)])).toHaveLength(2)
  expect(componentGroups([section('S1', 0, 5, true), section('S2', 2, 4, true)])).toHaveLength(1)
})
it('keeps differing support faces separate and rejects duplicate authored identities', () => {
  expect(componentGroups([section('S1', 0, 5, true), { ...section('S2', 2, 5, true), surfaceId: 'roof' }])).toHaveLength(2)
  expect(() => componentGroups([section('same', 0, 5), section('same', 2, 5)])).toThrow('duplicate')
})
