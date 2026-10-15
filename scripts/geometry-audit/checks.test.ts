import { describe, expect, it } from 'vitest'
import { calculateScaffold, DEFAULT_PARAMETERS } from '../../src/domain/scaffold.ts'
import { inspect, rectangleUnionArea } from './checks.ts'
import { generatedShapes, planInput, SHAPES } from './fixtures.ts'

describe('orthogonal audit checks', () => {
  it('measures coverage once for overlapping and contained rectangles', () => {
    expect(rectangleUnionArea([[0, 0, 2, 2], [1, 1, 3, 3]])).toBe(7)
    expect(rectangleUnionArea([[0, 0, 3, 3], [1, 1, 2, 2]])).toBe(9)
    expect(rectangleUnionArea([[0, 0, 2, 2], [0, 0, 2, 2]])).toBe(4)
  })

  it('handles disjoint, touching and empty coverage', () => {
    expect(rectangleUnionArea([[0, 0, 1, 2], [3, 0, 4, 2]])).toBe(4)
    expect(rectangleUnionArea([[0, 0, 1, 2], [1, 0, 2, 2]])).toBe(4)
    expect(rectangleUnionArea([])).toBe(0)
  })

  it('does not flag the panel lap allowance as duplicate geometric coverage', () => {
    const shape = SHAPES.find((s) => s.id === 'line')!
    const { points, lengths } = planInput(shape)
    const layout = calculateScaffold(points, lengths, DEFAULT_PARAMETERS)
    expect(inspect(shape, layout, DEFAULT_PARAMETERS)).toEqual([])
  })

  it('detects injected duplicate stock and overlapping coverage', () => {
    const shape = SHAPES.find((s) => s.id === 'line')!
    const { points, lengths } = planInput(shape)
    const layout = calculateScaffold(points, lengths, DEFAULT_PARAMETERS)
    layout.pipeSegments.push({ ...layout.pipeSegments[0], id: 'injected-pipe' })
    layout.decks.push({ ...layout.decks[0], id: 'injected-deck' })
    const findings = inspect(shape, layout, DEFAULT_PARAMETERS)
    expect(findings.find((f) => f.code === 'duplicate-pipes')?.count).toBe(1)
    expect(findings.find((f) => f.code === 'deck-overlap')?.examples).toEqual([
      expect.objectContaining({ layer: 1, overlapArea: layout.decks[0].area }),
    ])
    expect(findings.find((f) => f.code === 'summary-mismatch')?.examples).toContain('stock count')
  })

  it('keeps every hand-drawn and seeded edge nonzero and axis aligned', () => {
    for (const shape of [...SHAPES, ...generatedShapes()]) {
      for (let i = 1; i < shape.points.length; i++) {
        const [x, y] = shape.points[i], [px, py] = shape.points[i - 1]
        expect((x === px) !== (y === py), `${shape.id} edge ${i}`).toBe(true)
      }
    }
    expect(generatedShapes()).toEqual(generatedShapes())
    const odd = SHAPES.find((s) => s.id === 'odd-bays')!
    expect(planInput(odd).lengths.reduce((sum, length) => sum + Math.ceil(length / DEFAULT_PARAMETERS.postSpacing), 0) % 2).toBe(1)
  })
})
