import { it, expect } from 'vitest'
import { mm, roundSite, roundDomain, roundFixedMillimetre, roundPlan, PIXELS_PER_METER } from './precision'
import { signedArea } from '../../polygons'
it('keeps scene millimetres, legacy pixels and coverage precision as separate contracts', () => {
  expect(PIXELS_PER_METER).toBe(50)
  expect(mm(3.759)).toBe(3759)
  expect(mm(3.760)).toBe(3760)
  expect(mm(3.761)).toBe(3761)
  expect(roundPlan(1.23456)).toBe(1.23)
  expect(roundDomain(1.234567, 6)).toBe(1.234567)
  expect(roundFixedMillimetre(1.234567)).toBe(1.235)
  expect(Object.is(roundSite(-0.0005), -0)).toBe(true)
  expect(roundFixedMillimetre(-0.0005)).toBe(-0.001)
  expect(signedArea([[0, 0], [1.000001, 0], [1.000001, 0.000001], [0, 0.000001]])).toBeCloseTo(0.000001000001, 14)
})
