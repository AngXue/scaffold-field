import { expect, it } from 'vitest'
import type { ScaffoldMember, Vector3Tuple } from '../../scaffold'
import { calculateSite } from '../../site'
import { SITE_DEMOS } from '../../siteDemos'
import { mergeSharedRuns } from '../policies/sharedMembers'
import { sharedComponentPosts } from '../policies/components'
import { MEMBER_USES, makeUse } from './memberUses'
import { MEMBER_HISTORY, historyOf, memberBirth, memberChange, historyTransformer } from './memberHistory'
import { buildEntityGraph } from './entityGraph'

function rail(id: string, start: number, end: number, segment: number): ScaffoldMember {
  return { id, type: 'guardrail', start: [start, 2, 0], end: [end, 2, 0], length: end - start, layer: 1, pathSegment: segment,
    connectionPoints: [[start, 2, 0], [end, 2, 0]], [MEMBER_USES]: [makeUse(segment, 'side-guard', [start, 2, 0], [end, 2, 0], 'P02')] }
}
it('actual merges retain the replaced inputs and every intermediate union without editing their snapshots', () => {
  const input = [rail('A', 0, 1, 0), rail('B', 1, 3, 1), rail('C', 3, 5, 2)]
  for (const member of input) member[MEMBER_HISTORY] = memberBirth(member)
  const roots = input.map(historyOf), original = JSON.stringify(roots)
  const merged = mergeSharedRuns(input)[0], version = historyOf(merged)
  expect(version.operation).toBe('merge')
  expect(version.start).toEqual([0, 2, 0]); expect(version.end).toEqual([5, 2, 0])
  const intermediate = version.parents.find(parent => parent.operation === 'merge')!
  expect(intermediate.start).toEqual([0, 2, 0]); expect(intermediate.end).toEqual([3, 2, 0])
  expect(intermediate.parents.map(parent => parent.id).sort()).toEqual(roots.slice(0, 2).map(node => node.id).sort())
  expect(version.parents.some(parent => parent === roots[2])).toBe(true)
  expect(JSON.stringify(roots)).toBe(original)
  expect(() => { intermediate.start[0] = 100 }).toThrow()
  expect(historyOf(mergeSharedRuns([merged])[0])).toBe(version)
  const relabelled = input.map(member => ({ ...member, id: `label-${member.id}` })).reverse()
  expect(historyOf(mergeSharedRuns(relabelled)[0]).id).toBe(version.id)
})
it('coordinate adapters move all ancestral intervals and origins while preserving shared nodes and identities', () => {
  const first = mergeSharedRuns([rail('A', 0, 1, 0), rail('B', 1, 3, 1)])[0]
  const extended = mergeSharedRuns([first, rail('C', 3, 5, 2)])[0]
  const transform = historyTransformer(([x,y,z]) => [8-z,y+3.5,x-2], use => ({ pathSegment: use.pathSegment + 5, sectionId: `S${use.pathSegment}`, spanId: `roof-${use.pathSegment}` }))
  const old = historyOf(first), before = JSON.stringify(old)
  const one = transform(first)[MEMBER_HISTORY]!, two = transform(extended)[MEMBER_HISTORY]!
  expect(two.parents.find(parent => parent.id === old.id)).toBe(one)
  expect(one.id).toBe(old.id)
  expect(one.start).toEqual([8,5.5,-2]); expect(one.end).toEqual([8,5.5,1])
  const birth = one.parents.find(parent => parent.uses[0]?.pathSegment === 5)!
  expect(birth.uses[0]).toMatchObject({ sectionId: 'S0', spanId: 'roof-0', start: [8,5.5,-2], end: [8,5.5,-1] })
  expect(JSON.stringify(old)).toBe(before)
})
it('common-post history keeps both demand heights and the unchanged stock owner', () => {
  const post = (id: string, height: number, path: number): ScaffoldMember => ({ ...rail(id,0,1,path), type: 'post', layer: undefined,
    start: [0,0,0], end: [0,height,0], length: height, connectionPoints: [[0,0,0],[0,height,0]],
    [MEMBER_USES]: [makeUse(path,'post',[0,0,0],[0,height,0],'M01')] })
  const a = post('tall',12,0), b = post('short',8,1)
  const result = sharedComponentPosts([a,b], { tall: [6,6], short: [4,4] })
  expect(result.members).toHaveLength(1)
  expect(result.members[0].id).toBe('short')
  expect(result.sequences.short).toEqual([6,6]); expect(result.sequenceOwners.short).toBe('tall')
  const version = historyOf(result.members[0])
  expect(version.rules).toEqual(['G08'])
  expect(version.end).toEqual([0,12,0])
  expect(version.parents.map(parent => parent.end[1]).sort((a,b) => a-b)).toEqual([8,12])
  expect(a.end).toEqual([0,12,0]); expect(b.end).toEqual([0,8,0])
})
it('conflicting snapshots cannot hide behind the same ancestor identity', () => {
  const member = rail('A',0,1,0), source = memberBirth(member)
  expect(() => memberChange(member, [], 'M08', 'merge')).toThrow('ancestor')
  expect(() => memberChange(member, [source, {...source, end: [4,2,0] as Vector3Tuple}], 'M08', 'merge')).toThrow('Conflicting member ancestor')
})
it('the original S1 upper caps show actual merge-to-clip replacements and removed purposes', () => {
  const demo = SITE_DEMOS.find(demo => demo.id === 'adjacent-houses')!
  const graph = buildEntityGraph(demo.site, calculateSite(demo.site, demo.parameters))
  const versions = new Map(graph.construction.map(node => [node.id,node])), lineage = new Map(graph.lineage.map(node => [node.id,node]))
  for (const height of [6.58,8.46,9.7]) {
    const clip = graph.construction.find(node => node.operation === 'clip' && node.start[0] === 5.05 && node.start[1] === height)!
    expect(clip.start).toEqual([5.05,height,-4.95]); expect(clip.end).toEqual([5.05,height,-3.25])
    expect(clip.rules).toEqual(['P06']); expect(clip.parentIds).toHaveLength(1)
    expect(versions.get(clip.parentIds[0])!.operation).toBe('merge')
    expect(lineage.get(clip.parentIds[0])!.replacedBy).toContain(clip.id)
    expect(lineage.get(clip.id)!.derivedFrom).toContain(clip.parentIds[0])
  }
  for (const removal of graph.retired) {
    expect(removal.constructionId).toBeDefined()
    const tombstone = versions.get(removal.constructionId!)!
    expect(tombstone.operation).toBe('purpose-removal')
    expect(tombstone.useIds).toContain(removal.useId)
    expect(lineage.get(removal.id)!.derivedFrom).toContain(tombstone.id)
  }
  for (const link of graph.construction.filter(node => node.operation === 'connect')) {
    expect(link.parentIds).toHaveLength(2)
    expect(link.rules).toEqual(['P05'])
    // A connection derives from its support members; it does not delete them.
    expect(link.parentIds.every(id => !lineage.get(id)!.replacedBy.includes(link.id))).toBe(true)
  }
})
