import assert from 'node:assert/strict'

/** Independent oracle for the user-approved S01 revision 2 exception.
 * This uses only frozen OLD physical stock, not the new source-direction helper.
 * Only explicitly listed horizontal assemblies may reverse their stock order.
 * Everything else, including full material totals and warnings, stays exact.
 */
export function compareApprovedDirection(baseline, candidate, fixture, approval) {
  const scope = approval.cases.find(item => item.id === fixture.id)
  if (!scope) { assert.deepEqual(candidate, baseline); return [] }
  assert.equal(scope.inputSha256, fixture.input, 'Approved direction input differs')
  assert.equal(new Set(scope.reversedMembers).size, scope.reversedMembers.length, 'Duplicate direction exception')
  const expected = structuredClone(baseline), actual = structuredClone(candidate)
  const mm = value => Math.round(value * 1000) || 0
  const roundPoint = point => point.map(mm)
  const affected = new Set(scope.reversedMembers)
  for (const id of affected) {
    const member = baseline.members.find(member => member.id === id)
    assert(member && member.type !== 'post', 'Direction exception must refer to an existing horizontal member')
    const source = baseline.pipeSegments.filter(pipe => pipe.memberId === id).sort((a, b) => a.sequence - b.sequence)
    assert(source.length > 1, 'Direction exception needs multiple stock pieces')
    const lengths = source.map(pipe => pipe.stockLength), reversed = [...lengths].reverse()
    assert.notDeepEqual(lengths, reversed, 'Direction exception must describe an actual change')
    const magnitude = Math.hypot(...source[0].end.map((value, axis) => value - source[0].start[axis]))
    const axis = source[0].end.map((value, index) => (value - source[0].start[index]) / magnitude)
    let cursor = [...source[0].start]
    const starts = []
    source.forEach((pipe, index) => {
      const expectedPipe = expected.pipeSegments.find(item => item.id === pipe.id)
      const actualPipe = actual.pipeSegments.find(item => item.id === pipe.id)
      assert(expectedPipe && actualPipe, 'Missing approved stock entity')
      const end = cursor.map((value, i) => value + axis[i] * reversed[index])
      starts.push(roundPoint(cursor))
      Object.assign(expectedPipe, { stockLength: reversed[index], start: roundPoint(cursor), end: roundPoint(end) })
      actualPipe.start = roundPoint(actualPipe.start); actualPipe.end = roundPoint(actualPipe.end)
      const nextOverlap = source[index + 1]?.overlapWithPrevious ?? 0
      cursor = end.map((value, i) => value - axis[i] * nextOverlap)
    })
    const sleeves = expected.connectors.filter(fitting => fitting.memberId === id && fitting.type === 'butt')
    assert.equal(sleeves.length, source.length - 1, 'Frozen stock and sleeve count disagree')
    sleeves.forEach((fitting, index) => { fitting.position = starts[index + 1] })
    for (const fitting of actual.connectors) if (fitting.memberId === id && fitting.type === 'butt') fitting.position = roundPoint(fitting.position)
    const plan = expected.materials.assemblyPlans.find(plan => plan.memberId === id)
    assert.deepEqual(plan.stockLengths, lengths)
    plan.stockLengths = reversed
  }
  assert.deepEqual(actual, expected)
  return [...affected]
}
