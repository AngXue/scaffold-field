import { expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, startScaffoldPlan } from '../scaffold'
import type { PlanDrawing } from '../plan'
import { ConstructionIdentities, constructionAlias } from './facts/constructionIdentity'

const drawing: PlanDrawing = {
  points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 180, y: 0 }, { id: 'c', x: 500, y: 500 }, { id: 'd', x: 680, y: 500 }],
  segments: [{ id: 'wall-a', start: 'a', end: 'b' }, { id: 'wall-b', start: 'c', end: 'd' }],
}
function workingIds(input: PlanDrawing, scope = 'source-frame') {
  const construction = startScaffoldPlan(input, DEFAULT_PARAMETERS, undefined, 0, undefined, false, [], scope)
  construction.advance(3)
  return { construction, ids: construction.working().members.map(member => member.id).sort() }
}

it('native demand keys ignore traversal labels and the order of independent paths', () => {
  const first = workingIds(drawing)
  const reversed = workingIds({ ...drawing, segments: [...drawing.segments].reverse() })
  expect(first.ids).toEqual(reversed.ids)
  expect(first.ids.length).toBeGreaterThan(0)
  expect(first.ids.every(id => /^demand:[0-9a-f]{16}$/.test(id))).toBe(true)
  expect(new Set(first.ids).size).toBe(first.ids.length)
  const single = workingIds({ points: drawing.points.slice(0, 2), segments: drawing.segments.slice(0, 1) })
  expect(single.ids.every(id => first.ids.includes(id))).toBe(true)
})

it('native keys separate equal local geometry belonging to different source frames', () => {
  const a = workingIds(drawing, 'roof-a'), b = workingIds(drawing, 'roof-b')
  expect(a.ids.every(id => !b.ids.includes(id))).toBe(true)
  expect(workingIds(drawing, 'roof-a').ids).toEqual(a.ids)
})

it('S4 stock plans use native keys and the compatibility boundary restores every reference', () => {
  const { construction, ids } = workingIds(drawing)
  const before = JSON.stringify(construction.working().members)
  construction.advance(4)
  const posts = construction.working().posts!
  expect(posts.length).toBeGreaterThan(0)
  for (const post of posts) {
    expect(ids).toContain(post.plan.memberId)
    expect(post.segments.every(pipe => pipe.memberId === post.plan.memberId)).toBe(true)
    expect(post.plan.segmentIds).toEqual(post.segments.map(pipe => pipe.id))
  }
  const result = construction.finish()
  expect(JSON.stringify(construction.working().members)).toBe(before)
  const aliases = construction.working().aliases!
  const finalIds = new Set(result.draft.members.map(member => member.id))
  for (const id of ids) expect(finalIds.has(constructionAlias(aliases, id))).toBe(true)
  expect(result.draft.members.every(member => /^G\d+-M\d+$/.test(member.id))).toBe(true)
  expect(Object.keys(result.draft.postSequences).every(id => finalIds.has(id))).toBe(true)
})

it('semantic demand keys preserve role, lift, coordinates and scope without rounding', () => {
  const keys = new ConstructionIdentities(['wall'], [1.88], 0)
  const same = new ConstructionIdentities(['wall'], [1.88], 0)
  const id = keys.member('longitudinal', 1, [0, 1.88, 0], [1.8, 1.88, 0])
  expect(id).toBe(same.member('longitudinal', 1, [1.8, 1.88, 0], [0, 1.88, 0]))
  expect(keys.member('guardrail', 1, [0, 1.88, 0], [1.8, 1.88, 0])).not.toBe(id)
  expect(keys.member('longitudinal', 2, [0, 1.88, 0], [1.8, 1.88, 0])).not.toBe(id)
  expect(keys.member('longitudinal', 1, [0, 1.88, 0], [1.80001, 1.88, 0])).not.toBe(id)
  expect(() => keys.member('post', undefined, [NaN, 0, 0], [0, 3, 0])).toThrow('Non-finite')
})

it('missing display aliases fail instead of publishing undefined member or pipe references', () => {
  expect(() => constructionAlias(new Map(), 'demand:missing')).toThrow('Missing construction display alias')
})
