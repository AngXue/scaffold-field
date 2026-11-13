import { expect, it } from 'vitest'
import { compareApprovedDirection } from './approved-direction.mjs'
const fixture = { id: 'fixed', input: 'same-input' }
const approval = { cases: [{ id: 'fixed', inputSha256: 'same-input', reversedMembers: ['A'] }] }
function values() {
  const old = { members: [{ id: 'A', type: 'longitudinal' }], pipeSegments: [
    { id: 'p1', memberId: 'A', type: 'longitudinal', stockLength: 5, sequence: 1, overlapWithPrevious: 0, start: [-0.15, 2, 0], end: [4.85, 2, 0] },
    { id: 'p2', memberId: 'A', type: 'longitudinal', stockLength: 3.5, sequence: 2, overlapWithPrevious: 0, start: [4.85, 2, 0], end: [8.35, 2, 0] },
  ], connectors: [{ id: 'c1', memberId: 'A', type: 'butt', position: [4.85, 2, 0] }, { id: 'c2', memberId: 'A', type: 'cross', position: [1, 2, 0] }],
  materials: { stockSummary: { '5m': 1, '3.5m': 1 }, connectorSummary: { butt: 1, cross: 1, swivel: null },
    assemblyPlans: [{ memberId: 'A', stockLengths: [5, 3.5] }] }, issues: [] }
  const corrected = structuredClone(old)
  corrected.pipeSegments[0].stockLength = 3.5; corrected.pipeSegments[0].end[0] = 3.35
  corrected.pipeSegments[1].stockLength = 5; corrected.pipeSegments[1].start[0] = 3.35
  corrected.connectors[0].position[0] = 3.35
  corrected.materials.assemblyPlans[0].stockLengths = [3.5, 5]
  return { old, corrected }
}
it('accepts only a fixed source-direction reversal derived independently from the old physical tubes', () => {
  const { old, corrected } = values(), before = JSON.stringify({ old, corrected })
  expect(compareApprovedDirection(old, corrected, fixture, approval)).toEqual(['A'])
  expect(JSON.stringify({ old, corrected })).toBe(before)
  expect(() => compareApprovedDirection(old, old, fixture, approval)).toThrow()
})
it.each(['stock-count', 'cross-contact', 'seam', 'endpoint', 'warning', 'unknown', 'missing-pipe'])('does not hide an unrelated %s change behind an approved exception', kind => {
  const { old, corrected } = values()
  if (kind === 'stock-count') corrected.materials.stockSummary['5m']++
  if (kind === 'cross-contact') corrected.connectors[1].position[0] += 0.2
  if (kind === 'seam') corrected.connectors[0].position[0] += 0.002
  if (kind === 'endpoint') corrected.pipeSegments[0].start[2] += 0.002
  if (kind === 'warning') corrected.issues.push({ code: 'new' })
  if (kind === 'unknown') corrected.materials.connectorSummary.swivel = 0
  if (kind === 'missing-pipe') corrected.pipeSegments.pop()
  expect(() => compareApprovedDirection(old, corrected, fixture, approval)).toThrow()
})
it('binds approval to the precise input, member and real change instead of exempting all geometries', () => {
  const { old, corrected } = values()
  expect(() => compareApprovedDirection(old, corrected, { ...fixture, input: 'changed' }, approval)).toThrow('input differs')
  expect(() => compareApprovedDirection(old, corrected, { ...fixture, id: 'unknown' }, approval)).toThrow()
  for (const reversedMembers of [['missing'], ['A', 'A']]) expect(() => compareApprovedDirection(old, corrected, fixture,
    { cases: [{ ...approval.cases[0], reversedMembers }] })).toThrow()
})
