import { expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, type Vector3Tuple } from '../scaffold'
import { GROUND, type ResolvedBlock } from '../site'
import { validateSectionInputs } from './sectionValidation'
import { validatePhysicalChecks, validateIndependentGroups } from './siteValidation'
import { validatePath } from './pathValidation'
import { componentWarnings, shortBayWarnings, sweepHeightWarnings } from './policies/pathValidation'
import { ISSUE_ORIGIN, mapIssueSources, sourcedIssue, type SourcedIssue } from './facts/issues'
import { stockBounds, pipeEntersBlock } from './policies/collisionGeometry'
import { resolveBlocks } from './policies/blocks'
const roof: ResolvedBlock = { id: 'B1', parentId: GROUND, x: 0, z: 0, width: 6, depth: 4, height: 3.5, base: 0, top: 3.5 }
const context = () => ({ blocks: [roof], surface: roof, obstructing: [], radius: 0.024, labels: { S1: '第 1 段' } })
it('checks the post rim and entire base even where the drawn line fits, without modifying the draft', () => {
  const checks = [
    { kind: 'line' as const, sectionId: 'S1', a: { x: 0.01, z: 1 }, b: { x: 1, z: 1 } },
    { kind: 'post' as const, sectionId: 'S1', point: [0.01, 3.5, 1] as Vector3Tuple },
    { kind: 'base' as const, sectionId: 'S1', footprint: [[-0.1, 1], [1, 1], [1, 1.1], [-0.1, 1.1]] as [number, number][] },
  ]
  const before = JSON.stringify(checks), issues = validatePhysicalChecks(checks, context())
  expect(issues.map(issue => issue.message)).toEqual([
    '第 1 段的立杆柱脚超出或跨越所选落脚面，请调整位置或分段。',
    '第 1 段的底座超出或跨越所选落脚面，请调整位置或分段。',
  ])
  expect(issues.every(issue => issue.blocking)).toBe(true)
  expect((issues[0] as SourcedIssue)[ISSUE_ORIGIN]).toEqual({ rules: ['V01'], references: [{ kind: 'section', id: 'S1' }] })
  expect(JSON.stringify(checks)).toBe(before)
})
it('preserves flat-end contact and the difference between roof bearing and actual wall penetration', () => {
  expect(pipeEntersBlock([1, 3.5, 1], [1, 6, 1], roof, 0.024)).toBe(false)
  expect(pipeEntersBlock([-2, 2, 1], [-0.002, 2, 1], roof, 0.024)).toBe(false)
  expect(pipeEntersBlock([-2, 2, 1], [0.1, 2, 1], roof, 0.024)).toBe(true)
  const checks = [{ kind: 'pipe' as const, sectionId: 'S1', start: [-2, 2, 1] as Vector3Tuple, end: [0.1, 2, 1] as Vector3Tuple }]
  expect(validatePhysicalChecks(checks, context())).toMatchObject([{ code: 'house-penetration', blocking: true }])
})
it('allows end-to-end stock contact but reports independent physical overlap with original source order', () => {
  const group = (id: string, a: Vector3Tuple, b: Vector3Tuple) => {
    const bounds = stockBounds(a, b, 0.024)
    return { bounds, elements: [{ bounds, sectionId: id }] }
  }
  const left = group('A', [0, 1, 0], [2, 1, 0])
  expect(validateIndependentGroups([left, group('B', [2, 1, 0], [4, 1, 0])], ['B', 'A'], {})).toEqual([])
  expect(validateIndependentGroups([left, group('B', [1, 1, 0], [4, 1, 0])], ['B', 'A'], { A: '第 2 段', B: '第 1 段' }))
    .toMatchObject([{ code: 'independent-overlap', sectionIds: ['B', 'A'], blocking: true }])
})
it('keeps section issue ordering, millimetre sweep clearance and independently sourced block failures', () => {
  const section = { id: 'S1', surfaceId: 'B1', start: { x: 1, z: 1 }, end: { x: 1.05, z: 1 }, layers: 1 }
  const result = validateSectionInputs([section, { ...section, id: 'S2', surfaceId: 'missing' }], [roof], { ...DEFAULT_PARAMETERS, sweepBarHeight: 0.22 }, 0.1)
  expect(result.issues.map(issue => issue.code)).toEqual(['short-section', 'sweep-conflict', 'missing-surface'])
  expect(validateSectionInputs([section], [roof], { ...DEFAULT_PARAMETERS, sweepBarHeight: 0.212 }, 0.01).issues).toEqual([])
  expect(sweepHeightWarnings(0.2)).toEqual([])
  expect(sweepHeightWarnings(0.201).map(warning => warning.id)).toEqual(['sweep-bar-height'])
  const bad = resolveBlocks({ blocks: [{ ...roof, parentId: 'B1' }], guides: [], sections: [] })
  expect(bad.issues).toMatchObject([{ code: 'block-placement', blockId: 'B1', blocking: true }])
  expect((bad.issues[0] as SourcedIssue)[ISSUE_ORIGIN].rules).toEqual(['V01'])
})
it('keeps path reminders non-blocking and does not invent geometry for crossing, branches or short bays', () => {
  expect(validatePath([[0, 0], [2, 0], [0, 0]], false, 0.75).path.map(w => w.id)).toEqual(['path-overlap-0-1'])
  expect(validatePath([[0, 0], [2, 2], [0, 2], [2, 0]], false, 0.75).path.map(w => w.id)).toEqual(['path-crossing-0-2'])
  expect(shortBayWarnings(0, 0.5, 1.8).map(w => w.id)).toEqual(['short-bay-0'])
  expect(componentWarnings([1, 3, 1], true).map(w => w.id)).toEqual(['branch-junction'])
  expect(componentWarnings([1, 2, 1], true).map(w => w.id)).toEqual(['overlapping-components'])
})

it('maps errors to their source stroke without losing the support span or changing the public issue format', () => {
  const original = sourcedIssue('V01', { code: 'off-surface', sectionIds: ['S1.2'], blocking: true, message: 'test' })
  const issue = mapIssueSources(original, new Map([['S1.2', 'S1']])) as SourcedIssue
  expect(issue.sectionIds).toEqual(['S1'])
  expect(issue[ISSUE_ORIGIN].references).toEqual([{ kind: 'section', id: 'S1' }, { kind: 'span', id: 'S1.2' }])
  expect(original.sectionIds).toEqual(['S1.2'])
  expect(JSON.parse(JSON.stringify(issue))).toEqual({ code: 'off-surface', sectionIds: ['S1'], blocking: true, message: 'test' })
})
