import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS } from '../scaffold'
import { resolveHeightStages } from './heights'
import { postHeightAt } from './policies/heights'
import { railsWithin } from './policies/guardCourses'

describe('height demands and supported guard courses', () => {
  it('keeps global roof lifts, taller open-end posts and distinct per-face counts', () => {
    const parameters = { ...DEFAULT_PARAMETERS, layerCount: 4, swapInnerOuter: true }
    const input = structuredClone(parameters)
    const { profiles, trace } = resolveHeightStages(parameters, [2, 4], [0.26, 2.14, 4.02, 5.90], 1, true)
    expect(parameters).toEqual(input)
    const roof = profiles.find(profile => profile.count === 4)!
    expect(roof.height).toEqual({ layers: 4, lifts: [0.26, 2.14, 4.02, 5.90], theoretical: 6.2, railed: 8.38, outerRow: 1, innerRow: 0 })
    expect(postHeightAt(roof.height, 0, false)).toBe(6.2)
    expect(postHeightAt(roof.height, 0, true)).toBe(8.38)
    expect(postHeightAt(roof.height, 1, false)).toBe(8.38)
    expect(profiles.find(profile => profile.count === 2)!.height.theoretical).toBe(2.44)
    expect(trace.map(item => item.step)).toEqual(['M02.heights', 'P01.courses', 'S01.supportPreview', 'P07.supportedCourses'])
    expect(() => roof.height.lifts.push(100)).toThrow()
  })
  it('retains single and double rail courses plus deckless-top coping without adding lower deckless guards', () => {
    const parameters = { ...DEFAULT_PARAMETERS, layerCount: 3, deckLiftInterval: 2 }
    const single = resolveHeightStages(parameters, [], undefined, 0).profiles[0]
    expect(single.courses.map(course => course.enabled)).toEqual([false, true, true])
    expect(single.courses[1].side.usable.map(rail => rail.elevation)).toEqual([4.70])
    expect(single.courses[2].side.usable.map(rail => rail.elevation)).toEqual([6.58, 7.82])
    const double = resolveHeightStages({ ...parameters, guardrailRailCount: 2 }, [], undefined, 0).profiles[0]
    expect(double.courses[1].side.usable.map(rail => rail.elevation)).toEqual([4.936, 4.36])
    expect(double.courses[2].side.usable.map(rail => rail.elevation)).toEqual([6.816, 7.82])
  })
  it('uses top-edge millimetres, reports unsupported rails and suppresses a coincident next-lift tube', () => {
    const candidate = { layer: 1, elevation: 1, rails: [], coping: null }
    const rails = [{ id: 'top', label: '上栏杆', centreAboveDeck: 1.176 }]
    const parameters = { liftHeight: 1.88, pipeDiameter: 0.048 }
    expect(railsWithin(candidate, rails, 2.2, 2, parameters).usable).toHaveLength(1)
    expect(railsWithin(candidate, rails, 2.198, 2, parameters)).toEqual({ usable: [], above: ['上栏杆'] })
    expect(railsWithin(candidate, rails, 3, 2, { ...parameters, liftHeight: 1.2 })).toEqual({ usable: [], above: [] })
    expect(railsWithin(candidate, rails, 3, 1, { ...parameters, liftHeight: 1.2 }).usable).toHaveLength(1)
  })
})
