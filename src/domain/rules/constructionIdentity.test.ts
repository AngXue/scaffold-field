import { expect, it } from 'vitest'
import { DISPLAY_ID, INTERNAL_ID, displayId } from './facts/displayIdentity'
import { physicalContributions } from './facts/materialLedger'
import { DEFAULT_PARAMETERS, startScaffoldPlan, assembleScaffoldDraft, publishScaffoldAssembly } from '../scaffold'
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
  for (const id of ids) expect(finalIds.has(id)).toBe(true)
  expect(result.draft.members.every(member => /^G\d+-M\d+$/.test(displayId(member)))).toBe(true)
  expect(result.draft.members.every(member => displayId(member) === constructionAlias(aliases, member.id))).toBe(true)
  const assembly = assembleScaffoldDraft(result.draft)
  const ledger = physicalContributions(assembly)
  expect(ledger.every(entry => !/^R\d+\/|^G\d+-/.test(entry.entityId))).toBe(true)
  const output = publishScaffoldAssembly(assembly, DEFAULT_PARAMETERS)
  expect(output.members.every(member => finalIds.has(member[INTERNAL_ID]!))).toBe(true)
  expect(output.members.every(member => /^G\d+-M\d+$/.test(member.id))).toBe(true)
  const displayMembers = new Set(output.members.map(member => member.id))
  expect(output.pipeSegments.every(pipe => displayMembers.has(pipe.memberId))).toBe(true)
  expect(output.connectors.every(connector => displayMembers.has(connector.memberId)
    && (!connector.connectedMemberId || displayMembers.has(connector.connectedMemberId)))).toBe(true)
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

it('changing display labels cannot change native stock, connections or material contributions', () => {
  const draft = () => startScaffoldPlan(drawing, DEFAULT_PARAMETERS).finish().draft
  const original = draft(), renamed = draft()
  renamed.members.forEach(member => { member[DISPLAY_ID] = `renamed/${displayId(member)}` })
  const a = assembleScaffoldDraft(original), b = assembleScaffoldDraft(renamed)
  expect(physicalContributions(a)).toEqual(physicalContributions(b))
  expect(a.pipeSegments.map(pipe => [pipe.id, pipe.memberId, pipe.start, pipe.end])).toEqual(b.pipeSegments.map(pipe => [pipe.id, pipe.memberId, pipe.start, pipe.end]))
  expect(a.connectors.map(connector => [connector.id, connector.memberId, connector.connectedMemberId, connector.position]))
    .toEqual(b.connectors.map(connector => [connector.id, connector.memberId, connector.connectedMemberId, connector.position]))
})
