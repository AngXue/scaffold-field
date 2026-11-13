import { DISPLAY_ID, displayId } from './facts/displayIdentity'
import { expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, type ScaffoldMember, type Vector3Tuple, type PipeSegment } from '../scaffold'
import type { SiteSection, SectionSummary } from '../site'
import { resolveTransitions, prepareTransitionWork, commitTransitionPosts, finishTransitions } from './transitions'
import { actualPostTops } from './policies/transitions'
import { FRAME_SCOPES } from './facts/scopes'
import { MEMBER_USES, makeUse, memberUses } from './facts/memberUses'

const rail = (id: string, type: ScaffoldMember['type'], start: Vector3Tuple, end: Vector3Tuple, pathSegment: number): ScaffoldMember => ({
  [FRAME_SCOPES]: [`frame-${pathSegment}`], id, type, start, end, pathSegment, layer: 1, length: Math.hypot(...end.map((value, i) => value - start[i])), connectionPoints: [start, end],
  [MEMBER_USES]: [makeUse(pathSegment, type === 'guardrail' ? 'side-guard' : type, start, end, 'P02')],
})
const input = () => {
  const before: SiteSection = { id: 'S1-ground', surfaceId: 'ground', start: { x: 0, z: 0 }, end: { x: 1, z: 0 }, layers: 1 }
  const after: SiteSection = { id: 'S1-roof', surfaceId: 'B1', start: { x: 2, z: 0 }, end: { x: 3, z: 0 }, layers: 1 }
  const members = [0, 1].flatMap(index => {
    const x = index * 2, group = `R${index + 1}`
    return [rail(`${group}/L0`, 'longitudinal', [x, 1.88, 0], [x + 1, 1.88, 0], index),
      rail(`${group}/L1`, 'longitudinal', [x, 1.88, 0.75], [x + 1, 1.88, 0.75], index),
      rail(`${group}/G`, 'guardrail', [x, 2.82, 0.75], [x + 1, 2.82, 0.75], index)]
  })
  const cap = rail('R1/cap', 'guardrail', [1, 2.82, -0.75], [1, 2.82, 0.75], 0)
  cap.connectionPoints = [[1, 2.82, -0.75], [1, 2.82, 0], [1, 2.82, 0.75]]
  members.push(cap)
  const summaries: SectionSummary[] = [before, after].map((line, index) => ({ id: line.id, base: index, length: 1, firstLayer: 1, levels: [1.88], firstClearance: 1.88 - index, top: 1.88 }))
  return { members, decks: [], posts: [], spans: [before, after].map(line => ({ sourceId: 'S1', line, wall: true })), summaries,
    transitions: [{ before, after, boundary: 1.5 }], settings: DEFAULT_PARAMETERS }
}
it('connects working and guard runs independently, opens only the cap interval and preserves neighbouring outside protection', () => {
  const source = input(), before = JSON.stringify(source), result = resolveTransitions(source, true)
  expect(JSON.stringify(source)).toBe(before)
  expect(result.plan.joined).toEqual([{ before: 'S1-ground', after: 'S1-roof', levels: [1.88] }])
  expect(result.plan.links.map(member => member.type)).toEqual(['longitudinal', 'longitudinal', 'guardrail'])
  expect(result.plan.failed).toEqual([])
  const remaining = result.opened!.members.find(member => displayId(member) === 'R1/cap')!
  expect([remaining.start, remaining.end]).toEqual([[1, 2.82, -0.75], [1, 2.82, 0]])
  expect(memberUses(remaining)[0].rules).toContain('P06')
  expect(result.plan.bridges[0].rails.every(member => member.length === 1)).toBe(true)
  expect(Object.isFrozen(result.plan.bridges[0].rails[0])).toBe(true)
  expect(result.trace.map(step => step.step)).toEqual(['P05.globalGeometry', 'P05.workingLinks', 'P07.actualPostTops', 'P05.guardGeometry', 'P05.links', 'P06.openCaps'])
  expect(resolveTransitions(source).plan).toEqual(result.plan)
})
it('leaves protection intact when the transition exceeds the maximum bay', () => {
  const source = input()
  source.transitions[0].after = { ...source.transitions[0].after, start: { x: 3, z: 0 } }
  const result = resolveTransitions(source, true)
  expect(result.opened).toBeUndefined()
  expect(result.plan.failed).toHaveLength(1)
  expect(result.trace.at(-1)).toMatchObject({ step: 'P06.openCaps', status: 'not-applicable' })
})
it('reads physical post tops independently of horizontal tubes and tube direction', () => {
  const pipes = [{ id: 'p1', memberId: 'post', type: 'post', start: [0, 0, 0], end: [0, 3, 0] },
    { id: 'p2', memberId: 'post', type: 'post', start: [0, 6.4, 0], end: [0, 3, 0] },
    { id: 'other', memberId: 'horizontal', type: 'longitudinal', start: [0, 10, 0], end: [2, 10, 0] }] as PipeSegment[]
  expect(actualPostTops(pipes)).toEqual({ post: 6.4 })
})

