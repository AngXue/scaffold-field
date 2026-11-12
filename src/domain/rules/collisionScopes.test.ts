import { expect, it } from 'vitest'
import { independentPipeScopes } from './policies/siteValidation'
import { MEMBER_USES, makeUse } from './facts/memberUses'
import type { ScaffoldMember, PipeSegment } from '../scaffold'
import type { SiteSection } from '../site'
const sections: SiteSection[] = [
  { id: 'A', surfaceId: 'ground', start: { x: 0, z: 0 }, end: { x: 2, z: 0 }, layers: 2 },
  { id: 'B', surfaceId: 'roof', start: { x: 4, z: 0 }, end: { x: 8, z: 0 }, layers: 1 },
]
const groups = new Map([['A', 0], ['B', 1]])
const member: ScaffoldMember = { id: 'R1/M1', type: 'longitudinal', pathSegment: 0, length: 8, start: [0, 3.76, 0], end: [8, 3.76, 0], connectionPoints: [],
  [MEMBER_USES]: [makeUse(0, 'longitudinal', [0, 3.76, 0], [2, 3.76, 0], 'M03'), makeUse(1, 'longitudinal', [4, 3.76, 0], [8, 3.76, 0], 'M03'),
    makeUse(0, 'bridge-working', [2, 3.76, 0], [4, 3.76, 0], 'P05'), makeUse(1, 'bridge-working', [2, 3.76, 0], [4, 3.76, 0], 'P05')] }
const pipe = { id: 'stock', memberId: member.id, type: member.type, start: [-1, 3.76, 0], end: [9, 3.76, 0] } as PipeSegment
it('assigns final shared pipe intervals to their actual support groups and retains both surplus ends', () => {
  const expected = [
    { group: 0, sectionId: 'A', start: [-1, 3.76, 0], end: [2, 3.76, 0] },
    { group: 1, sectionId: 'B', start: [4, 3.76, 0], end: [9, 3.76, 0] },
  ]
  expect(independentPipeScopes(pipe, member, sections, groups)).toEqual(expected)
  expect(independentPipeScopes({ ...pipe, start: pipe.end, end: pipe.start }, member, sections, groups)).toEqual(expected)
  expect(independentPipeScopes({ ...pipe, start: [1, 3.76, 0], end: [5, 3.76, 0] }, member, sections, groups)).toEqual([
    { group: 0, sectionId: 'A', start: [1, 3.76, 0], end: [2, 3.76, 0] },
    { group: 1, sectionId: 'B', start: [4, 3.76, 0], end: [5, 3.76, 0] },
  ])
})
it('keeps the whole pipe in one collision scope when all origins already share a physical group', () => {
  expect(independentPipeScopes(pipe, member, sections, new Map([['A', 0], ['B', 0]]))).toEqual([
    { group: 0, sectionId: 'A', start: pipe.start, end: pipe.end },
  ])
})
