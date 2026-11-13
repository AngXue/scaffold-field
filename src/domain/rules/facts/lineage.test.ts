import { expect, it } from 'vitest'
import { validateLineage } from './lineage'
import { clipUses, makeUse, MEMBER_USES, transformUses } from './memberUses'

it('rejects dangling, cyclic and contradictory replacement ancestry', () => {
  const source = { id: 'source', kind: 'source', derivedFrom: [], replacedBy: [] }
  expect(() => validateLineage([source, source])).toThrow('Duplicate')
  expect(() => validateLineage([{ ...source, derivedFrom: ['missing'] }])).toThrow('Dangling')
  expect(() => validateLineage([{ ...source, derivedFrom: ['source'] }])).toThrow('Cyclic')
  expect(() => validateLineage([{ ...source, replacedBy: ['missing'] }])).toThrow('Inconsistent')
  expect(() => validateLineage([{ ...source, replacedBy: ['child'] }, { ...source, id: 'child' }])).toThrow('Inconsistent')
  expect(() => validateLineage([{ ...source, replacedBy: ['child'] }, { ...source, id: 'child', derivedFrom: ['source'] }])).not.toThrow()
})
it('keeps both ends of every interval replacement in the same transformed coordinate frame', () => {
  const use = makeUse(0, 'end-guard', [0, 2, 0], [4, 2, 0], 'P02')
  const original = JSON.stringify(use)
  const clipped = clipUses({ [MEMBER_USES]: [use] }, [1, 2, 0], [3, 2, 0], 'P06')
  expect(clipped[0].changes).toEqual([{ rule: 'P06', before: [[0, 2, 0], [4, 2, 0]], after: [[1, 2, 0], [3, 2, 0]] }])
  const transformed = transformUses({ [MEMBER_USES]: clipped }, point => [-point[2] + 8, point[1] + 3.5, point[0] - 2],
    () => ({ pathSegment: 3, sectionId: 'S4', spanId: 'S4/roof' }))
  expect(transformed[0].changes).toEqual([{ rule: 'P06', before: [[8, 5.5, -2], [8, 5.5, 2]], after: [[8, 5.5, -1], [8, 5.5, 1]] }])
  expect(transformed[0].start).toEqual([8, 5.5, -1])
  expect(transformed[0].sectionId).toBe('S4')
  expect(JSON.stringify(use)).toBe(original)
  transformed[0].changes![0].before[0][0] = 100
  expect(clipped[0].changes![0].before[0][0]).toBe(0)
})
