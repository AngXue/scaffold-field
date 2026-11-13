import { it, expect } from 'vitest'
import { DEFAULT_PARAMETERS, type ScaffoldMember, type Vector3Tuple } from '../scaffold'
import { MEMBER_USES, makeUse, transformUses } from './facts/memberUses'
import { mergeMemberStage } from './sharedMembers'
import { assembleHorizontalRuns } from './policies/stock'

it('S01 revision 2 keeps a hand-checked 5m + 3.5m run tied to source direction under all quarter turns and merge visitation orders', () => {
  // Source A runs from x=8.2 toward x=0. A 5m + 3.5m assembly has 0.15m
  // surplus at each end: along that direction its seam is x=3.35, never 4.85.
  const member = (id: string, start: number, end: number, segment: number): ScaffoldMember => ({ id, type: 'longitudinal',
    start: [start, 1.88, 0], end: [end, 1.88, 0], length: Math.abs(end - start), layer: 1, connectionPoints: [[start, 1.88, 0], [end, 1.88, 0]],
    [MEMBER_USES]: [makeUse(segment, 'longitudinal', [start, 1.88, 0], [end, 1.88, 0], 'M03')] })
  const source = [member('A', 8.2, 4.1, 0), member('B', 4.1, 0, 1)]
  const rotate = ([x, y, z]: Vector3Tuple, turns: number): Vector3Tuple => turns ? rotate([-z, y, x], turns - 1) : [x, y, z]
  const signature = (turns: number, reverse: boolean) => {
    const move = (p: Vector3Tuple): Vector3Tuple => { const [x, y, z] = rotate(p, turns); return [x + 17, y, z - 9] }
    const changed = source.map(m => ({ ...m, start: move(m.start), end: move(m.end), connectionPoints: m.connectionPoints.map(move),
      [MEMBER_USES]: transformUses(m, move, use => ({ pathSegment: use.pathSegment })) }))
    const merged = mergeMemberStage(reverse ? changed.reverse() : changed)
    expect(merged).toHaveLength(1)
    const assembly = assembleHorizontalRuns(merged, { ...DEFAULT_PARAMETERS, stockLengths: [5, 3.5] }, {})[0]
    return assembly.segments.map(pipe => [pipe.stockLength, [pipe.start, pipe.end].map(([x, y, z]) => rotate([x - 17, y, z + 9], (4 - turns) % 4)
      .map(value => Math.round(value * 1000) || 0)).map(point => JSON.stringify(point)).sort()]).map(value => JSON.stringify(value)).sort()
  }
  const expected = [[3.5, ['[-150,1880,0]', '[3350,1880,0]']], [5, ['[3350,1880,0]', '[8350,1880,0]']]].map(value => JSON.stringify(value)).sort()
  for (const turns of [0, 1, 2, 3]) for (const reverse of [false, true]) expect(signature(turns, reverse)).toEqual(expected)
})