it('selects transition scopes independently of member and deck display ID prefixes', () => {
  const source = input()
  const isolated = rail('R1/unrelated', 'longitudinal', [10, 1.88, 0], [11, 1.88, 0], 2)
  source.members.push(isolated)
  const deck = { id: 'R1/unrelated-deck', [FRAME_SCOPES]: ['frame-2'], pathSegment: 2, layer: 1, area: 0.75,
    corners: [[10, 1.88, 0], [11, 1.88, 0], [11, 1.88, 0.75], [10, 1.88, 0.75]] as import('../scaffold').DeckPanel['corners'] }
  const result = resolveTransitions({ ...source, decks: [deck] })
  expect(result.opened!.groups.sort()).toEqual(['frame-0', 'frame-1'])
  expect(result.opened!.members.some(member => member.id === isolated.id)).toBe(false)
  expect(result.opened!.decks.some(item => item.id === deck.id)).toBe(false)
  expect(result.plan.links.every(member => member[FRAME_SCOPES]?.join(',') === 'frame-0,frame-1')).toBe(true)
  const renamed = resolveTransitions({ ...source, members: source.members.map((member, index) => ({ ...member, id: `label-${index}` })), decks: [{ ...deck, id: 'label-deck' }] })
  expect(renamed.opened!.groups).toEqual(result.opened!.groups)
  const geometry = (members: ScaffoldMember[]) => members.map(({ type, start, end }) => ({ type, start, end }))
  expect(geometry(renamed.opened!.members)).toEqual(geometry(result.opened!.members))
  expect(renamed.opened!.decks).toEqual([])
})
it('rejects a missing committed scope instead of guessing a physical group from a display label', () => {
  const source = input()
  delete source.members[0][FRAME_SCOPES]
  expect(() => resolveTransitions(source)).toThrow('Missing committed construction frame scope')
})

it('commits working connections before protection and preserves them when every guard is omitted', () => {
  const source = input(), work = prepareTransitionWork(source, true)
  expect(work.geometry.members.every(member => member.type !== 'guardrail')).toBe(true)
  expect(work.trace.map(step => step.phase)).toEqual([3, 3])
  expect(work.working.intents[0].courses[0].matches).toHaveLength(2)
  const before = JSON.stringify(work)
  const ready = commitTransitionPosts(work, [], true)
  expect(ready.trace.at(-1)?.phase).toBe(4)
  const without = finishTransitions(ready, source.members.filter(member => member.type !== 'guardrail'), undefined, true)
  expect(without.plan.links.map(member => member.type)).toEqual(['longitudinal', 'longitudinal'])
  const normal = resolveTransitions(source)
  expect(without.plan.links).toEqual(normal.plan.links.filter(member => member.type !== 'guardrail'))
  expect(without.plan.joined).toEqual(normal.plan.joined)
  expect(without.plan.panels).toEqual(normal.plan.panels)
  expect(JSON.stringify(work)).toBe(before)
})
it('protection rejects moved or removed committed work rather than silently recomputing it', () => {
  const source = input(), ready = commitTransitionPosts(prepareTransitionWork(source), [])
  const changed = source.members.map(member => ({ ...member, end: [...member.end] as Vector3Tuple }))
  changed[0].end[0] += 0.1
  expect(() => finishTransitions(ready, changed)).toThrow('cannot replace committed working geometry')
  expect(() => finishTransitions(ready, source.members.slice(1))).toThrow('cannot discard committed working geometry')
  expect(resolveTransitions(source).plan.links).toHaveLength(3)
})
it('staged transition intent survives display alias restoration without selecting different geometry', () => {
  const source = input(), ready = commitTransitionPosts(prepareTransitionWork(source), [])
  const aliases = new Map(source.members.map((member, index) => [member.id, `display-${index}`]))
  const members = source.members.map(member => ({ ...member, [DISPLAY_ID]: aliases.get(member.id)! }))
  const result = finishTransitions(ready, members, aliases)
  expect(result.plan.links).toEqual(resolveTransitions({ ...source, members }).plan.links)
  expect(() => finishTransitions(ready, members, new Map())).toThrow('Missing committed transition member alias')
})
